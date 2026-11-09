"""Tiny synthetic stop-risk artefacts for tests (KB-scale; never the real model)."""

from __future__ import annotations

import shutil
from datetime import date
from pathlib import Path

import numpy as np
import polars as pl
import sklearn
from threadpoolctl import threadpool_limits

from trialradar.risk import artefacts
from trialradar.risk.artefacts import Card, Metrics, MetricSet, Split, Typical
from trialradar.risk.features import FEATURES
from trialradar.risk.model import fit_ensemble

REPO_ROOT = Path(__file__).resolve().parents[2]


def _metrics(n: int, positives: int) -> Metrics:
    cal = [{"p": 0.1 * (i + 1), "observed": 0.1 * (i + 1), "n": n // 5} for i in range(5)]
    return Metrics(auc=0.7, brier=0.15, n=n, positives=positives, calibration=cal)


def write_fixture_artefacts(dir: Path) -> None:
    """Train a small boosted ensemble on random data and write a complete artefact set."""
    rng = np.random.default_rng(0)
    n = 100
    cols = list(FEATURES)
    x = rng.normal(size=(n, len(cols)))
    for c in ("phase_1", "phase_2", "phase_3", "sponsor_industry", "sponsor_academic"):
        x[:, cols.index(c)] = rng.integers(0, 2, n)
    x[:, cols.index("start_year")] = rng.integers(2008, 2016, n)
    y = (rng.random(n) < 1 / (1 + np.exp(-(x[:, cols.index("n_sites")] - 1)))).astype(int)
    with threadpool_limits(1):
        ens = fit_ensemble("boosted", x, y, cols, n_boot=2)
    m = _metrics(100, 20)
    card = Card(
        version="stop-risk-fixture",
        trained_on=date(2026, 1, 1),
        sklearn=sklearn.__version__,
        shipped="boosted",
        shipped_reason="synthetic fixture model",
        filter={"synthetic": True},
        features=cols,
        excluded=list(artefacts.EXCLUDED),
        split=Split(train_end="2015-12-31", test=["2016-01-01", "2019-12-31"]),
        metrics=MetricSet(baseline=m, boosted=m, boosted_no_sites=m, in_area=None),
        site_leak_flag=False,
        typical=[
            Typical(phase=ph, sponsor=sp, rate=r, n=1000)  # type: ignore[arg-type]
            for ph, r in (("all", 0.16), ("phase 1", 0.14), ("phase 2", 0.2), ("phase 3", 0.18))
            for sp in ("all",)
        ],
        max_start_year=2025,
        sponsor_floor=5,
        n_train=n,
        n_test=100,
    )
    heldout = pl.DataFrame(x[:5], schema=cols).with_columns(
        pl.Series("label", y[:5]), pl.lit(False).alias("in_area")
    )
    sponsors = pl.DataFrame(
        {"sponsor": ["Acme"], "earlier": [10], "stopped": [2], "as_of": [date(2026, 1, 1)]}
    )
    artefacts.save(dir, ens, ens, card, heldout, sponsors)
    shutil.copy(REPO_ROOT / "config" / "risk" / "factor_labels.csv", dir / "factor_labels.csv")


if __name__ == "__main__":
    write_fixture_artefacts(Path(__file__).parent / "fixtures" / "risk")
