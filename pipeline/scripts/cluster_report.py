"""Print KMeans(k) cluster composition for the explorer layout at given mechanism weights.

Used to choose ``explorer.weights.mechanism`` in ``config/area.yaml``.

    uv run python scripts/cluster_report.py <raw snapshot dir | snapshot.jsonl.gz | explorer.json>
        [--weight-mechanism W [W ...]] [--k 14] [--config PATH]

A raw snapshot is laid out again with each weight, through the same code path as the
daily build (``explorer_inputs`` + ``build_features`` + ``embed``). A site
``explorer.json`` has no feature matrix, so it is clustered as published (one table;
the weights are ignored).
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

import numpy as np
from sklearn.cluster import KMeans

from trialradar.config import AreaConfig, load_config
from trialradar.explorer.build import explorer_inputs, feature_weights
from trialradar.explorer.extras import extract_extras
from trialradar.explorer.features import build_features
from trialradar.explorer.layout import embed
from trialradar.normalize import normalize
from trialradar.relevance import filter_relevant
from trialradar.snapshot import list_snapshots, read_snapshot
from trialradar.textnorm import load_aliases

_REPO = Path(__file__).resolve().parents[2]
_TOP_DRUGS = 3


def _top(counter: Counter[str], denom: int) -> tuple[str, float]:
    if not counter or denom == 0:
        return "-", 0.0
    name, n = min(counter.items(), key=lambda kv: (-kv[1], kv[0]))
    return name, n / denom


def cluster_table(
    coords: np.ndarray, trials: Sequence[Mapping[str, Any]], k: int, seed: int = 42
) -> list[dict[str, Any]]:
    """One row per KMeans(k) cluster of ``coords`` (largest first).

    Disease and intervention-type shares use all members as denominator (a trial may
    count in several); the mechanism share uses only members that have drugs."""
    n = len(trials)
    if n == 0:
        return []
    k = max(1, min(k, n))
    labels = KMeans(n_clusters=k, n_init=10, random_state=seed).fit_predict(coords)
    rows: list[dict[str, Any]] = []
    for c in range(k):
        members = [t for t, lab in zip(trials, labels, strict=True) if lab == c]
        if not members:
            continue
        size = len(members)
        diseases = Counter(d for t in members for d in set(t.get("condition_labels", ())))
        types = Counter(d for t in members for d in set(t.get("treatment_types", ())))
        with_drugs = [t for t in members if t.get("drugs")]
        mechs = Counter(m for t in with_drugs for m in set(t.get("mechanisms", ())))
        drugs = Counter(d for t in members for d in set(t.get("drugs", ())))
        disease, disease_share = _top(diseases, size)
        kind, kind_share = _top(types, size)
        mech, mech_share = _top(mechs, len(with_drugs))
        rows.append(
            {
                "size": size,
                "disease": disease,
                "disease_share": disease_share,
                "type": kind,
                "type_share": kind_share,
                "mechanism": mech,
                "mechanism_share": mech_share,
                "drug_members": len(with_drugs),
                "top_drugs": [d for d, _ in sorted(drugs.items(), key=lambda kv: (-kv[1], kv[0]))][
                    :_TOP_DRUGS
                ],
            }
        )
    rows.sort(key=lambda r: (-r["size"], r["disease"]))
    return rows


def format_table(title: str, rows: Sequence[Mapping[str, Any]]) -> str:
    head = (
        f"{'size':>5}  {'top disease':<28} {'%':>4}  {'top type':<20} {'%':>4}  "
        f"{'top mechanism (of drug-bearing)':<36} {'%':>4}  top drugs"
    )
    out = [f"== {title}", head]
    for r in rows:
        out.append(
            f"{r['size']:>5}  {r['disease'][:28]:<28} {r['disease_share']:>4.0%}  "
            f"{r['type'][:20]:<20} {r['type_share']:>4.0%}  "
            f"{r['mechanism'][:36]:<36} {r['mechanism_share']:>4.0%}  "
            f"{', '.join(r['top_drugs'])}"
        )
    return "\n".join(out)


def _snapshot_path(path: Path) -> Path:
    if path.is_dir():
        found = list_snapshots(path)
        if not found:
            raise SystemExit(f"no snapshots in {path}")
        return found[-1][1]
    return path


def _from_explorer_json(path: Path, k: int, seed: int) -> list[str]:
    doc = json.loads(path.read_text(encoding="utf-8"))
    trials = doc["trials"]
    coords = np.array([[t["x"], t["y"], t["z"]] for t in trials], dtype=np.float64)
    title = f"published layout ({len(trials)} trials, KMeans k={k}; weights not applicable)"
    return [format_table(title, cluster_table(coords, trials, k, seed))]


def _from_snapshot(path: Path, cfg: AreaConfig, weights: Sequence[float], k: int) -> list[str]:
    aliases = load_aliases(cfg.aliases_dir / "intervention.csv")
    relevant = filter_relevant(read_snapshot(_snapshot_path(path)), cfg)
    tables = normalize(relevant, cfg.aliases_dir)
    extras, _ = extract_extras(relevant, cfg)
    warnings: list[str] = []
    inp = explorer_inputs(tables, extras, cfg, aliases, warnings)
    for msg in warnings:
        print(f"warning: {msg}")
    ex = cfg.explorer
    trials = [
        {
            "condition_labels": inp.full[n].condition_labels,
            "treatment_types": sorted(inp.types.get(n, ())),
            "drugs": sorted(inp.drugs[n]),
            "mechanisms": inp.mechs[n].mechanisms,
        }
        for n in inp.ids
    ]
    base = feature_weights(cfg)
    out: list[str] = []
    for w in weights:
        feats = build_features(
            inp.ids, inp.full, inp.drugs, inp.types, replace_weight(base, w), inp.mechs
        )
        coords = embed(feats, ex.n_neighbors, ex.min_dist, ex.seed)
        title = f"mechanism weight {w:g} ({len(trials)} trials, KMeans k={k})"
        out.append(format_table(title, cluster_table(coords, trials, k, ex.seed)))
    return out


def replace_weight(base: Mapping[str, float], w: float) -> dict[str, float]:
    return {**base, "mechanism": w}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("source", type=Path, help="raw snapshot dir/file or site explorer.json")
    ap.add_argument("--weight-mechanism", type=float, nargs="+", default=[1.0], metavar="W")
    ap.add_argument("--k", type=int, default=14)
    ap.add_argument("--config", type=Path, default=_REPO / "config" / "area.yaml")
    args = ap.parse_args()

    if args.source.suffix == ".json" and len(args.weight_mechanism) > 1:
        ap.error("--weight-mechanism takes one value for a site explorer.json (it has no features)")
    cfg = load_config(args.config)
    if args.source.suffix == ".json":
        blocks = _from_explorer_json(args.source, args.k, cfg.explorer.seed)
    else:
        blocks = _from_snapshot(args.source, cfg, args.weight_mechanism, args.k)
    print("\n\n".join(blocks))


if __name__ == "__main__":
    main()
