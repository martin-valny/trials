"""Assemble the explorer: features, 3D layout, outcomes and the headline statistic (spec 6.5)."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping
from datetime import date
from typing import Any

import numpy as np
import polars as pl

from trialradar.config import AreaConfig
from trialradar.explorer.drugs import clean_drug_name
from trialradar.explorer.extras import StudyExtras, empty_extras
from trialradar.explorer.features import build_features
from trialradar.explorer.layout import align, embed
from trialradar.explorer.outcomes import (
    Outcome,
    TrialDrugs,
    in_pool,
    label_outcomes,
    success_labels,
    top_phase,
)
from trialradar.explorer.stats import LiftResult, neighbourhood_lift
from trialradar.store import COORDS_SCHEMA
from trialradar.tables import Tables

FEATURES = ["disease", "treatment_type", "molecule", "population"]
_MIN_TRIALS = 4
_DECIMALS = 4


def _trial_drugs(
    ids: list[str], extras: Mapping[str, StudyExtras], aliases: Mapping[str, str], cfg: AreaConfig
) -> TrialDrugs:
    out: TrialDrugs = {}
    for nct in ids:
        cleaned = (
            clean_drug_name(name, aliases, cfg.explorer.exclude_terms)
            for name in extras[nct].experimental_drugs
        )
        out[nct] = frozenset(c for c in cleaned if c is not None)
    return out


def _intervention_types(tables: Tables) -> dict[str, frozenset[str]]:
    types: dict[str, set[str]] = defaultdict(set)
    for nct, kind in tables.intervention.select("nct_id", "type").iter_rows():
        if kind is not None:
            types[nct].add(kind)
    return {k: frozenset(v) for k, v in types.items()}


def _stats(result: LiftResult, by_condition: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "verdict": result.verdict,
        "lift": result.lift,
        "baseline_mean": result.baseline_mean,
        "baseline_range": list(result.baseline_range) if result.baseline_range else None,
        "n_pool": result.n_pool,
        "n_succeeded": result.n_succeeded,
        "success_rate": result.success_rate,
        "n_averaged": result.n_averaged,
        "n_short": result.n_short,
        "p_value": result.p_value,
        "by_condition": by_condition,
    }


def build_explorer(
    tables: Tables,
    extras: Mapping[str, StudyExtras],
    cfg: AreaConfig,
    aliases: Mapping[str, str],
    previous: Mapping[str, tuple[float, float, float]],
    day: date,
    warnings: list[str] | None = None,
) -> tuple[dict[str, Any], pl.DataFrame]:
    """The ``explorer.json`` document and the (unrounded) coordinates frame for ``day``.

    ``aliases`` are the intervention aliases; ``previous`` the last saved coordinates,
    which the new layout is aligned to (empty: the raw layout is used). Degradations
    (a failed layout) are appended to ``warnings``."""
    ex = cfg.explorer
    trial_rows = {r["nct_id"]: r for r in tables.trial.iter_rows(named=True)}
    ids = sorted(trial_rows)
    full = {nct: extras.get(nct) or empty_extras(nct) for nct in ids}
    drugs = _trial_drugs(ids, full, aliases, cfg)
    labels = {n: frozenset(full[n].condition_labels) for n in ids}
    outcomes: dict[str, Outcome] = label_outcomes(tables.trial, drugs, labels)
    succeeded_in = success_labels(tables.trial, drugs, labels)
    pool = [in_pool(trial_rows[n]["phases"] or [], outcomes[n], bool(drugs[n])) for n in ids]
    succeeded = [outcomes[n] == "succeeded" for n in ids]

    by_condition = []
    for cond in cfg.conditions:
        rows = [i for i, n in enumerate(ids) if pool[i] and cond.label in full[n].condition_labels]
        by_condition.append(
            {
                "label": cond.label,
                "finished": len(rows),
                # R21: a pool trial counts as succeeded in this label only if it progressed here
                "succeeded": sum(cond.label in succeeded_in[ids[i]] for i in rows),
            }
        )

    method: dict[str, Any] = {
        "algorithm": "umap",
        "dims": 3,
        "seed": ex.seed,
        "features": list(FEATURES),
        "k": ex.k,
    }
    if len(ids) < _MIN_TRIALS:
        n_pool, n_succ = sum(pool), sum(s for s, p in zip(succeeded, pool, strict=True) if p)
        rate = n_succ / n_pool if n_pool else None
        result = LiftResult("insufficient", None, None, None, n_pool, n_succ, rate)
        doc: dict[str, Any] = {
            "generated_for": day.isoformat(),
            "method": method,
            "stats": _stats(result, by_condition),
            "trials": [],
        }
        return doc, pl.DataFrame(schema=COORDS_SCHEMA)

    types = _intervention_types(tables)
    # build_features orders rows by sorted id, which is ``ids``.
    features = build_features(ids, full, drugs, types, {str(k): v for k, v in ex.weights.items()})
    result = neighbourhood_lift(
        features.matrix,
        ids,
        succeeded,
        pool,
        drugs,
        k=ex.k,
        permutations=ex.permutations,
        seed=ex.seed,
        min_successes=ex.min_successes,
    )
    coords = align(ids, embed(features, ex.n_neighbors, ex.min_dist, ex.seed, warnings), previous)
    coords = np.asarray(coords, dtype=np.float64)

    trials: list[dict[str, Any]] = []
    for i, nct in enumerate(ids):
        r, x = trial_rows[nct], full[nct]
        start: date | None = r["start_date"]
        if r["primary_completion_date"] is not None:
            end: date | None = r["primary_completion_date"]
            end_type = r["primary_completion_date_type"]
        else:
            end, end_type = r["completion_date"], r["completion_date_type"]
        trials.append(
            {
                "nct_id": nct,
                "x": round(float(coords[i, 0]), _DECIMALS),
                "y": round(float(coords[i, 1]), _DECIMALS),
                "z": round(float(coords[i, 2]), _DECIMALS),
                "title": r["title"],
                "condition_labels": list(x.condition_labels),
                "phase": top_phase(r["phases"] or []),
                "outcome": outcomes[nct],
                "has_results": x.has_results,
                "treatment_types": sorted(types.get(nct, ())),
                "drugs": sorted(drugs[nct]),
                "enrollment": r["enrollment"],
                "lead_sponsor": r["lead_sponsor"],
                "start_year": start.year if start is not None else None,
                "end_year": end.year if end is not None else None,
                "end_estimated": end is not None and end_type == "ESTIMATED",
                "succeeded_in": sorted(succeeded_in[nct]),
                "in_pool": pool[i],
            }
        )
    doc = {
        "generated_for": day.isoformat(),
        "method": method,
        "stats": _stats(result, by_condition),
        "trials": trials,
    }
    frame = pl.DataFrame(
        {"nct_id": ids, "x": coords[:, 0], "y": coords[:, 1], "z": coords[:, 2]},
        schema=COORDS_SCHEMA,
    )
    return doc, frame
