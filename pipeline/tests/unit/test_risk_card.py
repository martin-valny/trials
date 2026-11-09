"""CI evaluation check: the committed model reproduces the committed card's metrics."""

from __future__ import annotations

from pathlib import Path

import polars as pl
import pytest

from trialradar.risk import artefacts
from trialradar.risk.evaluate import metrics
from trialradar.risk.features import FEATURES

RISK_DIR = Path(__file__).resolve().parents[3] / "config" / "risk"
pytestmark = pytest.mark.skipif(
    not (RISK_DIR / "card.json").exists(), reason="no committed risk card yet (Task 5)"
)


def test_committed_metrics_reproduce() -> None:
    loaded = artefacts.load(RISK_DIR)
    heldout = pl.read_parquet(RISK_DIR / "heldout.parquet")
    p, _, _ = loaded.eval.predict(artefacts.feature_matrix(heldout.select(FEATURES)))
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
