from __future__ import annotations

from dataclasses import replace
from datetime import date
from pathlib import Path
from typing import Any

import polars as pl
from conftest import DELETE, REPO_ROOT, make_study

from trialradar.config import TRACKED_FIELDS, AreaConfig
from trialradar.diff import diff
from trialradar.normalize import normalize
from trialradar.textnorm import Aliases, load_alias_set
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


# --- alias-stable comparison -------------------------------------------------


def _alias_dir(tmp_path: Path, name: str, sponsor: str = "", intervention: str = "") -> Path:
    d = tmp_path / name
    d.mkdir()
    (d / "sponsor.csv").write_text("raw,normalized\n" + sponsor, encoding="utf-8-sig")
    (d / "intervention.csv").write_text("raw,normalized\n" + intervention, encoding="utf-8-sig")
    return d


def _alias_study() -> dict[str, Any]:
    return make_study(
        **{
            "sponsorCollaboratorsModule.leadSponsor": {
                "name": "Example  Pharma",
                "class": "INDUSTRY",
            },
            "armsInterventionsModule.interventions": [
                {"type": "DRUG", "name": "Example Drug"},
                {"type": "DRUG", "name": "Other Drug"},
            ],
        }
    )


def test_alias_set_loads_both_csvs_and_empty(tmp_path: Path) -> None:
    d = _alias_dir(tmp_path, "a", "Example Pharma,Example Pharma Inc\n", "x,y\n")
    loaded = load_alias_set(d)
    assert loaded.sponsor == {"example pharma": "Example Pharma Inc"}
    assert loaded.intervention == {"x": "y"}
    assert Aliases.empty() == Aliases(sponsor={}, intervention={})
    assert load_alias_set(tmp_path / "missing") == Aliases.empty()


def test_alias_edit_produces_identical_state_and_no_diff(tmp_path: Path, cfg: AreaConfig) -> None:
    study = _alias_study()
    old_dir = _alias_dir(tmp_path, "old")
    new_dir = _alias_dir(
        tmp_path,
        "new",
        "Example Pharma,Example Pharma Inc\n",
        "Example Drug,Drug X\n",
    )
    aliases = load_alias_set(new_dir)
    prev = tracked_state(normalize([study], old_dir), TRACKED_FIELDS, aliases)
    curr = tracked_state(normalize([study], new_dir), TRACKED_FIELDS, aliases)
    assert prev == curr
    assert curr[NCT]["lead_sponsor"] == "Example Pharma Inc"
    assert curr[NCT]["interventions"] == ["Drug X", "Other Drug"]
    day = date(2026, 11, 4)
    assert diff(prev, curr, {NCT: day}, cfg, day).height == 0


def test_without_aliases_alias_edit_is_a_change(tmp_path: Path, cfg: AreaConfig) -> None:
    study = _alias_study()
    old = tracked_state(normalize([study], _alias_dir(tmp_path, "old")), TRACKED_FIELDS)
    new_dir = _alias_dir(tmp_path, "new", "Example Pharma,Example Pharma Inc\n")
    new = tracked_state(normalize([study], new_dir), TRACKED_FIELDS)
    assert old != new
    day = date(2026, 11, 4)
    assert (
        diff(old, new, {NCT: day}, cfg, day).filter(pl.col("field") == "lead_sponsor").height == 1
    )


def test_aliases_none_equals_today(tmp_path: Path) -> None:
    tables = normalize([_alias_study()], _alias_dir(tmp_path, "d", "Example Pharma,Z\n"))
    assert tracked_state(tables, TRACKED_FIELDS) == tracked_state(tables, TRACKED_FIELDS, None)
    assert tracked_state(tables, TRACKED_FIELDS)[NCT]["lead_sponsor"] == "Z"


def test_alias_applies_to_raw_names_and_dedups(tmp_path: Path) -> None:
    study = make_study(
        **{
            "armsInterventionsModule.interventions": [
                {"type": "DRUG", "name": "Foo"},
                {"type": "DRUG", "name": "foo 5mg"},
            ]
        }
    )
    aliases = Aliases(sponsor={}, intervention={"foo 5mg": "Foo"})
    tables = normalize([study], _alias_dir(tmp_path, "d"))
    assert tracked_state(tables, TRACKED_FIELDS, aliases)[NCT]["interventions"] == ["Foo"]


def test_lead_sponsor_falls_back_to_trial_table(tmp_path: Path) -> None:
    tables = normalize([make_study()], _alias_dir(tmp_path, "d"))
    tables = replace(tables, sponsor=tables.sponsor.clear())
    aliases = Aliases(sponsor={"example pharma": "Nope"}, intervention={})
    assert tracked_state(tables, TRACKED_FIELDS, aliases)[NCT]["lead_sponsor"] == "Example Pharma"


def test_collaborator_does_not_become_lead(tmp_path: Path) -> None:
    study = make_study(
        **{"sponsorCollaboratorsModule.collaborators": [{"name": "Collab", "class": "OTHER"}]}
    )
    tables = normalize([study], _alias_dir(tmp_path, "d"))
    aliases = Aliases(sponsor={"collab": "Wrong"}, intervention={})
    assert tracked_state(tables, TRACKED_FIELDS, aliases)[NCT]["lead_sponsor"] == "Example Pharma"
