"""The explorer document and coordinates frame (spec 6.5)."""

from __future__ import annotations

import json
from datetime import date

import numpy as np
import polars as pl
import pytest
from integration.conftest import day1_studies

from trialradar.config import AreaConfig
from trialradar.explorer.build import build_explorer
from trialradar.explorer.extras import extract_extras
from trialradar.normalize import normalize
from trialradar.relevance import filter_relevant
from trialradar.tables import Tables

DAY = date(2026, 3, 1)
TOP_KEYS = {"generated_for", "method", "stats", "trials"}
METHOD_KEYS = {"algorithm", "dims", "seed", "features", "k", "min_group"}
STATS_KEYS = {
    "verdict",
    "lift",
    "baseline_mean",
    "baseline_range",
    "n_pool",
    "n_succeeded",
    "success_rate",
    "n_averaged",
    "n_short",
    "p_value",
    "by_condition",
}
TRIAL_KEYS = {
    "nct_id",
    "x",
    "y",
    "z",
    "title",
    "condition_labels",
    "phase",
    "outcome",
    "has_results",
    "treatment_types",
    "drugs",
    "mechanisms",
    "targets",
    "modalities",
    "enrollment",
    "lead_sponsor",
    "start_year",
    "end_year",
    "end_estimated",
    "succeeded_in",
    "in_pool",
}
OUTCOMES = {"succeeded", "stopped", "completed_unknown", "running", "unknown"}


def _inputs(cfg: AreaConfig) -> tuple[Tables, dict, list[dict]]:  # type: ignore[type-arg]
    relevant = filter_relevant(day1_studies(cfg), cfg)
    tables = normalize(relevant, cfg.aliases_dir)
    extras, warnings = extract_extras(relevant, cfg)
    assert warnings == []
    return tables, extras, relevant


def test_build_explorer_contract(cfg: AreaConfig) -> None:
    tables, extras, _ = _inputs(cfg)
    doc, coords = build_explorer(tables, extras, cfg, {}, {}, DAY)

    assert set(doc) == TOP_KEYS
    assert doc["generated_for"] == "2026-03-01"
    assert doc["method"] == {
        "algorithm": "umap",
        "dims": 3,
        "seed": cfg.explorer.seed,
        "features": ["disease", "treatment_type", "molecule", "population"],
        "k": cfg.explorer.k,
        "min_group": 10,
    }
    assert set(doc["method"]) == METHOD_KEYS
    stats = doc["stats"]
    assert set(stats) == STATS_KEYS
    assert stats["verdict"] in {"insufficient", "chance", "clustered"}
    assert stats["baseline_range"] is None or len(stats["baseline_range"]) == 2
    assert [r["label"] for r in stats["by_condition"]] == [c.label for c in cfg.conditions]
    for r in stats["by_condition"]:
        assert set(r) == {"label", "finished", "succeeded"}
        assert 0 <= r["succeeded"] <= r["finished"] <= stats["n_pool"]

    trials = doc["trials"]
    ids = sorted(tables.trial["nct_id"].to_list())
    assert [t["nct_id"] for t in trials] == ids
    for t in trials:
        assert set(t) == TRIAL_KEYS
        assert t["outcome"] in OUTCOMES
        assert t["treatment_types"] == sorted(t["treatment_types"])
        assert t["drugs"] == sorted(t["drugs"])
        for axis in "xyz":
            assert isinstance(t[axis], float)
            assert round(t[axis], 4) == t[axis]
        assert t["start_year"] is None or isinstance(t["start_year"], int)
        assert "brief_summary" not in t
        assert t["succeeded_in"] == sorted(t["succeeded_in"])
        assert set(t["succeeded_in"]) <= set(t["condition_labels"])
        assert bool(t["succeeded_in"]) == (t["outcome"] == "succeeded")
        assert isinstance(t["in_pool"], bool)
    assert sum(t["in_pool"] for t in trials) == stats["n_pool"]
    for r in stats["by_condition"]:
        assert r["succeeded"] == sum(
            1 for t in trials if t["in_pool"] and r["label"] in t["succeeded_in"]
        )
    json.dumps(doc, allow_nan=False)  # strict JSON

    assert coords.schema == pl.Schema(
        {"nct_id": pl.Utf8(), "x": pl.Float64(), "y": pl.Float64(), "z": pl.Float64()}
    )
    assert coords["nct_id"].to_list() == ids


def test_trial_row_values(cfg: AreaConfig) -> None:
    tables, extras, _ = _inputs(cfg)
    doc, _ = build_explorer(tables, extras, cfg, {}, {}, DAY)
    row = next(t for t in doc["trials"] if t["nct_id"] == "NCT90000001")
    trial = tables.trial.filter(pl.col("nct_id") == "NCT90000001").row(0, named=True)
    assert row["title"] == trial["title"]
    assert row["enrollment"] == trial["enrollment"]
    assert row["lead_sponsor"] == trial["lead_sponsor"]
    assert row["start_year"] == trial["start_date"].year
    assert row["phase"] == "PHASE2"
    assert row["outcome"] == "running"
    assert row["treatment_types"] == ["DRUG"]
    assert row["drugs"] == ["example drug"]
    assert row["condition_labels"] == list(extras["NCT90000001"].condition_labels)
    assert row["has_results"] is False


