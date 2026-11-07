"""Map every experimental drug in a raw snapshot to its ChEMBL mechanism (hand-run, network).

Usage:
  uv run python scripts/map_mechanisms.py <snapshot.jsonl.gz | raw dir>
      [--config PATH] [--out config/mechanisms] [--cache pipeline/.cache/chembl]
      [--record DIR] [--only name,name] [--labels <out>/target_labels.csv]

Writes ``<out>/drugs.csv`` sorted by drug (never touches ``overrides.csv``) and prints a
coverage report: drug counts, then drug-bearing trials whose every drug is resolved
(mapped, manual or not_a_drug) with ``overrides.csv`` applied, the published method.
``--record DIR`` also saves every fetched ChEMBL response, trimmed to the fields the mapping
uses, as test fixtures. ``--only`` re-maps just those names (also names absent from the
snapshot) and merges them into the existing ``drugs.csv``: other rows are kept.
"""

from __future__ import annotations

import argparse
from collections import Counter
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from trialradar.config import load_config
from trialradar.explorer.drugs import clean_drug_name
from trialradar.explorer.extras import extract_extras
from trialradar.mechanisms.chembl import ChemblClient, ChemblError
from trialradar.mechanisms.classify import map_drug
from trialradar.mechanisms.io import DrugMapping, read_drugs, read_target_labels, write_drugs
from trialradar.relevance import filter_relevant
from trialradar.snapshot import list_snapshots, read_snapshot
from trialradar.textnorm import load_aliases

_REPO = Path(__file__).resolve().parents[2]
TOP_UNMAPPED = 40

# fields kept by --record, per response kind
_MOLECULE = ("molecule_chembl_id", "pref_name", "molecule_type")
_MECHANISM = (
    "mechanism_of_action",
    "action_type",
    "target_chembl_id",
    "molecule_chembl_id",
    "parent_molecule_chembl_id",
)


def _trim_molecule(m: dict[str, Any]) -> dict[str, Any]:
    h = m.get("molecule_hierarchy")
    return {
        **{k: m.get(k) for k in _MOLECULE},
        "molecule_hierarchy": {"parent_chembl_id": h.get("parent_chembl_id")}
        if isinstance(h, dict)
        else None,
        "molecule_synonyms": [
            {"molecule_synonym": s.get("molecule_synonym")}
            for s in m.get("molecule_synonyms") or []
            if isinstance(s, dict)
        ],
    }


def trim(path: str, body: dict[str, Any]) -> dict[str, Any]:
    """Keep only what :mod:`trialradar.mechanisms` reads, so fixtures stay small."""
    meta = body.get("page_meta")
    page = {"page_meta": {"next": meta.get("next")}} if isinstance(meta, dict) else {}
    if path == "molecule/search.json":
        return {**page, "molecules": [_trim_molecule(m) for m in body.get("molecules") or []]}
    if path == "mechanism.json":
        rows = body.get("mechanisms") or []
        return {**page, "mechanisms": [{k: r.get(k) for k in _MECHANISM} for r in rows]}
    if path.startswith("molecule/"):
        return _trim_molecule(body)
    if path.startswith("target/"):
        return {
            "target_chembl_id": body.get("target_chembl_id"),
            "pref_name": body.get("pref_name"),
            "target_type": body.get("target_type"),
            "target_components": [
                {
                    "accession": c.get("accession"),
                    "target_component_synonyms": [
                        {
                            "syn_type": s.get("syn_type"),
                            "component_synonym": s.get("component_synonym"),
                        }
                        for s in c.get("target_component_synonyms") or []
                        if s.get("syn_type") == "GENE_SYMBOL"
                    ],
                }
                for c in body.get("target_components") or []
            ],
        }
    return body


def _snapshot_path(path: Path) -> Path:
    if path.is_dir():
        found = list_snapshots(path)
        if not found:
            raise SystemExit(f"no snapshots in {path}")
        return found[-1][1]
    return path


def trial_drugs(snapshot: Path, config: Path) -> dict[str, frozenset[str]]:
    """Each relevant trial's distinct cleaned experimental drug names (trials with none left out)."""
    cfg = load_config(config)
    aliases = load_aliases(cfg.aliases_dir / "intervention.csv")
    relevant = filter_relevant(read_snapshot(snapshot), cfg)
    out: dict[str, frozenset[str]] = {}
    for nct, extras in extract_extras(relevant, cfg)[0].items():
        names = {
            clean_drug_name(n, aliases, cfg.explorer.exclude_terms)
            for n in extras.experimental_drugs
        }
        if names := {n for n in names if n}:
            out[nct] = frozenset(names)
    return out


