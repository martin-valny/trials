"""The explorer document and coordinates frame (spec 6.5)."""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

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
TOP_KEYS = {
    "generated_for",
    "method",
    "stats",
    "clusters",
    "trials",
    "approaches",
    "kinds",
    "drug_index",
}
METHOD_KEYS = {
    "algorithm",
    "dims",
    "seed",
    "features",
    "stat_features",
    "k",
    "min_group",
    "clusters",
}
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
    "cluster",
    "approaches",
    "kinds",
    "unsorted",
    "succeeded_by",
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
        "features": ["disease", "treatment_type", "molecule", "mechanism", "population"],
        "k": cfg.explorer.k,
        "min_group": 10,
        "stat_features": ["disease", "treatment_type", "molecule", "population"],
        "clusters": cfg.explorer.clusters.model_dump(),
    }
    assert doc["method"]["clusters"]["mechanism_min_overall"] == 0.25
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
    assert doc["clusters"] == []
    assert doc["stats"]["verdict"] == "insufficient"
    assert set(doc) == TOP_KEYS
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


def test_small_fixture_has_no_clusters_and_null_cluster_everywhere(cfg: AreaConfig) -> None:
    """Review Focus 4: fewer trials than ``min_cluster_size`` → no clusters, every cluster null."""
    tables, extras, _ = _inputs(cfg)
    assert tables.trial.height < cfg.explorer.clusters.min_cluster_size
    doc, _ = build_explorer(tables, extras, cfg, {}, {}, DAY)
    assert doc["trials"]
    assert doc["clusters"] == []
    assert all(t["cluster"] is None for t in doc["trials"])


def test_clusters_reach_the_document(cfg: AreaConfig) -> None:
    """With a tiny ``min_cluster_size`` the fixture forms clusters; ids and anchors line up."""
    tables, extras, _ = _inputs(cfg)
    small = cfg.explorer.clusters.model_copy(update={"min_cluster_size": 2, "min_samples": 1})
    c = cfg.model_copy(update={"explorer": cfg.explorer.model_copy(update={"clusters": small})})
    doc, _ = build_explorer(tables, extras, c, {}, {}, DAY)
    clusters = doc["clusters"]
    assert clusters
    ids = {k["id"] for k in clusters}
    for k in clusters:
        assert set(k) == {"id", "label", "kind", "n", "x", "y", "z"}
        assert k["kind"] in {"mechanism", "type", "mixed"}
        assert k["label"]
        members = [t for t in doc["trials"] if t["cluster"] == k["id"]]
        assert k["n"] == len(members)
        assert (k["x"], k["y"], k["z"]) in {(t["x"], t["y"], t["z"]) for t in members}
    assert all(t["cluster"] is None or t["cluster"] in ids for t in doc["trials"])
    json.dumps(doc, allow_nan=False)