def test_coords_are_aligned_to_previous(cfg: AreaConfig) -> None:
    tables, extras, _ = _inputs(cfg)
    _, raw = build_explorer(tables, extras, cfg, {}, {}, DAY)
    shifted = {
        r["nct_id"]: (2 * r["y"] + 1.0, 2 * r["x"] - 3.0, 2 * r["z"])
        for r in raw.iter_rows(named=True)
    }
    doc, coords = build_explorer(tables, extras, cfg, {}, shifted, DAY)
    got = np.array([[r["x"], r["y"], r["z"]] for r in coords.iter_rows(named=True)])
    want = np.array([shifted[i] for i in coords["nct_id"]])
    assert np.abs(got - want).max() < 1e-6
    first = doc["trials"][0]
    assert first["x"] == round(shifted[first["nct_id"]][0], 4)


def test_fewer_than_four_trials_is_insufficient(cfg: AreaConfig) -> None:
    tables, extras, _ = _inputs(cfg)
    keep = sorted(tables.trial["nct_id"].to_list())[:3]
    small = Tables(
        **{
            name: getattr(tables, name).filter(pl.col("nct_id").is_in(keep))
            for name in ("trial", "condition", "intervention", "sponsor", "site", "outcome")
        }
    )
    doc, coords = build_explorer(small, extras, cfg, {}, {}, DAY)
    assert doc["trials"] == []
    assert doc["stats"]["verdict"] == "insufficient"
    assert doc["stats"]["lift"] is None
    assert doc["stats"]["baseline_range"] is None
    assert coords.height == 0
    assert list(coords.columns) == ["nct_id", "x", "y", "z"]


def test_missing_extras_do_not_crash(cfg: AreaConfig) -> None:
    tables, extras, _ = _inputs(cfg)
    partial = {k: v for k, v in extras.items() if k != "NCT90000002"}
    doc, _ = build_explorer(tables, partial, cfg, {}, {}, DAY)
    row = next(t for t in doc["trials"] if t["nct_id"] == "NCT90000002")
    assert row["has_results"] is False
    assert row["condition_labels"] == []
    assert row["drugs"] == []


@pytest.mark.parametrize("weight", [0.0, 1.0])
def test_build_is_deterministic(cfg: AreaConfig, weight: float) -> None:
    tables, extras, _ = _inputs(cfg)
    w = {**cfg.explorer.weights, "population": weight}
    c = cfg.model_copy(update={"explorer": cfg.explorer.model_copy(update={"weights": w})})
    a, _ = build_explorer(tables, extras, c, {}, {}, DAY)
    b, _ = build_explorer(tables, extras, c, {}, {}, DAY)
    assert a == b


def test_pool_needs_an_experimental_drug(cfg: AreaConfig) -> None:
    """R18: finished trials without a cleaned experimental drug are not in the pool."""
    import dataclasses

    tables, extras, _ = _inputs(cfg)
    synthetic = [f"NCT9000000{i}" for i in range(1, 9)]
    trial = tables.trial.with_columns(
        pl.when(pl.col("nct_id").is_in(synthetic))
        .then(pl.lit("COMPLETED"))
        .otherwise(pl.col("overall_status"))
        .alias("overall_status")
    )
    done = dataclasses.replace(tables, trial=trial)
    doc, _ = build_explorer(done, extras, cfg, {}, {}, DAY)
    assert doc["stats"]["n_pool"] == 8
    stripped = dict(extras)
    for nct in synthetic[:3]:
        stripped[nct] = dataclasses.replace(extras[nct], experimental_drugs=())
    doc, _ = build_explorer(done, stripped, cfg, {}, {}, DAY)
    assert doc["stats"]["n_pool"] == 5
    assert all(r["finished"] <= 5 for r in doc["stats"]["by_condition"])
    rows = {t["nct_id"]: t for t in doc["trials"]}
    assert rows[synthetic[0]]["outcome"] == "completed_unknown"
    assert rows[synthetic[0]]["drugs"] == []


