"""Contributions and top factors."""

from __future__ import annotations

import numpy as np
from _risk_synth import COLUMNS, make_data, single_thread  # noqa: F401

from trialradar.risk.explain import FactorLabel, contributions, top_factors
from trialradar.risk.model import fit_ensemble

LABELS = {
    "signal_b": FactorLabel("signal_b", "Signal is high ({value})", "Signal is low ({value})"),
    "n_sites": FactorLabel("n_sites", "Many sites", "Few sites"),
}


def test_contributions_shape_and_zero_for_unused_baseline() -> None:
    x, y = make_data(600)
    ens = fit_ensemble("baseline", x, y, COLUMNS, n_boot=2)
    c = contributions(ens, x[:5])
    assert c.shape == (5, len(COLUMNS))
    assert (c[:, 6:] == 0).all()


def test_boosted_contributions_shape() -> None:
    x, y = make_data(600)
    ens = fit_ensemble("boosted", x, y, COLUMNS, n_boot=2)
    assert contributions(ens, x[:3]).shape == (3, len(COLUMNS))


def test_top_factors_order_and_direction() -> None:
    x, y = make_data()
    ens = fit_ensemble("boosted", x, y, COLUMNS, n_boot=2)
    row = np.zeros((1, len(COLUMNS)))
    row[0, :] = x[:, :].mean(axis=0)
    row[0, 7] = 3.0
    c = contributions(ens, row)[0]
    f = top_factors(c, row[0], COLUMNS, LABELS)
    assert f[0] == {"label": "Signal is high (3)", "dir": "up"}
    row[0, 7] = -3.0
    c = contributions(ens, row)[0]
    assert top_factors(c, row[0], COLUMNS, LABELS)[0]["dir"] == "down"


def test_skips_zero_and_unlabelled() -> None:
    cols = ("a", "b", "c")
    out = top_factors(
        np.array([0.0, 0.5, -0.2]),
        np.array([1.0, 2.0, 3.0]),
        cols,
        {"b": FactorLabel("b", "B up {value}", "B down"), "c": FactorLabel("c", "C up", "C down")},
    )
    assert out == [{"label": "B up 2", "dir": "up"}, {"label": "C down", "dir": "down"}]


def test_sponsor_factor_copy() -> None:
    cols = ("sponsor_prior_n", "sponsor_prior_rate", "sponsor_few_prior")
    out = top_factors(
        np.array([0.0, 0.4, 0.0]),
        np.array([40.0, 0.225, 0.0]),
        cols,
        {},
    )
    assert out == [
        {"label": "Sponsor's earlier trials: 9 of 40 stopped early (registry)", "dir": "up"}
    ]


def test_sponsor_few_prior_copy_and_no_duplicate() -> None:
    cols = ("sponsor_prior_n", "sponsor_prior_rate", "sponsor_few_prior")
    out = top_factors(np.array([0.1, 0.3, -0.2]), np.array([2.0, 0.3, 1.0]), cols, {})
    assert out == [{"label": "Sponsor has few earlier finished trials", "dir": "up"}]
