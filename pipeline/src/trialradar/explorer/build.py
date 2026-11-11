"""Assemble the explorer: features, 3D layout, outcomes and the headline statistic (spec 6.5)."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date
from typing import Any

import numpy as np
import polars as pl

from trialradar.approaches.io import ApproachConfig
from trialradar.approaches.sort import TrialApproaches
from trialradar.config import AreaConfig
from trialradar.explorer.approaches import (
    approach_meta,
    drug_index,
    load_trial_approaches,
    mapping_descriptions,
    mapping_names,
    mapping_types,
)
from trialradar.explorer.clusters import build_clusters
from trialradar.explorer.drugs import clean_drug_name
from trialradar.explorer.extras import StudyExtras, empty_extras
from trialradar.explorer.features import build_features
from trialradar.explorer.layout import align, embed
from trialradar.explorer.mechanisms import (
    TrialMechanisms,
    mechanisms_from,
    read_mappings_or_warn,
)
from trialradar.explorer.outcomes import (
    Outcome,
    TrialDrugs,
    in_pool,
    outcomes_from_success,
    success,
    top_phase,
)
from trialradar.explorer.stats import LiftResult, neighbourhood_lift
from trialradar.mechanisms.io import DrugMapping
from trialradar.store import COORDS_SCHEMA
from trialradar.tables import Tables

FEATURES = ["disease", "treatment_type", "molecule", "mechanism", "population"]
# The neighbourhood statistic asks whether trials that study similar things succeed together, so it
# leaves out the mechanism block (which mechanisms work is panel b's By mechanism view).
STAT_FEATURES = [f for f in FEATURES if f != "mechanism"]
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


@dataclass(frozen=True)
class ExplorerInputs:
    """Everything the layout is computed from, shared by ``build_explorer`` and dev scripts."""

    ids: list[str]
    full: dict[str, StudyExtras]
    drugs: TrialDrugs
    mechs: dict[str, TrialMechanisms]
    types: dict[str, frozenset[str]]
    # names looked up in the drug mapping: drugs plus supplement/genetic/combination names
    names: TrialDrugs
    mappings: dict[str, DrugMapping]
    approaches: dict[str, TrialApproaches]
    approach_cfg: ApproachConfig | None


def explorer_inputs(
    tables: Tables,
    extras: Mapping[str, StudyExtras],
    cfg: AreaConfig,
    aliases: Mapping[str, str],
    warnings: list[str],
) -> ExplorerInputs:
    ids = sorted(tables.trial["nct_id"].to_list())
    full = {nct: extras.get(nct) or empty_extras(nct) for nct in ids}
    drugs = _trial_drugs(ids, full, aliases, cfg)
    extra = mapping_names(full, aliases, cfg)
    names = {nct: drugs[nct] | extra[nct] for nct in ids}
    mappings = read_mappings_or_warn(cfg, warnings)
    approaches, acfg = load_trial_approaches(cfg, full, aliases, warnings, mappings or {})
    kind_keys = frozenset(acfg.kinds) if acfg is not None else frozenset()
    mechs = mechanisms_from(mappings, drugs, warnings, names, kind_keys)
    return ExplorerInputs(
        ids,
        full,
        drugs,
        mechs,
        _intervention_types(tables),
        names,
        mappings or {},
        approaches,
        acfg,
    )


def feature_weights(cfg: AreaConfig) -> dict[str, float]:
    return {str(k): v for k, v in cfg.explorer.weights.items()}


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
    if warnings is None:
        warnings = []
    inp = explorer_inputs(tables, extras, cfg, aliases, warnings)
    ids, full, drugs, mechs, types = inp.ids, inp.full, inp.drugs, inp.mechs, inp.types
    labels = {n: frozenset(full[n].condition_labels) for n in ids}
    # R21 labels, and the drugs that moved on (1b: groups are credited only through them)
    succeeded_in, succeeded_by = success(tables.trial, drugs, labels)
    outcomes: dict[str, Outcome] = outcomes_from_success(tables.trial, succeeded_in)
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
        "stat_features": list(STAT_FEATURES),
        "k": ex.k,
        "min_group": ex.min_group,
        # HDBSCAN parameters and naming thresholds for the named clusters, so Methods can state them
        "clusters": ex.clusters.model_dump(),
    }
    approach_list, kinds = approach_meta(inp.approach_cfg)
    index = drug_index(
        {d for n in ids for d in inp.names[n]},
        inp.mappings,
        inp.approach_cfg,
        mapping_types(full, aliases, cfg),
        mapping_descriptions(full, aliases, cfg),
    )
    file_level = {"approaches": approach_list, "kinds": kinds, "drug_index": index}
    if len(ids) < _MIN_TRIALS:
        n_pool, n_succ = sum(pool), sum(s for s, p in zip(succeeded, pool, strict=True) if p)
        rate = n_succ / n_pool if n_pool else None
        result = LiftResult("insufficient", None, None, None, n_pool, n_succ, rate)
        doc: dict[str, Any] = {
            "generated_for": day.isoformat(),
            "method": method,
            "stats": _stats(result, by_condition),
            "clusters": [],
            "trials": [],
            **file_level,
        }
        return doc, pl.DataFrame(schema=COORDS_SCHEMA)

    # build_features orders rows by sorted id, which is ``ids``.
    weights = feature_weights(cfg)
    features = build_features(ids, full, drugs, types, weights, mechs)
    stat_features = build_features(ids, full, drugs, types, {**weights, "mechanism": 0.0}, mechs)
    result = neighbourhood_lift(
        stat_features.matrix,
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
        r, x, ap = trial_rows[nct], full[nct], inp.approaches[nct]
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
                "mechanisms": list(mechs[nct].mechanisms),
                "targets": list(mechs[nct].targets),
                "modalities": list(mechs[nct].modalities),
                "enrollment": r["enrollment"],
                "lead_sponsor": r["lead_sponsor"],
                "start_year": start.year if start is not None else None,
                "end_year": end.year if end is not None else None,
                "end_estimated": end is not None and end_type == "ESTIMATED",
                "succeeded_in": sorted(succeeded_in[nct]),
                "in_pool": pool[i],
                "approaches": list(ap.approaches),
                "kinds": list(ap.kinds),
                "unsorted": list(ap.unsorted),
                "succeeded_by": sorted(succeeded_by[nct]),
            }
        )
    shorts = {c.label: c.short for c in cfg.conditions if c.short}
    clusters, cluster_of = build_clusters(coords, trials, shorts, ex.clusters)
    for t, cid in zip(trials, cluster_of, strict=True):
        t["cluster"] = cid
    doc = {
        "generated_for": day.isoformat(),
        "method": method,
        "stats": _stats(result, by_condition),
        "clusters": clusters,
        "trials": trials,
        **file_level,
    }
    frame = pl.DataFrame(
        {"nct_id": ids, "x": coords[:, 0], "y": coords[:, 1], "z": coords[:, 2]},
        schema=COORDS_SCHEMA,
    )
    return doc, frame
