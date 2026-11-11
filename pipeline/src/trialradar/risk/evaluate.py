"""Held-out metrics: AUC, Brier score and a quantile calibration table."""

from __future__ import annotations

from typing import Any

import numpy as np
from sklearn.metrics import brier_score_loss, roc_auc_score

__all__ = ["metrics"]


def metrics(y: np.ndarray, p: np.ndarray, *, bins: int = 10) -> dict[str, Any]:
    """AUC (None for a single class), Brier, counts and quantile-binned calibration."""
    y = np.asarray(y, dtype=int)
    p = np.asarray(p, dtype=float)
    auc = float(roc_auc_score(y, p)) if len(np.unique(y)) == 2 else None
    order = np.argsort(p, kind="stable")
    calibration: list[dict[str, float | int]] = []
    for chunk in np.array_split(order, bins):
        if len(chunk) == 0:
            continue
        calibration.append(
            {
                "p": float(p[chunk].mean()),
                "observed": float(y[chunk].mean()),
                "n": len(chunk),
            }
        )
    return {
        "auc": auc,
        "brier": float(brier_score_loss(y, p)),
        "n": len(y),
        "positives": int(y.sum()),
        "calibration": calibration,
    }
