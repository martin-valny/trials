"""The v2 trainer, offline, on a synthetic AACT panel (tests/unit/_aact_synth.py)."""

from __future__ import annotations

import importlib.util
import json
import sys
from datetime import date
from pathlib import Path
from typing import Any

import numpy as np
import polars as pl
import pytest
from _aact_synth import CUTOFF_SNAP, DEVICE, FINAL, RELABELLED, VANISHED, SynthTrial, write_panel
from _risk_synth import single_thread  # noqa: F401
from threadpoolctl import threadpool_limits

from trialradar.config import load_config
from trialradar.risk import artefacts
from trialradar.risk.artefacts import Metrics
from trialradar.risk.evaluate import metrics
from trialradar.risk.features_v2 import FEATURES_V2
from trialradar.textnorm import Aliases

_SPEC = importlib.util.spec_from_file_location(
    "train_stop_risk_v2",
    Path(__file__).resolve().parents[2] / "scripts" / "train_stop_risk_v2.py",
)
assert _SPEC and _SPEC.loader
script = importlib.util.module_from_spec(_SPEC)
sys.modules[_SPEC.name] = script  # dataclasses resolve their module through sys.modules
_SPEC.loader.exec_module(script)

V1_DIR = Path(__file__).resolve().parents[3] / "config" / "risk"
CONFIG = Path(__file__).resolve().parents[3] / "config" / "area.yaml"


def _m(auc: float, brier: float) -> Metrics:
    return Metrics(auc=auc, brier=brier, n=100, positives=20, calibration=[])


SHIPPABLE = [f for f in FEATURES_V2 if f not in script.SPONSOR_FEATURES]


GATE_OK: dict[str, Any] = {"v1_committed": _m(0.60, 0.20), "v2_on_v1_subset": _m(0.80, 0.10)}
"""A passing second gate (v2 on the published v1's subset well ahead of the published v1)."""


def _par(**over: float) -> dict[str, float]:
    """A parity result with every shippable feature at 0 mismatch, then `over`."""
    return {**dict.fromkeys(SHIPPABLE, 0.0), **over}


@pytest.fixture(scope="module")
def panel(tmp_path_factory: pytest.TempPathFactory) -> tuple[Path, list[SynthTrial]]:
    p = tmp_path_factory.mktemp("panel")
    return p, write_panel(p)


PARITY_META = {"as_of": "2026-11-15", "n_trials": 300, "seed": 7, "unchanged": 280}


@pytest.fixture(scope="module")
def trained(panel: tuple[Path, list[SynthTrial]], tmp_path_factory: pytest.TempPathFactory) -> Path:
    out = tmp_path_factory.mktemp("out")
    parity = out.parent / "parity.json"
    shares: dict[str, Any] = dict.fromkeys(FEATURES_V2, 0.0)
    shares["sponsor_prior_n"] = 0.3  # exempt: sponsor counts differ by design
    shares["exempt"] = ["log_enrollment"]  # ignored: the exempt set is fixed in code
    parity.write_text(json.dumps(shares))
    (out.parent / "parity.meta.json").write_text(json.dumps(PARITY_META))
    argv = ["--panel", str(panel[0]), "--out", str(out), "--n-boot", "2"]
    argv += ["--v1-dir", str(V1_DIR), "--parity", str(parity)]
    with threadpool_limits(1):  # module scope: the autouse single_thread fixture is not active
        assert script.main(argv) == 0
    return out


