"""The daily ``risk.json``: score running trials with the shipped model and roll up by target.

Pure given its inputs: no network, no training. Only trials still under way and inside the
model's scope (phase 1-3, a drug or biologic) are scored; the rest of the running trials
are listed with a reason. Probabilities are rounded to 3 decimals.
"""

from __future__ import annotations

import statistics
from collections.abc import Mapping
from datetime import date
from typing import Any

import numpy as np
import polars as pl

from trialradar.config import AreaConfig
from trialradar.explorer.extras import StudyExtras
from trialradar.risk import artefacts, features
from trialradar.risk.artefacts import Loaded, typical_rate
from trialradar.risk.explain import contributions, top_factors
from trialradar.risk.scope import RUNNING, has_drug, in_phase_scope
from trialradar.risk.sponsors import live_counts
from trialradar.tables import Tables

__all__ = ["DEGENERATE_MIN_DISTINCT", "DEGENERATE_MIN_TRIALS", "build_risk_doc"]

_NOT_PHASE = "phase not 1–3"
# A shipped model whose estimates collapse to a couple of values is broken (the isotonic map
# went flat); with at least this many scored trials, fewer distinct estimates is an error.
DEGENERATE_MIN_TRIALS = 20
DEGENERATE_MIN_DISTINCT = 3
_NO_DRUG = "no drug or biologic"


def _r(v: float) -> float:
    return round(float(v), 3)


def _model_block(loaded: Loaded, cfg: AreaConfig) -> dict[str, Any]:
    c = loaded.card
    return {
        "version": c.version,
        "trained_on": c.trained_on.isoformat(),
        "shipped": c.shipped,
        "shipped_reason": c.shipped_reason,
        "metrics": c.metrics.model_dump(mode="json"),
        "site_leak_flag": c.site_leak_flag,
        "split": c.split.model_dump(mode="json"),
        "refit_end": c.refit_end,
        "features": list(c.features),
        "excluded": list(c.excluded),
        "typical": [t.model_dump(mode="json") for t in c.typical],
        "n_train": c.n_train,
        "n_test": c.n_test,
        "per_trial": cfg.risk.per_trial,
    }


def _targets(figure: Mapping[str, Any], scored: Mapping[str, dict[str, Any]]) -> dict[str, Any]:
    """Per figure row: median estimate and median typical rate, overall and by disease code."""
    out: dict[str, Any] = {}
    for row in figure.get("rows", []):
        trials: dict[str, set[str]] = {}
        for mark in row.get("marks", []):
            if mark["n"] in scored:
                trials.setdefault(mark["n"], set()).update(mark.get("dz") or ())
        if not trials:
            continue

        def summary(ids: list[str]) -> dict[str, Any]:
            return {
                "n": len(ids),
                "median": _r(statistics.median(scored[i]["p"] for i in ids)),
                "typical": _r(statistics.median(scored[i]["typical"] for i in ids)),
            }

        diseases = sorted({d for codes in trials.values() for d in codes})
        out[row["id"]] = {
            "all": summary(sorted(trials)),
            "by_disease": {
                d: summary(sorted(n for n, c in trials.items() if d in c)) for d in diseases
            },
        }
    return out


def build_risk_doc(
    tables: Tables,
    extras: Mapping[str, StudyExtras],
    cfg: AreaConfig,
    loaded: Loaded,
    figure: dict[str, Any] | None,
    day: date,
) -> dict[str, Any]:
    """The ``risk.json`` document for ``day`` (see the stop-risk design, section 6.6)."""
    running = tables.trial.filter(pl.col("overall_status").is_in(sorted(RUNNING)))
    drug_types: dict[str, list[str]] = {}
    for r in tables.intervention.iter_rows(named=True):
        drug_types.setdefault(r["nct_id"], []).append(r["type"])

    not_scored: dict[str, str] = {}
    rows: dict[str, dict[str, Any]] = {}
    for r in running.sort("nct_id").iter_rows(named=True):
        nct = r["nct_id"]
        if not in_phase_scope(list(r["phases"] or [])):
            not_scored[nct] = _NOT_PHASE
        elif not has_drug(drug_types.get(nct, [])):
            not_scored[nct] = _NO_DRUG
        else:
            rows[nct] = r

    scored: dict[str, dict[str, Any]] = {}
    if rows:
        fields = {n: x.risk for n, x in extras.items() if x.risk is not None}
        frame = features.build(
            tables,
            fields,
            live_counts(tables.trial, loaded.sponsor_table),
            max_start_year=loaded.card.max_start_year,
        ).filter(pl.col("nct_id").is_in(list(rows)))
        ens = loaded.shipped
        x = artefacts.feature_matrix(frame)
        p, lo, hi = ens.predict(x)
        distinct = len({_r(v) for v in p})
        if len(p) >= DEGENERATE_MIN_TRIALS and distinct < DEGENERATE_MIN_DISTINCT:
            raise ValueError(
                f"degenerate estimates: {len(p)} scored trials share {distinct} distinct "
                "p value(s); the shipped model is broken, not shipping risk.json"
            )
        contrib = contributions(ens, x)
        for i, nct in enumerate(frame["nct_id"].to_list()):
            r = rows[nct]
            rate, basis = typical_rate(loaded.card, list(r["phases"]), r["sponsor_class"])
            scored[nct] = {
                "p": _r(p[i]),
                "lo": _r(lo[i]),
                "hi": _r(hi[i]),
                "typical": _r(rate),
                "basis": basis,
                "factors": top_factors(
                    contrib[i], np.asarray(x[i]), ens.columns, loaded.factor_labels
                ),
            }

    doc: dict[str, Any] = {
        "generated_for": day.isoformat(),
        "model": _model_block(loaded, cfg),
        "not_scored": not_scored,
    }
    if cfg.risk.per_trial:
        doc["trials"] = scored
    if figure is not None:
        doc["targets"] = _targets(figure, scored)
    return doc
