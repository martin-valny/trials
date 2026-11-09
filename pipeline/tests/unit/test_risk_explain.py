"""Contributions and top factors."""

from __future__ import annotations

import numpy as np
from _risk_synth import COLUMNS, make_data, single_thread  # noqa: F401

from trialradar.risk.explain import FactorLabel, contributions, top_factors
from trialradar.risk.model import fit_ensemble

LABELS = {
    "signal_b": FactorLabel("signal_b", "count", text="Signal: {value}"),
    "n_sites": FactorLabel("n_sites", "count", text="Sites planned: {value}"),
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
    assert f[0] == {"label": "Signal: 3", "dir": "up"}
    row[0, 7] = -3.0
    c = contributions(ens, row)[0]
    assert top_factors(c, row[0], COLUMNS, LABELS)[0]["dir"] == "down"


def test_skips_zero_and_unlabelled() -> None:
    cols = ("a", "b", "c")
    out = top_factors(
        np.array([0.0, 0.5, -0.2]),
        np.array([1.0, 2.0, 0.0]),
        cols,
        {
            "b": FactorLabel("b", "count", text="B: {value}"),
            "c": FactorLabel("c", "binary", yes="C yes", no="C no"),
        },
    )
    assert out == [{"label": "B: 2", "dir": "up"}, {"label": "C no", "dir": "down"}]


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


def test_absent_category_never_a_factor() -> None:
    cols = ("cat_nervous_system_diseases", "b")
    labels = {
        "cat_nervous_system_diseases": FactorLabel(
            "cat_nervous_system_diseases", "category", yes="Registry files it under: Nervous"
        ),
        "b": FactorLabel("b", "binary", yes="B yes", no="B no"),
    }
    out = top_factors(np.array([-0.9, -0.1]), np.array([0.0, 1.0]), cols, labels)
    assert out == [{"label": "B yes", "dir": "down"}]


def test_present_category_can_be_a_factor() -> None:
    cols = ("cat_neoplasms",)
    labels = {
        "cat_neoplasms": FactorLabel(
            "cat_neoplasms", "category", yes="Registry files it under: Neoplasms"
        )
    }
    out = top_factors(np.array([0.4]), np.array([1.0]), cols, labels)
    assert out == [{"label": "Registry files it under: Neoplasms", "dir": "up"}]


def _real_labels() -> dict[str, FactorLabel]:
    from conftest import REPO_ROOT

    from trialradar.risk.artefacts import read_factor_labels

    return read_factor_labels(REPO_ROOT / "config" / "risk" / "factor_labels.csv")


def test_start_year_is_never_a_shown_factor() -> None:
    """Live start years are clamped to the refit's last year, so the value shown would not be
    the trial's own; start year shifts the estimate but is not given as a reason."""
    cols = ("start_year", "n_sites")
    labels = {
        **_real_labels(),
        "start_year": FactorLabel("start_year", "count", text="Start year {value}"),
    }
    for sign in (1.0, -1.0):
        f = top_factors(np.array([sign * 5.0, 0.1]), np.array([2019.0, 3.0]), cols, labels)
        assert [x["label"] for x in f] == ["Sites planned: 3"]


def test_count_wording_follows_the_value_not_the_sign() -> None:
    """The text states the trial's own count; only `dir` comes from the contribution, so a
    large count that lowers the estimate never reads "Few" (and a small one never "Many")."""
    labels = _real_labels()
    cols = ("n_sites", "n_secondary_outcomes", "n_collaborators", "n_countries")
    x = np.array([112.0, 0.0, 5.0, 25.0])
    f = top_factors(np.array([-0.9, 0.5, -0.4, 0.3]), x, cols, labels, k=4)
    assert f == [
        {"label": "Sites planned: 112", "dir": "down"},
        {"label": "Secondary outcomes: 0", "dir": "up"},
        {"label": "Collaborators: 5", "dir": "down"},
        {"label": "Countries: 25", "dir": "up"},
    ]
    assert not any(w in x["label"] for x in f for w in ("Many", "Few"))


def test_binary_wording_follows_the_value() -> None:
    labels = _real_labels()
    cols = ("randomized", "placebo_arm", "has_biological")
    up = np.array([0.5, 0.4, 0.3])
    on = top_factors(up, np.array([1.0, 1.0, 1.0]), cols, labels)
    off = top_factors(up, np.array([0.0, 0.0, 0.0]), cols, labels)
    assert [x["label"] for x in on] == [
        "Randomized allocation",
        "Has a placebo or sham arm",
        "Includes a biological product",
    ]
    assert [x["label"] for x in off] == [
        "Non-randomized allocation",
        "No placebo or sham arm",
        "No biological product",
    ]
    # Lowering contributions keep the same text.
    assert [x["label"] for x in top_factors(-up, np.array([1.0, 1.0, 1.0]), cols, labels)] == [
        x["label"] for x in on
    ]


def test_phase_factor_names_the_trials_own_phase() -> None:
    """phase_2 = 0 on a phase 3 trial reads "Phase 3 trial", never "Not a phase 2 trial";
    two phase features on one trial collapse into one factor."""
    labels = _real_labels()
    cols = ("phase_1", "phase_2", "phase_3", "n_sites")
    x = np.array([0.0, 0.0, 1.0, 4.0])
    f = top_factors(np.array([0.0, -0.6, 0.5, 0.1]), x, cols, labels)
    assert f == [
        {"label": "Phase 3 trial", "dir": "down"},
        {"label": "Sites planned: 4", "dir": "up"},
    ]
    x12 = np.array([1.0, 1.0, 0.0, 4.0])
    assert top_factors(np.array([0.0, 0.0, 0.7, 0.0]), x12, cols, labels) == [
        {"label": "Phase 1/2 trial", "dir": "up"}
    ]


def test_missing_value_is_never_described() -> None:
    labels = _real_labels()
    cols = ("n_arms", "masking_level", "n_sites")
    f = top_factors(np.array([0.9, 0.8, 0.1]), np.array([np.nan, np.nan, 2.0]), cols, labels)
    assert f == [{"label": "Sites planned: 2", "dir": "up"}]


def test_no_shown_label_contradicts_its_value() -> None:
    """Every feature's text, for any value and either sign, avoids the old up/down adjectives."""
    labels = _real_labels()
    for name, lab in labels.items():
        if lab.kind == "sponsor":
            continue
        for v in (0.0, 1.0, 3.0, 112.0):
            for c in (0.5, -0.5):
                for x in top_factors(np.array([c]), np.array([v]), (name,), labels):
                    low = x["label"].lower()
                    assert not low.startswith(("many ", "few ", "not a ", "higher ", "lower "))