# --- the bar ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("v2", "v1", "parity", "ships"),
    [
        (_m(0.719, 0.15), _m(0.70, 0.15), _par(), False),  # AUC +0.019
        (_m(0.72, 0.1501), _m(0.70, 0.15), _par(), False),  # +0.02, Brier worse
        (_m(0.72, 0.15), _m(0.70, 0.15), _par(), True),  # +0.02, Brier equal
        (_m(0.73, 0.14), _m(0.71, 0.15), _par(), True),  # +0.02 in float arithmetic
        (_m(0.80, 0.10), _m(0.70, 0.15), _par(log_enrollment=0.011), False),  # parity fails
        (_m(0.80, 0.10), _m(0.70, 0.15), _par(age_months=0.01, sponsor_prior_n=0.5), True),
        (_m(0.80, 0.10), _m(0.70, 0.15), None, False),  # parity not run
    ],
)
def test_bar_rule(v2: Metrics, v1: Metrics, parity: dict[str, float] | None, ships: bool) -> None:
    base = _m(0.60, 0.20)  # boosted clearly beats the v2 baseline
    d = script.decide(base, v2, v1, parity, **GATE_OK)
    assert d.recipe == "boosted"
    assert d.v2_ships is ships
    assert ("v2 replaces v1" if ships else "v1 stays live") in d.reason
    if parity is None:
        assert "parity not run" in d.reason


def test_bar_within_v2_falls_back_to_baseline_and_compares_it() -> None:
    base, boost = _m(0.70, 0.15), _m(0.719, 0.14)  # boosted +0.019 only
    d = script.decide(base, boost, _m(0.60, 0.20), _par(), **GATE_OK)
    assert d.recipe == "baseline"
    assert d.v2_ships is True  # the v2 baseline itself beats v1-recipe
    assert "0.700" in d.reason and "0.600" in d.reason


@pytest.mark.parametrize(
    ("sub", "pub", "ships", "text"),
    [
        (_m(0.72, 0.15), _m(0.70, 0.15), True, "at least 0.02 AUC better"),  # pass, Brier equal
        (_m(0.73, 0.14), _m(0.71, 0.15), True, "at least 0.02 AUC better"),  # +0.02 in floats
        (_m(0.719, 0.14), _m(0.70, 0.15), False, "not 0.02 AUC better"),  # AUC short
        (_m(0.75, 0.1501), _m(0.70, 0.15), False, "not 0.02 AUC better"),  # Brier worse
        (_m(0.75, 0.10), None, False, "published v1 not scored"),  # v1 dir missing
    ],
)
def test_second_gate_against_published_v1(
    sub: Metrics, pub: Metrics | None, ships: bool, text: str
) -> None:
    # the first gate and parity pass comfortably; only the published-v1 gate varies
    d = script.decide(
        _m(0.60, 0.20), _m(0.80, 0.10), _m(0.60, 0.20), _par(),
        v1_committed=pub, v2_on_v1_subset=sub,
    )  # fmt: skip
    assert d.v2_ships is ships
    assert text in d.reason
    assert ("v2 replaces v1" if ships else "v1 stays live") in d.reason
    assert "v1-recipe AUC 0.600" in d.reason  # both comparisons are named with their numbers
    if pub is not None:
        assert f"published v1 AUC {pub.auc:.3f}, Brier {pub.brier:.4f}" in d.reason
        assert f"v2 AUC {sub.auc:.3f}, Brier {sub.brier:.4f}" in d.reason


def test_parity_missing_feature_fails() -> None:
    parity = _par()
    del parity["months_since_update"], parity["n_sites"]
    d = script.decide(_m(0.6, 0.2), _m(0.9, 0.05), _m(0.6, 0.2), parity, **GATE_OK)
    assert d.v2_ships is False
    assert "parity missing n_sites, months_since_update" in d.reason


def test_read_parity_ignores_file_exempt_and_rejects_bad_shares(tmp_path: Path) -> None:
    path = tmp_path / "parity.json"
    path.write_text(json.dumps({**_par(log_enrollment=0.5), "exempt": ["log_enrollment"]}))
    parity = script.read_parity(path)
    assert "exempt" not in parity
    ok, text = script.parity_result(parity)
    assert not ok and "log_enrollment" in text
    for bad in (-0.1, "0.0", True, None, float("inf")):
        path.write_text(json.dumps({"n_sites": bad}).replace("Infinity", "1e999"))
        with pytest.raises(ValueError, match="n_sites"):
            script.read_parity(path)