def test_end_year_prefers_primary_completion_and_flags_estimates(cfg: AreaConfig) -> None:
    import dataclasses

    tables, extras, _ = _inputs(cfg)
    a, b, c = "NCT90000001", "NCT90000002", "NCT90000003"
    cases = {
        a: (date(2023, 5, 1), "ACTUAL", date(2024, 6, 1), "ACTUAL"),
        b: (None, None, date(2027, 1, 1), "ESTIMATED"),
        c: (None, None, None, None),
    }

    def col(name: str, idx: int) -> pl.Expr:
        expr = pl.col(name)
        for nct, vals in cases.items():
            expr = pl.when(pl.col("nct_id") == nct).then(pl.lit(vals[idx])).otherwise(expr)
        return expr.alias(name)

    trial = tables.trial.with_columns(
        col("primary_completion_date", 0),
        col("primary_completion_date_type", 1),
        col("completion_date", 2),
        col("completion_date_type", 3),
    )
    doc, _ = build_explorer(dataclasses.replace(tables, trial=trial), extras, cfg, {}, {}, DAY)
    rows = {t["nct_id"]: t for t in doc["trials"]}
    assert (rows[a]["end_year"], rows[a]["end_estimated"]) == (2023, False)
    assert (rows[b]["end_year"], rows[b]["end_estimated"]) == (2027, True)
    assert (rows[c]["end_year"], rows[c]["end_estimated"]) == (None, False)


def test_stats_export_p_value(cfg: AreaConfig) -> None:
    tables, extras, _ = _inputs(cfg)
    doc, _ = build_explorer(tables, extras, cfg, {}, {}, DAY)
    assert "p_value" in doc["stats"]
    assert doc["stats"]["p_value"] is None  # insufficient: no test was run


def test_layout_fallback_reaches_the_warning_sink(
    cfg: AreaConfig, monkeypatch: pytest.MonkeyPatch
) -> None:
    import umap

    def broken(self: object, *args: object, **kwargs: object) -> None:
        raise ValueError("no layout")

    monkeypatch.setattr(umap.UMAP, "fit_transform", broken)
    tables, extras, _ = _inputs(cfg)
    sink: list[str] = []
    doc, _ = build_explorer(tables, extras, cfg, {}, {}, DAY, warnings=sink)
    assert any(w.startswith("explorer_layout_fallback: ") for w in sink)
    assert doc["trials"]


def test_build_adds_mechanism_fields_from_the_mapping_dir(cfg: AreaConfig) -> None:
    from pathlib import Path

    mech = Path(__file__).resolve().parents[1] / "fixtures" / "mechanisms"
    cfg = cfg.model_copy(update={"mechanisms_dir": mech})
    tables, extras, _ = _inputs(cfg)
    warnings: list[str] = []
    doc, _ = build_explorer(tables, extras, cfg, {}, {}, DAY, warnings=warnings)
    row = next(t for t in doc["trials"] if t["nct_id"] == "NCT90000001")
    assert row["mechanisms"] == ["anti-CD20"]
    assert row["targets"] == ["MS4A1"]
    assert row["modalities"] == ["antibody"]
    assert doc["method"]["min_group"] == 10
    assert not any(w.startswith("explorer_mechanisms") for w in warnings)


def test_success_is_counted_only_in_the_label_where_the_drug_progressed(cfg: AreaConfig) -> None:
    """R21: a pool trial labelled {MG, CIDP} whose drug progresses only in an MG trial
    succeeds in MG and counts as finished-but-not-succeeded in CIDP."""
    import dataclasses

    mg, cidp = "Myasthenia gravis", "CIDP"
    assert {mg, cidp} <= {c.label for c in cfg.conditions}
    tables, extras, _ = _inputs(cfg)
    a, b = "NCT90000001", "NCT90000002"
    early, late = date(2015, 1, 1), date(2018, 1, 1)
    trial = tables.trial.with_columns(
        pl.when(pl.col("nct_id") == a)
        .then(pl.lit("COMPLETED"))
        .when(pl.col("nct_id") == b)
        .then(pl.lit("RECRUITING"))
        .otherwise(pl.col("overall_status"))
        .alias("overall_status"),
        pl.when(pl.col("nct_id") == a)
        .then(pl.lit(["PHASE2"]))
        .when(pl.col("nct_id") == b)
        .then(pl.lit(["PHASE3"]))
        .otherwise(pl.col("phases"))
        .alias("phases"),
        pl.when(pl.col("nct_id") == a)
        .then(pl.lit(early))
        .when(pl.col("nct_id") == b)
        .then(pl.lit(late))
        .otherwise(pl.col("start_date"))
        .alias("start_date"),
    )
    patched = dict(extras)
    patched[a] = dataclasses.replace(
        extras[a], condition_labels=(mg, cidp), experimental_drugs=("zorbimab",)
    )
    patched[b] = dataclasses.replace(
        extras[b], condition_labels=(mg,), experimental_drugs=("zorbimab",)
    )
    doc, _ = build_explorer(dataclasses.replace(tables, trial=trial), patched, cfg, {}, {}, DAY)

    assert len(doc["trials"]) >= 4  # a real build, not the "insufficient" short-cut
    rows = {t["nct_id"]: t for t in doc["trials"]}
    assert rows[a]["outcome"] == "succeeded"
    assert rows[a]["in_pool"] is True
    assert rows[a]["succeeded_in"] == [mg]
    by = {r["label"]: r for r in doc["stats"]["by_condition"]}
    assert by[mg]["finished"] == 1 and by[mg]["succeeded"] == 1
    assert by[cidp]["finished"] == 1 and by[cidp]["succeeded"] == 0
