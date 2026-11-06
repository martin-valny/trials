"""Map every experimental drug in a raw snapshot to its ChEMBL mechanism (hand-run, network).

Usage:
  uv run python scripts/map_mechanisms.py <snapshot.jsonl.gz | raw dir>
      [--config PATH] [--out config/mechanisms] [--cache pipeline/.cache/chembl]
      [--record DIR] [--only name,name] [--labels <out>/target_labels.csv]

Writes ``<out>/drugs.csv`` sorted by drug (never touches ``overrides.csv``) and prints a
coverage report. ``--record DIR`` also saves every fetched ChEMBL response, trimmed to the
fields the mapping uses, as test fixtures. ``--only`` maps just those names (also names
absent from the snapshot, with a trial count of 0).
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
from trialradar.mechanisms.io import DrugMapping, read_target_labels, write_drugs
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


def drug_counts(snapshot: Path, config: Path) -> Counter[str]:
    """Distinct cleaned experimental drug names with the number of trials using each."""
    cfg = load_config(config)
    aliases = load_aliases(cfg.aliases_dir / "intervention.csv")
    relevant = filter_relevant(read_snapshot(snapshot), cfg)
    counts: Counter[str] = Counter()
    for extras in extract_extras(relevant, cfg)[0].values():
        names = {
            clean_drug_name(n, aliases, cfg.explorer.exclude_terms)
            for n in extras.experimental_drugs
        }
        counts.update(n for n in names if n)
    return counts


def report(rows: Sequence[DrugMapping], counts: Counter[str], errors: dict[str, str]) -> None:
    mapped = [r for r in rows if r.status == "mapped"]
    unmapped = [r for r in rows if r.status != "mapped"]
    covered = sum(counts[r.drug] for r in mapped)
    total = sum(counts[r.drug] for r in rows)
    pct = 100 * covered / total if total else 0.0
    print(f"mapped {len(mapped)} / {len(rows)} drugs; unmapped {len(unmapped)}")
    print(f"trial-weighted coverage {covered} / {total} drug-trial pairs ({pct:.1f}%)")
    top = sorted(unmapped, key=lambda r: (-counts[r.drug], r.drug))[:TOP_UNMAPPED]
    if top:
        print(f"top {len(top)} unmapped:")
        for r in top:
            why = f"  [{errors[r.drug]}]" if r.drug in errors else ""
            print(f"{counts[r.drug]:6d}  {r.drug}{why}")


def run(
    *,
    snapshot: Path,
    config: Path,
    out: Path,
    client: ChemblClient,
    only: Sequence[str] | None,
    labels_path: Path | None = None,
) -> list[DrugMapping]:
    counts = drug_counts(_snapshot_path(snapshot), config)
    names = sorted({n.casefold().strip() for n in only} if only is not None else set(counts))
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
    write_drugs(out / "drugs.csv", rows)
    report(rows, counts, errors)
    return rows


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
