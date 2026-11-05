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
METHOD_KEYS = {"algorithm", "dims", "seed", "features", "k"}
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
    "enrollment",
    "lead_sponsor",
    "start_year",
}
OUTCOMES = {"succeeded", "stopped", "completed_unknown", "running", "unknown"}


def _inputs(cfg: AreaConfig) -> tuple[Tables, dict, list[dict]]:  # type: ignore[type-arg]
    relevant = filter_relevant(day1_studies(cfg), cfg)
    tables = normalize(relevant, cfg.aliases_dir)
    return tables, extract_extras(relevant, cfg), relevant


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
