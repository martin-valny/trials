"""Model recipes: baseline restriction, boosted signal, bootstrap range."""

from __future__ import annotations

import numpy as np
import pytest
from _risk_synth import COLUMNS, make_data, single_thread  # noqa: F401

from trialradar.risk.model import fit, fit_ensemble


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
