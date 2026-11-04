from __future__ import annotations

from typing import Any

from conftest import DELETE, REPO_ROOT, make_study

from trialradar.config import TRACKED_FIELDS
from trialradar.normalize import normalize
from trialradar.tracked import tracked_hash, tracked_state

ALIASES = REPO_ROOT / "config" / "aliases"
NCT = "NCT00000001"


def state_of(*studies: dict[str, Any], fields: tuple[str, ...] = TRACKED_FIELDS) -> Any:
    return tracked_state(normalize(list(studies), ALIASES), fields)


def test_tracked_state_base_study_values() -> None:
    s = state_of(make_study())[NCT]
    assert set(s) == set(TRACKED_FIELDS)
    assert s["overall_status"] == "RECRUITING"
    assert s["why_stopped"] is None
    assert s["phases"] == ["PHASE2"]
    assert s["enrollment"] == 100
    assert s["enrollment_type"] == "ESTIMATED"
    assert s["lead_sponsor"] == "Example Pharma"
    assert s["start_date"] == {"date": "2024-01-01", "precision": "month", "type": "ACTUAL"}
    assert s["primary_completion_date"] == {
        "date": "2026-06-01",
        "precision": "month",
        "type": "ESTIMATED",
    }
    assert s["primary_outcomes"] == [["Annualized relapse rate", "48 weeks"]]
    assert s["secondary_outcomes"] == [["Disability progression", "96 weeks"]]
    assert s["interventions"] == ["Example Drug"]
    assert s["conditions"] == ["Multiple Sclerosis"]
    assert s["site_countries"] == ["United States"]
    assert s["site_count"] == 1


def test_tracked_state_only_requested_fields() -> None:
    s = state_of(make_study(), fields=("overall_status", "site_count"))
    assert s == {NCT: {"overall_status": "RECRUITING", "site_count": 1}}


def test_tracked_state_lists_sorted_unique_and_normalised() -> None:
    study = make_study(
        **{
            "conditionsModule.conditions": ["Myasthenia Gravis", "multiple  sclerosis", "MS"],
            "armsInterventionsModule.interventions": [
                {"type": "DRUG", "name": "Zeta"},
                {"type": "DRUG", "name": "alpha"},
                {"type": "DRUG", "name": "ALPHA"},
            ],
            "contactsLocationsModule.locations": [
                {"country": "Germany"},
                {"country": "France"},
                {"country": "Germany"},
                {"country": None},
            ],
            "outcomesModule.primaryOutcomes": [
                {"measure": "B", "timeFrame": "1 year"},
                {"measure": "a", "timeFrame": None},
                {"measure": "A", "timeFrame": None},
            ],
        }
    )
    s = state_of(study)[NCT]
    assert s["conditions"] == ["MS", "multiple sclerosis", "Myasthenia Gravis"]
    assert s["interventions"] == ["ALPHA", "Zeta"]
    assert s["site_countries"] == ["France", "Germany"]
    assert s["site_count"] == 4
    assert s["primary_outcomes"] == [["A", None], ["B", "1 year"]]


def test_tracked_state_missing_values() -> None:
    study = make_study(
        **{
            "designModule.enrollmentInfo": DELETE,
            "statusModule.startDateStruct": DELETE,
            "contactsLocationsModule.locations": [],
            "outcomesModule.secondaryOutcomes": DELETE,
            "statusModule.completionDateStruct": {"date": "2013-10"},
        }
    )
    s = state_of(study)[NCT]
    assert s["enrollment"] is None
    assert s["enrollment_type"] is None
    assert s["start_date"] is None
    assert s["completion_date"] == {"date": "2013-10-01", "precision": "month", "type": None}
    assert s["site_count"] == 0
    assert s["site_countries"] == []
    assert s["secondary_outcomes"] == []


def test_tracked_state_zero_enrollment_kept() -> None:
    s = state_of(make_study(**{"designModule.enrollmentInfo": {"count": 0, "type": "ACTUAL"}}))
    assert s[NCT]["enrollment"] == 0


def test_tracked_state_multiple_trials() -> None:
    s = state_of(make_study("NCT00000002"), make_study("NCT00000001"))
    assert sorted(s) == ["NCT00000001", "NCT00000002"]
    assert s["NCT00000001"] == s["NCT00000002"]


def test_tracked_hash_stable_under_key_order() -> None:
    a = {"x": 1, "y": [1, 2], "z": {"b": 1, "a": None}}
    b = {"z": {"a": None, "b": 1}, "y": [1, 2], "x": 1}
    assert tracked_hash(a) == tracked_hash(b)
    assert len(tracked_hash(a)) == 64
    assert tracked_hash(a) != tracked_hash({**a, "x": 2})
    assert tracked_hash({"s": "é"}) != tracked_hash({"s": "e"})


def test_tracked_state_variants_collapse_to_smallest() -> None:
    variants = ["multiple sclerosis", "Multiple Sclerosis", "MULTIPLE  SCLEROSIS"]
    for order in (variants, list(reversed(variants))):
        s = state_of(make_study(**{"conditionsModule.conditions": order}))[NCT]
        assert s["conditions"] == ["MULTIPLE SCLEROSIS"]
    s = state_of(
        make_study(
            **{
                "contactsLocationsModule.locations": [
                    {"country": "united states"},
                    {"country": "United States"},
                ],
                "outcomesModule.primaryOutcomes": [
                    {"measure": "edss", "timeFrame": "48 Weeks"},
                    {"measure": "EDSS", "timeFrame": "48 weeks"},
                ],
            }
        )
    )[NCT]
    assert s["site_countries"] == ["United States"]
    assert s["primary_outcomes"] == [["EDSS", "48 weeks"]]
