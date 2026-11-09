"""Metrics."""

from __future__ import annotations

import numpy as np

from trialradar.risk.evaluate import metrics


def test_metrics_known_values() -> None:
    y = np.array([0, 0, 1, 1])
    assert metrics(y, np.array([0.1, 0.2, 0.8, 0.9]))["auc"] == 1.0
    m = metrics(y, np.full(4, 0.5))
    assert m["brier"] == 0.25
    assert m["n"] == 4 and m["positives"] == 2
    assert metrics(np.zeros(4, dtype=int), np.full(4, 0.1))["auc"] is None


def test_calibration_bins_sum_to_n() -> None:
    rng = np.random.default_rng(0)
    p = rng.random(500)
    y = (rng.random(500) < p).astype(int)
    m = metrics(y, p)
    assert sum(b["n"] for b in m["calibration"]) == 500
    assert all(0 <= b["observed"] <= 1 for b in m["calibration"])


def test_empty_bins_dropped_with_ties() -> None:
    m = metrics(np.array([0, 1, 0, 1]), np.full(4, 0.3), bins=10)
    assert sum(b["n"] for b in m["calibration"]) == 4
