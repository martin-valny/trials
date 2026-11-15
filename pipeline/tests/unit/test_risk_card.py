"""CI evaluation check: the committed model reproduces the committed card's metrics."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import polars as pl
import pytest
from pydantic import ValidationError

from trialradar.risk import artefacts
from trialradar.risk.artefacts import Card
from trialradar.risk.evaluate import metrics

RISK_DIR = Path(__file__).resolve().parents[3] / "config" / "risk"
pytestmark = pytest.mark.skipif(
    not (RISK_DIR / "card.json").exists(), reason="no committed risk card yet (Task 5)"
)


def test_committed_metrics_reproduce() -> None:
    loaded = artefacts.load(RISK_DIR)
    heldout = pl.read_parquet(RISK_DIR / "heldout.parquet")
    p, _, _ = loaded.eval.predict(artefacts.feature_matrix(heldout, loaded.card.features))
    y = heldout["label"].to_numpy()
    got = metrics(y, p)
    want = getattr(loaded.card.metrics, loaded.card.shipped)
    assert got["auc"] == pytest.approx(want.auc, abs=1e-6)
    assert got["brier"] == pytest.approx(want.brier, abs=1e-6)
    mask = heldout["in_area"].to_numpy()
    if loaded.card.metrics.in_area is None:
        return
    sub = metrics(y[mask], p[mask])
    assert sub["auc"] == pytest.approx(loaded.card.metrics.in_area.auc, abs=1e-6)
    assert sub["brier"] == pytest.approx(loaded.card.metrics.in_area.brier, abs=1e-6)


def test_committed_card_matches_model_version() -> None:
    loaded = artefacts.load(RISK_DIR)  # raises on a card/model version mismatch
    assert loaded.card.version.startswith("stop-risk-")


def test_shipped_main_is_not_degenerate() -> None:
    """The shipped ensemble's main (refit on all years) ranks the held-out trials.

    It saw the test years, so its AUC there should be at least the eval model's; a flat
    isotonic map once made it output one value for every trial while this card still passed.
    """
    loaded = artefacts.load(RISK_DIR)
    heldout = pl.read_parquet(RISK_DIR / "heldout.parquet")
    x = artefacts.feature_matrix(heldout, loaded.card.features)
    y = heldout["label"].to_numpy()
    p_ship = loaded.shipped.main.predict_proba(x)
    p_eval = loaded.eval.main.predict_proba(x)
    # Isotonic output is a step function: the healthy eval main gives ~60 levels on these
    # rows and the shipped one ~100; the broken one gave 2.
    assert len(np.unique(p_ship)) > 50
    shipped_auc, eval_auc = metrics(y, p_ship)["auc"], metrics(y, p_eval)["auc"]
    assert shipped_auc is not None and eval_auc is not None
    assert shipped_auc >= eval_auc - 0.02


def test_card_v2_validates_and_v1_card_still_loads() -> None:
    """The v2 fields are optional: the committed v1 card validates unchanged and reads as v1."""
    raw = json.loads((RISK_DIR / "card.json").read_text())
    v1 = Card.model_validate_json(json.dumps(raw))
    assert v1.feature_set == "v1" and v1.comparison is None and v1.data_source is None
    assert isinstance(v1.max_start_year, int)

    m = raw["metrics"]["boosted"]
    comparison = {
        "cutoff": "2021-12-01",
        "outcome_snapshot": "2026-01-15",
        "v1_recipe": m,
        "v1_committed": None,
        "v2_baseline": m,
        "v2": m,
        "v2_history": m,
        "v2_no_sites": m,
        "test_exclusions": {"running": 10, "withdrawn": 2},
        "train_trials": 100,
        "train_rows": 250,
        "train_age_mix": {"age <12": 40, "start 2019": 100},
        "calibration_by_age": {"<12": [{"p": 0.1, "observed": 0.12, "n": 40}]},
        "parity": None,
        "v2_ships": False,
        "reason": "parity not run",
    }
    v2 = Card.model_validate_json(
        json.dumps(
            {
                **raw,
                "version": "stop-risk-v2-20261115",
                "feature_set": "v2",
                "max_start_year": None,
                "comparison": comparison,
                "data_source": "ClinicalTrials.gov via AACT (CTTI)",
            }
        )
    )
    assert v2.comparison is not None and v2.comparison.v1_committed is None
    assert Card.model_validate_json(v2.model_dump_json()) == v2
    with pytest.raises(ValidationError):
        Card.model_validate_json(json.dumps({**raw, "comparison": {**comparison, "extra": 1}}))
    with pytest.raises(ValidationError):
        Card.model_validate_json(json.dumps({**raw, "feature_set": "v3"}))