def test_v1_recipe_rule_picks_like_v1() -> None:
    assert script.pick_recipe(_m(0.60, 0.15), _m(0.619, 0.14), "v1-recipe")[0] == "baseline"
    assert script.pick_recipe(_m(0.60, 0.15), _m(0.62, 0.1501), "v1-recipe")[0] == "baseline"
    recipe, reason = script.pick_recipe(_m(0.60, 0.15), _m(0.62, 0.15), "v1-recipe")
    assert recipe == "boosted" and "0.620" in reason and "0.600" in reason


# --- pieces ----------------------------------------------------------------------------


def test_sponsor_counts_use_trials_ended_before_the_snapshot() -> None:
    trial = pl.DataFrame(
        {
            "nct_id": ["A", "B", "C", "D", "E"],
            "lead_sponsor": ["S", "S", "S", "S", "T"],
            "overall_status": ["TERMINATED", "COMPLETED", "COMPLETED", "RECRUITING", "COMPLETED"],
            "completion_date": [date(2020, 1, 1), date(2021, 1, 1), date(2022, 1, 1), None, None],
            "primary_completion_date": [None, None, None, None, date(2020, 6, 1)],
            "start_date": [date(2010, 1, 1)] * 5,
        }
    )
    got = script.sponsor_counts_as_of(trial, date(2021, 6, 1)).sort("nct_id")
    # S: A and B ended before 2021-06-01 (C ends after it, D is running); T: E.
    assert got["sponsor_prior_n"].to_list() == [2, 2, 2, 2, 1]
    assert got["sponsor_prior_stopped"].to_list() == [1, 1, 1, 1, 0]


def test_v1_recipe_uses_records_before_cutoff(panel: tuple[Path, list[SynthTrial]]) -> None:
    path, ts = panel
    col = script.collect(path, Aliases.empty())
    sites = {t.nct: t.n_sites for t in ts}
    v1_train, v1_test = script.v1_frames(col)
    assert v1_train.height > 0
    assert set(v1_train["snapshot_date"].to_list()) == {CUTOFF_SNAP}
    # every trial lists one more site in the outcome snapshot: the v1-recipe must not see it
    for nct, n in v1_train.select("nct_id", "n_sites").iter_rows():
        assert n == sites[nct]
    assert set(v1_test["snapshot_date"].to_list()) == {CUTOFF_SNAP}
    for nct, n in v1_test.select("nct_id", "n_sites").iter_rows():
        assert n == sites[nct]
    # trained on the same trials as v2's C-recipe
    assert set(v1_train["nct_id"].to_list()) == set(col.train.keys["nct_id"].to_list())


def test_all_null_guard() -> None:
    frame = pl.DataFrame({"a": [None, None], "b": [1.0, None], "c": [float("nan")] * 2})
    assert script.all_null(frame, ["a", "b", "c"]) == ["a", "c"]


def test_in_area_uses_conditions_and_direct_mesh_only(
    panel: tuple[Path, list[SynthTrial]],
) -> None:
    path, ts = panel
    ids = [t.nct for t in ts]
    want = {t.nct for t in ts if t.nct[-1] in "035"}
    # C: mesh_type null (old archive, direct terms only)
    assert script.in_area_ids(path, CUTOFF_SNAP, ids, load_config(CONFIG)) == want
    # final: digit 7 has "Multiple Sclerosis" only as an ancestor, which does not count
    final = script.in_area_ids(path, FINAL, ids, load_config(CONFIG))
    assert {n for n in final if n[-1] == "7"} == set()


def test_categories_come_from_the_final_snapshot(panel: tuple[Path, list[SynthTrial]]) -> None:
    col = script.collect(panel[0], Aliases.empty())
    early = col.v2.filter(pl.col("snapshot_date") < CUTOFF_SNAP)
    assert early.height > 0
    # earlier snapshots have no mesh_type, yet categories (incl. an ancestor's) are filled
    assert early["cat_neoplasms"].min() == 1
    assert early["cat_nervous_system_diseases"].min() == 1