def drug_counts(trials: dict[str, frozenset[str]]) -> Counter[str]:
    """Distinct drug names with the number of trials using each."""
    return Counter(n for names in trials.values() for n in names)


_RESOLVED = ("mapped", "manual", "not_a_drug")


def report(
    rows: Sequence[DrugMapping],
    trials: dict[str, frozenset[str]],
    errors: dict[str, str],
    overrides: dict[str, DrugMapping],
) -> None:
    """Drug counts from ``drugs.csv``, then trial coverage with ``overrides.csv`` applied."""
    counts = drug_counts(trials)
    mapped = [r for r in rows if r.status == "mapped"]
    unmapped = [r for r in rows if r.status != "mapped"]
    print(f"mapped {len(mapped)} / {len(rows)} drugs; unmapped {len(unmapped)}")
    merged = {**{r.drug: r for r in rows}, **overrides}
    resolved = sum(
        all(n in merged and merged[n].status in _RESOLVED for n in names)
        for names in trials.values()
    )
    pct = 100 * resolved / len(trials) if trials else 0.0
    print(
        f"{resolved} / {len(trials)} drug-bearing trials have every drug resolved ({pct:.1f}%)"
        + (" with overrides" if overrides else "")
    )
    open_rows = [r for r in merged.values() if r.status == "unmapped"]
    top = sorted(open_rows, key=lambda r: (-counts[r.drug], r.drug))[:TOP_UNMAPPED]
    if top:
        print(f"top {len(top)} unmapped:")
        for r in top:
            why = f"  [{errors[r.drug]}]" if r.drug in errors else ""
            print(f"{counts[r.drug]:6d}  {r.drug}{why}")


def _overrides(out: Path) -> dict[str, DrugMapping]:
    path = out / "overrides.csv"
    if not path.is_file():
        return {}
    try:
        return read_drugs(path)
    except ValueError as exc:
        print(f"warning: overrides.csv not applied to coverage: {exc}")
        return {}


def run(
    *,
    snapshot: Path,
    config: Path,
    out: Path,
    client: ChemblClient,
    only: Sequence[str] | None,
    labels_path: Path | None = None,
) -> list[DrugMapping]:
    trials = trial_drugs(_snapshot_path(snapshot), config)
    names = sorted(
        {n.casefold().strip() for n in only} if only is not None else set(drug_counts(trials))
    )
    labels = read_target_labels(labels_path or out / "target_labels.csv")
    rows: list[DrugMapping] = []
    errors: dict[str, str] = {}
    for name in names:
        try:
            rows.append(map_drug(client, name, labels))
        except ChemblError as exc:
            errors[name] = str(exc)
            rows.append(DrugMapping(name, "unmapped", None, None, (), (), (), ()))
    out.mkdir(parents=True, exist_ok=True)
    if only is not None and (out / "drugs.csv").is_file():
        # --only re-maps a few names: merge them into the existing file, keeping every other row.
        merged = read_drugs(out / "drugs.csv")
        merged.update({r.drug: r for r in rows})
        rows = list(merged.values())
    write_drugs(out / "drugs.csv", rows)
    report(rows, trials, errors, _overrides(out))
    return sorted(rows, key=lambda r: r.drug)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("snapshot", type=Path, help="raw snapshot .jsonl.gz, or a raw dir (newest)")
    ap.add_argument("--config", type=Path, default=_REPO / "config" / "area.yaml")
    ap.add_argument("--out", type=Path, default=_REPO / "config" / "mechanisms")
    ap.add_argument("--cache", type=Path, default=_REPO / "pipeline" / ".cache" / "chembl")
    ap.add_argument("--record", type=Path, default=None, help="save trimmed responses here")
    ap.add_argument("--only", default=None, help="comma-separated drug names to map")
    ap.add_argument("--labels", type=Path, default=None, help="default: <out>/target_labels.csv")
    args = ap.parse_args()
    only = [n for n in (s.strip() for s in args.only.split(",")) if n] if args.only else None
    client = ChemblClient(cache_dir=args.cache, record_dir=args.record, record=trim)
    run(
        snapshot=args.snapshot,
        config=args.config,
        out=args.out,
        client=client,
        only=only,
        labels_path=args.labels,
    )


if __name__ == "__main__":
    main()
