"""Synthetic data shared by the risk model tests."""

from __future__ import annotations

from collections.abc import Iterator

import numpy as np
import pytest
from threadpoolctl import threadpool_limits

from trialradar.risk.model import BASELINE_FEATURES

COLUMNS = (*BASELINE_FEATURES, "n_sites", "signal_b")


def make_data(n: int = 2000, seed: int = 0) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(seed)
    phase = rng.integers(1, 4, n)
    x = np.column_stack(
        [
            phase == 1,
            phase == 2,
            phase == 3,
            rng.integers(0, 2, n),
            rng.integers(0, 2, n),
            rng.integers(2008, 2016, n),
            rng.integers(1, 50, n),
            rng.normal(size=n),
        ]
    ).astype(float)
    logit = 1.5 * x[:, 7] - 0.04 * (x[:, 6] - 25) - 0.5
    y = (rng.random(n) < 1 / (1 + np.exp(-logit))).astype(int)
    return x, y


@pytest.fixture(autouse=True)
def single_thread() -> Iterator[None]:
    """Tiny frames: OpenMP thread start-up dominates, so run single-threaded."""
    with threadpool_limits(1):
        yield
