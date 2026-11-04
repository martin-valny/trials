from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import polars as pl
from conftest import DELETE, REPO_ROOT, make_study

from trialradar.normalize import normalize
from trialradar.tables import SCHEMAS, Tables

ALIASES = REPO_ROOT / "config" / "aliases"
STUDIES = REPO_ROOT / "pipeline" / "tests" / "fixtures" / "studies"


def assert_schemas(tables: Tables) -> None:
    for name in SCHEMAS:
        df = getattr(tables, name)
        assert dict(df.schema) == SCHEMAS[name], name
        assert df.columns == list(SCHEMAS[name]), name


def test_normalize_month_date() -> None:
    t = normalize([make_study(**{"statusModule.startDateStruct": {"date": "2023-05"}})], ALIASES)
    row = t.trial.row(0, named=True)
    assert row["start_date"] == date(2023, 5, 1)
    assert row["start_date_precision"] == "month"
    assert row["start_date_type"] is None
    assert row["completion_date_precision"] == "month"
    assert row["completion_date_type"] == "ESTIMATED"
    assert row["last_update_post_date"] == date(2025, 1, 15)
    assert_schemas(t)


def test_normalize_multi_phase_sorted() -> None:
    t = normalize([make_study(**{"designModule.phases": ["PHASE3", "PHASE2"]})], ALIASES)
    assert t.trial["phases"].to_list() == [["PHASE2", "PHASE3"]]
    t = normalize([make_study(**{"designModule.phases": DELETE})], ALIASES)
    assert t.trial["phases"].to_list() == [[]]
    assert_schemas(t)


def test_normalize_no_sites_and_no_enrollment() -> None:
    s = make_study(**{"contactsLocationsModule": DELETE, "designModule.enrollmentInfo": DELETE})
    t = normalize([s], ALIASES)
    assert t.site.height == 0
    assert t.trial["enrollment"].to_list() == [None]
    assert t.trial["enrollment_type"].to_list() == [None]
    assert_schemas(t)


def test_normalize_withdrawn_zero_enrollment_kept() -> None:
    s = make_study(**{"designModule.enrollmentInfo": {"count": 0, "type": "ACTUAL"}})
    t = normalize([s], ALIASES)
    assert t.trial["enrollment"].to_list() == [0]
    assert t.trial["enrollment_type"].to_list() == ["ACTUAL"]


def test_normalize_optional_design_and_missing_modules() -> None:
    s = make_study(
        **{
            "designModule.designInfo": DELETE,
            "outcomesModule": DELETE,
            "armsInterventionsModule": DELETE,
            "sponsorCollaboratorsModule": DELETE,
            "contactsLocationsModule": {"locations": [{"facility": "X"}]},
        }
    )
    t = normalize([s], ALIASES)
    assert t.trial["masking"].to_list() == [None]
    assert t.trial["allocation"].to_list() == [None]
    assert t.outcome.height == 0
    assert t.intervention.height == 0
    assert t.sponsor.height == 0
    assert t.trial["lead_sponsor"].to_list() == [None]
    assert t.site["country"].to_list() == [None]
    assert_schemas(t)


def test_normalize_child_tables() -> None:
    s = make_study(
        **{
            "conditionsModule.conditions": ["MS", "NMOSD"],
            "sponsorCollaboratorsModule.collaborators": [{"name": "Univ  Foo", "class": "OTHER"}],
            "outcomesModule.secondaryOutcomes": [
                {"measure": "A", "timeFrame": "1 y"},
                {"measure": "B", "timeFrame": "2 y", "description": "d"},
            ],
        }
    )
    t = normalize([s], ALIASES)
    assert t.condition["condition"].to_list() == ["MS", "NMOSD"]
    assert t.sponsor["role"].to_list() == ["lead", "collaborator"]
    assert t.sponsor["class"].to_list() == ["INDUSTRY", "OTHER"]
    assert t.sponsor["name_normalized"].to_list() == ["Example Pharma", "Univ Foo"]
    assert t.outcome["kind"].to_list() == ["primary", "secondary", "secondary"]
    assert t.outcome["description"].to_list()[2] == "d"
    assert t.outcome["description"].to_list()[1] is None
    assert t.trial["lead_sponsor"].to_list() == ["Example Pharma"]
    assert t.trial["sponsor_class"].to_list() == ["INDUSTRY"]
    assert t.intervention.row(0, named=True)["name_normalized"] == "Example Drug"
    assert_schemas(t)


def test_normalize_uses_aliases_and_preserves_order(tmp_path: Path) -> None:
    (tmp_path / "sponsor.csv").write_text("raw,normalized\nexample pharma,Example\n")
    (tmp_path / "intervention.csv").write_text("raw,normalized\nexample drug,ED\n")
    a = make_study("NCT00000009")
    b = make_study("NCT00000002")
    t = normalize([a, b], tmp_path)
    assert t.trial["nct_id"].to_list() == ["NCT00000009", "NCT00000002"]
    assert t.trial["lead_sponsor"].to_list() == ["Example", "Example"]
    assert t.intervention["name_normalized"].to_list() == ["ED", "ED"]
    assert t.intervention["name"].to_list() == ["Example Drug", "Example Drug"]


def test_normalize_schemas_match() -> None:
    assert_schemas(Tables.empty())
    assert_schemas(normalize([], ALIASES))
    assert_schemas(normalize([make_study()], ALIASES))


def _fixture_studies() -> list[tuple[str, list[dict]]]:
    out = []
    for p in sorted(STUDIES.iterdir()):
        if p.suffix == ".json":
            out.append((p.name, [json.loads(p.read_text())]))
        elif p.suffix == ".jsonl":
            out.append(
                (p.name, [json.loads(ln) for ln in p.read_text().splitlines() if ln.strip()])
            )
    return out


def test_normalize_recorded_fixtures_smoke() -> None:
    fixtures = _fixture_studies()
    assert len(fixtures) == 7
    for name, studies in fixtures:
        t = normalize(studies, ALIASES)
        assert t.trial.height == len(studies), name
        assert_schemas(t)
    by_name = {n: normalize(s, ALIASES) for n, s in fixtures}
    assert by_name["no_sites.json"].site.height == 0
    assert by_name["no_enrollment.json"].trial["enrollment"].to_list() == [None]
    assert pl.Date == by_name["month_date.json"].trial.schema["start_date"]
    assert "month" in by_name["month_date.json"].trial["start_date_precision"].to_list()