def test_statistic_leaves_out_the_mechanism_block_the_layout_keeps_it(
    cfg: AreaConfig, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Martin's call: the neighbourhood statistic asks whether trials that study similar things
    (disease, treatment type, molecule, population) succeed together, so it runs on features with
    the mechanism weight forced to 0; the layout keeps the mechanism block."""
    import trialradar.explorer.build as b

    built: list[tuple[float, object]] = []
    real_features = b.build_features

    def spy_features(*args, **kwargs):  # type: ignore[no-untyped-def]
        f = real_features(*args, **kwargs)
        weights = args[4] if len(args) > 4 else kwargs["weights"]
        built.append((weights["mechanism"], f))
        return f

    seen: dict[str, object] = {}
    real_lift, real_embed = b.neighbourhood_lift, b.embed

    def spy_lift(matrix, *a, **k):  # type: ignore[no-untyped-def]
        seen["lift"] = matrix
        return real_lift(matrix, *a, **k)

    def spy_embed(features, *a, **k):  # type: ignore[no-untyped-def]
        seen["embed"] = features
        return real_embed(features, *a, **k)

    monkeypatch.setattr(b, "build_features", spy_features)
    monkeypatch.setattr(b, "neighbourhood_lift", spy_lift)
    monkeypatch.setattr(b, "embed", spy_embed)
    tables, extras, _ = _inputs(cfg)
    build_explorer(tables, extras, cfg, {}, {}, DAY)
    by_weight = dict(built)
    assert set(by_weight) == {0.0, cfg.explorer.weights["mechanism"]}
    assert cfg.explorer.weights["mechanism"] > 0
    assert seen["lift"] is by_weight[0.0].matrix  # type: ignore[attr-defined]
    assert seen["embed"] is by_weight[cfg.explorer.weights["mechanism"]]


def test_statistic_is_unchanged_when_only_mechanism_data_changes(cfg: AreaConfig) -> None:
    from pathlib import Path

    mech = Path(__file__).resolve().parents[1] / "fixtures" / "mechanisms"
    with_mech = cfg.model_copy(update={"mechanisms_dir": mech})
    without = cfg.model_copy(update={"mechanisms_dir": mech / "absent"})
    tables, extras, _ = _inputs(cfg)
    doc_a, _ = build_explorer(tables, extras, with_mech, {}, {}, DAY, warnings=[])
    doc_b, _ = build_explorer(tables, extras, without, {}, {}, DAY, warnings=[])
    assert any(t["mechanisms"] for t in doc_a["trials"])
    assert not any(t["mechanisms"] for t in doc_b["trials"])
    assert doc_a["stats"] == doc_b["stats"]


APPROACH_FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "approaches"
MECH_FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "mechanisms"


def test_explorer_trial_has_approach_fields(cfg: AreaConfig) -> None:
    from trialradar.approaches.io import APPROACH_LABELS, APPROACHES

    c = cfg.model_copy(
        update={"mechanisms_dir": MECH_FIXTURES, "approaches_dir": APPROACH_FIXTURES}
    )
    tables, extras, _ = _inputs(c)
    warnings: list[str] = []
    doc, _ = build_explorer(tables, extras, c, {}, {}, DAY, warnings=warnings)
    assert not any(w.startswith("approaches:") for w in warnings)
    assert doc["approaches"] == [{"key": k, "label": APPROACH_LABELS[k]} for k in APPROACHES]
    assert set(doc["kinds"]["msc"]) == {"approach", "group", "label", "rationale", "source_url"}
    assert doc["kinds"]["msc"]["approach"] == "cell"
    keys = {a["key"] for a in doc["approaches"]}
    for t in doc["trials"]:
        assert t["approaches"], t["nct_id"]  # Unclassified counts
        assert set(t["approaches"]) <= keys
        assert t["approaches"] == [a for a in APPROACHES if a in t["approaches"]]
        assert set(t["kinds"]) <= set(doc["kinds"])
        for f in ("kinds", "unsorted", "succeeded_by"):
            assert t[f] == sorted(t[f])
        assert set(t["succeeded_by"]) <= set(t["drugs"])
        assert bool(t["succeeded_by"]) == (t["outcome"] == "succeeded")
        assert not set(t["mechanisms"]) & set(doc["kinds"])
    row = next(t for t in doc["trials"] if t["nct_id"] == "NCT90000001")
    assert row["approaches"] == ["targeted"]  # example drug is anti-CD20 in the fixture
    json.dumps(doc, allow_nan=False)


def test_drug_index_covers_trial_drugs(cfg: AreaConfig) -> None:
    c = cfg.model_copy(
        update={"mechanisms_dir": MECH_FIXTURES, "approaches_dir": APPROACH_FIXTURES}
    )
    tables, extras, _ = _inputs(c)
    doc, _ = build_explorer(tables, extras, c, {}, {}, DAY)
    idx = doc["drug_index"]
    names = {d for t in doc["trials"] for d in t["drugs"]}
    assert names and names <= set(idx)
    for entry in idx.values():
        assert set(entry) == {"mechanisms", "modalities", "kinds", "approaches"}
    assert idx["example drug"]["mechanisms"] == ["anti-CD20"]
    assert idx["example drug"]["approaches"] == ["targeted"]


def test_missing_approach_files_degrade(cfg: AreaConfig, tmp_path: Path) -> None:
    """Review focus 4: the map builds, approaches empty, one ``approaches:`` warning."""
    c = cfg.model_copy(update={"mechanisms_dir": MECH_FIXTURES, "approaches_dir": tmp_path})
    tables, extras, _ = _inputs(c)
    warnings: list[str] = []
    doc, _ = build_explorer(tables, extras, c, {}, {}, DAY, warnings=warnings)
    assert doc["trials"]
    for t in doc["trials"]:
        assert t["approaches"] == [] and t["kinds"] == [] and t["unsorted"] == []
    assert doc["approaches"] == [] and doc["kinds"] == {}
    assert [w for w in warnings if w.startswith("approaches:")] == [
        next(w for w in warnings if w.startswith("approaches:"))
    ]
    # the mechanism data still works without the approach files
    row = next(t for t in doc["trials"] if t["nct_id"] == "NCT90000001")
    assert row["mechanisms"] == ["anti-CD20"]


def test_collision_degrades(cfg: AreaConfig, tmp_path: Path) -> None:
    import shutil

    approaches = tmp_path / "approaches"
    shutil.copytree(APPROACH_FIXTURES, approaches)
    mech = tmp_path / "mechanisms"
    mech.mkdir()
    (mech / "drugs.csv").write_text(
        "drug,status,chembl_id,modality,mechanism_class,mechanism,action_type,targets\n"
        "example drug,manual,,antibody,msc,,,MS4A1\n",
        encoding="utf-8",
    )
    c = cfg.model_copy(update={"mechanisms_dir": mech, "approaches_dir": approaches})
    tables, extras, _ = _inputs(c)
    warnings: list[str] = []
    doc, _ = build_explorer(tables, extras, c, {}, {}, DAY, warnings=warnings)
    assert sum(w.startswith("approaches:") for w in warnings) == 1
    assert all(t["approaches"] == [] and t["kinds"] == [] for t in doc["trials"])
    assert doc["approaches"] == [] and doc["kinds"] == {}


def test_supplement_mechanism_reaches_trial(cfg: AreaConfig, tmp_path: Path) -> None:
    """A vitamin D supplement mapped to VDR reaches ``mechanisms``/``targets`` but never
    ``drugs`` or the pool."""
    import dataclasses

    from trialradar.explorer.extras import ExperimentalIntervention

    mech = tmp_path / "mechanisms"
    mech.mkdir()
    (mech / "drugs.csv").write_text(
        (MECH_FIXTURES / "drugs.csv").read_text(encoding="utf-8")
        + "vitamin d,manual,,small molecule,VDR agonist,,AGONIST,VDR\n",
        encoding="utf-8",
    )
    (mech / "overrides.csv").write_text(
        (MECH_FIXTURES / "overrides.csv").read_text(encoding="utf-8"), encoding="utf-8"
    )
    c = cfg.model_copy(update={"mechanisms_dir": mech, "approaches_dir": APPROACH_FIXTURES})
    tables, extras, _ = _inputs(c)
    base, _ = build_explorer(tables, extras, c, {}, {}, DAY)
    nct = "NCT90000002"
    patched = dict(extras)
    patched[nct] = dataclasses.replace(
        extras[nct],
        experimental_interventions=(
            *extras[nct].experimental_interventions,
            ExperimentalIntervention("DIETARY_SUPPLEMENT", "Vitamin D", ""),
        ),
    )
    doc, _ = build_explorer(tables, patched, c, {}, {}, DAY)
    row = next(t for t in doc["trials"] if t["nct_id"] == nct)
    assert "VDR agonist" in row["mechanisms"]
    assert "VDR" in row["targets"]
    assert "vitamin d" not in row["drugs"]
    assert "vitamin d" in doc["drug_index"]
    assert [t["in_pool"] for t in doc["trials"]] == [t["in_pool"] for t in base["trials"]]
    assert doc["stats"] == base["stats"]


def test_no_experimental_arm_fallback_changes_only_the_approaches(
    cfg: AreaConfig, tmp_path: Path
) -> None:
    """Sorting a trial with no experimental arm by all its interventions leaves drugs,
    the pool, success and the statistic as they were."""
    import dataclasses

    from trialradar.explorer.extras import ExperimentalIntervention

    c = cfg.model_copy(update={"approaches_dir": APPROACH_FIXTURES})
    tables, extras, _ = _inputs(c)
    nct = "NCT90000002"
    stripped = dict(extras)
    stripped[nct] = dataclasses.replace(
        extras[nct],
        experimental_drugs=(),
        experimental_interventions=(),
        fallback_interventions=(),
    )
    patched = dict(stripped)
    patched[nct] = dataclasses.replace(
        stripped[nct],
        fallback_interventions=(ExperimentalIntervention("DEVICE", "Wristband", ""),),
    )
    base, _ = build_explorer(tables, stripped, c, {}, {}, DAY)
    doc, _ = build_explorer(tables, patched, c, {}, {}, DAY)
    b = next(t for t in base["trials"] if t["nct_id"] == nct)
    row = next(t for t in doc["trials"] if t["nct_id"] == nct)
    assert b["approaches"] == ["unclassified"]
    assert row["approaches"] == ["nondrug"]
    for key in ("drugs", "in_pool", "outcome", "mechanisms", "targets", "modalities"):
        assert row[key] == b[key]
    assert doc["stats"] == base["stats"]
    assert [t["in_pool"] for t in doc["trials"]] == [t["in_pool"] for t in base["trials"]]
