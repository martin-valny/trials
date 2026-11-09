"""Model recipes: baseline restriction, boosted signal, bootstrap range."""

from __future__ import annotations

import numpy as np
import pytest
from _risk_synth import COLUMNS, make_data, single_thread  # noqa: F401

from trialradar.risk.model import Ensemble, Fitted, fit, fit_ensemble


def test_baseline_uses_only_baseline_features() -> None:
    x, y = make_data()
    m = fit("baseline", x, y, COLUMNS)
    x2 = x.copy()
    x2[:, 6:] = np.random.default_rng(1).permutation(x2[:, 6:])
    np.testing.assert_allclose(m.predict_proba(x), m.predict_proba(x2))


def test_baseline_missing_column_fails_loudly() -> None:
    x, y = make_data()
    with pytest.raises(ValueError, match="phase_1"):
        fit("baseline", x[:, 1:], y, COLUMNS[1:])


def test_boosted_beats_chance_on_signal() -> None:
    from sklearn.metrics import roc_auc_score

    x, y = make_data()
    xt, yt = make_data(seed=5)
    m = fit("boosted", x, y, COLUMNS)
    assert roc_auc_score(yt, m.predict_proba(xt)) > 0.7


def test_ensemble_range_contains_p() -> None:
    x, y = make_data(600)
    ens = fit_ensemble("boosted", x, y, COLUMNS, n_boot=4)
    p, lo, hi = ens.predict(x)
    assert (lo <= p).all() and (p <= hi).all()
    assert lo.min() >= 0 and hi.max() <= 1
    assert len(ens.members) == 4


def test_ensemble_deterministic_with_seed() -> None:
    x, y = make_data(600)
    a = fit_ensemble("baseline", x, y, COLUMNS, n_boot=4, seed=3).predict(x)
    b = fit_ensemble("baseline", x, y, COLUMNS, n_boot=4, seed=3).predict(x)
    for u, v in zip(a, b, strict=True):
        np.testing.assert_array_equal(u, v)


def test_ensemble_members_have_no_booster() -> None:
    x, y = make_data(600)
    ens = fit_ensemble("boosted", x, y, COLUMNS, n_boot=2)
    assert ens.main.booster is not None
    assert all(m.booster is None for m in ens.members)


def test_boosted_calibration_survives_year_ordered_rows() -> None:
    """The training frame is ordered by start year and the stop rate drifts by year.

    Unshuffled CV folds are then whole year blocks, the out-of-fold scores carry no rank
    signal, and the isotonic map learned on them goes flat: every prediction lands on one
    plateau (the real-data bug where all 271 running trials got p = 0.149).
    """
    from sklearn.metrics import roc_auc_score

    x, y = make_data(2000)
    order = np.argsort(x[:, 5], kind="stable")
    x, y = x[order], y[order]
    late = x[:, 5] >= 2014
    y = np.maximum(y, (np.random.default_rng(1).random(len(y)) < np.where(late, 0.5, 0)))
    m = fit("boosted", x, y, COLUMNS, explain=False)
    p = m.predict_proba(x)
    assert len(np.unique(p.round(3))) > 20
    assert roc_auc_score(y, p) > 0.7


class _Const:
    """A stand-in estimator returning fixed probabilities for each row."""

    def __init__(self, p: list[float]) -> None:
        self.p = np.asarray(p)

    def predict_proba(self, X: np.ndarray) -> np.ndarray:
        return np.column_stack([1 - self.p, self.p])


def _stub(main: list[float], members: list[list[float]]) -> Ensemble:
    def f(p: list[float]) -> Fitted:
        return Fitted("baseline", _Const(p), (0,))

    return Ensemble("baseline", ("a",), f(main), tuple(f(m) for m in members))


def test_range_is_the_members_spread_placed_around_p() -> None:
    """Ruling 11: p from the main model; lo = p - (median - q10), hi = p + (q90 - median) of
    the members, clipped to [0, 1]. p no longer sits on an edge when the members disagree."""
    # 20 members at 0.30 .. 0.49 for row 0; the main model says 0.40 (above their median).
    members = [[0.30 + 0.01 * i, 0.02 + 0.001 * i] for i in range(20)]
    ens = _stub([0.40, 0.005], members)
    draws = np.array(members)
    med, q10, q90 = (np.percentile(draws, q, axis=0) for q in (50, 10, 90))
    p, lo, hi = ens.predict(np.zeros((2, 1)))
    np.testing.assert_allclose(p, [0.40, 0.005])
    np.testing.assert_allclose(lo, np.clip(p - (med - q10), 0, 1))
    np.testing.assert_allclose(hi, np.clip(p + (q90 - med), 0, 1))
    assert lo[1] == 0.0  # clipped at 0


def test_p_strictly_inside_range_when_members_disagree() -> None:
    x, y = make_data(600)
    ens = fit_ensemble("boosted", x, y, COLUMNS, n_boot=6)
    p, lo, hi = ens.predict(x)
    draws = np.stack([m.predict_proba(x) for m in ens.members])
    med, q10, q90 = (np.percentile(draws, q, axis=0) for q in (50, 10, 90))
    both = (med - q10 > 0) & (q90 - med > 0) & (p > 0) & (p < 1)
    assert both.sum() > 100
    assert ((lo[both] < p[both]) & (p[both] < hi[both])).all()
    assert ((lo <= p) & (p <= hi)).all()
    assert lo.min() >= 0 and hi.max() <= 1
