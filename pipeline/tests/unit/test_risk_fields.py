"""Tests for the raw stop-risk fields."""

from __future__ import annotations

from conftest import make_study

from trialradar.risk.fields import risk_fields


def test_risk_fields_from_make_study() -> None:
    study = make_study(
        "NCT00000007",
        **{
            "armsInterventionsModule.armGroups": [
                {"label": "A", "type": "EXPERIMENTAL"},
                {"label": "B", "type": "PLACEBO_COMPARATOR"},
            ]
        },
    )
    study["derivedSection"] = {
        "conditionBrowseModule": {
            "browseBranches": [{"abbrev": "BXM"}, {"abbrev": "BC10"}, {"abbrev": "BXM"}]
        }
    }
    fields = risk_fields(study)
    assert fields.nct_id == "NCT00000007"
    assert fields.n_arms == 2
    assert fields.placebo_arm is True
    assert fields.branches == ("BC10", "BXM")


def test_sham_counts_as_placebo() -> None:
    study = make_study(**{"armsInterventionsModule.armGroups": [{"type": "SHAM_COMPARATOR"}]})
    assert risk_fields(study).placebo_arm is True


def test_risk_fields_missing_modules() -> None:
    fields = risk_fields({"protocolSection": {}})
    assert fields.n_arms is None
    assert fields.placebo_arm is False
    assert fields.branches == ()