def test_rows_align_by_key(panel: tuple[Path, list[SynthTrial]]) -> None:
    col = script.collect(panel[0], Aliases.empty())
    train = script.with_features(col.train, col.v2)
    assert train.height == col.train.keys.height
    assert train.select("nct_id", "snapshot_date", "weight", "label").equals(col.train.keys)
    ended = {t.nct for t in panel[1] if t.end and t.end <= CUTOFF_SNAP}
    assert set(train["nct_id"].to_list()) <= ended
    assert RELABELLED not in set(train["nct_id"].to_list())
    assert VANISHED not in set(train["nct_id"].to_list())
    assert DEVICE not in set(col.v2["nct_id"].to_list())


# --- end to end ------------------------------------------------------------------------


def test_end_to_end_writes_artefacts(trained: Path) -> None:
    for name in (
        "model.joblib",
        "card.json",
        "heldout.parquet",
        "sponsor_history.csv",
        "factor_labels.csv",
    ):
        assert (trained / name).exists(), name
    loaded = artefacts.load(trained)
    card = loaded.card
    assert card.version.startswith("stop-risk-v2-")
    assert card.feature_set == "v2"
    assert card.features == list(FEATURES_V2)
    assert card.max_start_year is None
    assert card.data_source is not None
    assert "AACT" in card.data_source and "ClinicalTrials.gov" in card.data_source
    assert FINAL.isoformat() in card.data_source
    assert "sponsor_counts" in card.filter
    assert card.filter["train_drops"] == {"unlabelled": 1, "relabelled": 1}
    c = card.comparison
    assert c is not None
    assert c.cutoff == CUTOFF_SNAP.isoformat() and c.outcome_snapshot == FINAL.isoformat()
    assert c.v1_committed is not None  # synthetic trials started 2020+ are running at C
    assert c.v2_on_v1_subset is not None
    assert (c.v2_on_v1_subset.n, c.v2_on_v1_subset.positives) == (
        c.v1_committed.n,
        c.v1_committed.positives,
    )
    assert "published v1" in c.reason
    # the published v1 AUC Methods quotes: the committed v1 card's shipped kind
    v1_card = artefacts.Card.model_validate_json((V1_DIR / "card.json").read_text())
    assert c.v1_published_auc == getattr(v1_card.metrics, v1_card.shipped).auc
    assert c.v1_published_auc is not None
    # the planted planned-enrollment signal is visible to v2 only (v1 has no enrollment)
    assert c.v2.auc is not None and c.v1_recipe.auc is not None
    assert c.v2.auc > c.v1_recipe.auc + 0.1
    for m in (c.v1_recipe, c.v2_baseline, c.v2, c.v2_history, c.v2_no_sites):
        assert m.n == card.n_test
    assert c.test_exclusions["running"] > 0 and c.test_exclusions["withdrawn"] > 0
    assert c.train_trials == card.n_train and c.train_rows > c.train_trials
    assert sum(v for k, v in c.train_age_mix.items() if k.startswith("age ")) == c.train_rows
    assert sum(v for k, v in c.train_age_mix.items() if k.startswith("start ")) == c.train_trials
    assert set(c.calibration_by_age) <= {"<12", "12-36", "36-72", ">=72"}
    assert c.parity is not None and c.parity["sponsor_prior_n"] == 0.3
    assert card.filter["parity_exempt"] == sorted(script.SPONSOR_FEATURES)
    assert card.filter["parity_meta"] == PARITY_META  # provenance of the parity shares
    # spec 8: the card records the old (v1) typical rates beside the new ones
    v1_typical = artefacts.Card.model_validate_json((V1_DIR / "card.json").read_text()).typical
    assert card.filter["typical_v1"] == [t.model_dump() for t in v1_typical]
    assert {"phase", "sponsor", "rate", "n"} == set(card.filter["typical_v1"][0])
    # the card's decision is exactly the bar applied to the card's own numbers
    d = script.decide(
        c.v2_baseline,
        c.v2,
        c.v1_recipe,
        c.parity,
        v1_committed=c.v1_committed,
        v2_on_v1_subset=c.v2_on_v1_subset,
    )
    assert (d.recipe, d.v2_ships, d.reason) == (card.shipped, c.v2_ships, c.reason)
    assert card.metrics.boosted == c.v2 and card.metrics.baseline == c.v2_baseline
    assert {t.phase for t in card.typical} >= {"all", "phase 1", "phase 2", "phase 3"}
    # v1-recipe: v1's own rule picked between its two fits; the chosen one is the "before"
    f = card.filter
    assert f["v1_recipe_chosen"] in {"baseline", "boosted"}
    assert c.v1_recipe.model_dump() == f[f"v1_recipe_{f['v1_recipe_chosen']}"]
    assert script.pick_recipe(
        Metrics(**f["v1_recipe_baseline"]), Metrics(**f["v1_recipe_boosted"]), "v1-recipe"
    ) == (f["v1_recipe_chosen"], f["v1_recipe_reason"])
    assert f["phases"] == ["PHASE1", "PHASE1/PHASE2", "PHASE2", "PHASE2/PHASE3", "PHASE3"]
    assert "final snapshot's MeSH" in f["condition_categories"]
    assert "no keywords" in f["in_area"]
    assert f["history_coverage"] == ["2020-12-01", "2021-12-01"]
    assert f["v1_recipe_in_area"] is not None
    assert card.metrics.in_area is not None and 0 < card.metrics.in_area.n < card.n_test


def test_card_metrics_reproduce_from_saved_model(trained: Path) -> None:
    loaded = artefacts.load(trained)
    held = pl.read_parquet(trained / "heldout.parquet")
    p, _, _ = loaded.eval.predict(artefacts.feature_matrix(held, loaded.card.features))
    got = metrics(held["label"].to_numpy(), p)
    want = getattr(loaded.card.metrics, loaded.card.shipped)
    assert got["auc"] == pytest.approx(want.auc, abs=1e-9)
    assert got["brier"] == pytest.approx(want.brier, abs=1e-9)
    mask = held["in_area"].to_numpy()
    assert loaded.card.metrics.in_area is not None
    sub = metrics(held["label"].to_numpy()[mask], p[mask])
    assert sub["auc"] == pytest.approx(loaded.card.metrics.in_area.auc, abs=1e-9)
    assert sub["brier"] == pytest.approx(loaded.card.metrics.in_area.brier, abs=1e-9)
    assert sub["n"] == loaded.card.metrics.in_area.n
    p_ship = loaded.shipped.main.predict_proba(artefacts.feature_matrix(held, FEATURES_V2))
    assert len(np.unique(p_ship)) > 5


def test_heldout_has_no_ids_or_text(trained: Path) -> None:
    held = pl.read_parquet(trained / "heldout.parquet")
    assert held.columns == [*FEATURES_V2, "label", "in_area"]
    assert held.height > 0
    assert held["in_area"].dtype == pl.Boolean and held["in_area"].any()
    assert all(dt.is_numeric() for dt in held.drop("in_area").dtypes)


def test_parity_meta_is_optional(tmp_path: Path) -> None:
    parity = tmp_path / "parity.json"
    parity.write_text("{}")
    assert script.read_parity_meta(parity) is None
    (tmp_path / "parity.meta.json").write_text(json.dumps(PARITY_META))
    assert script.read_parity_meta(parity) == PARITY_META


def test_collect_fails_fast_on_cutoff_gap(
    panel: tuple[Path, list[SynthTrial]], tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A cutoff snapshot more than 31 days from CUTOFF stops the run before any snapshot is
    loaded."""
    from datetime import timedelta

    loads: list[date] = []
    monkeypatch.setattr(script, "CUTOFF", CUTOFF_SNAP + timedelta(days=200))
    monkeypatch.setattr(script, "load_snapshot", lambda *a, **k: loads.append(a[1]))
    with pytest.raises(ValueError, match="no snapshot within 31 days"):
        script.collect(panel[0], Aliases.empty())
    assert loads == []
