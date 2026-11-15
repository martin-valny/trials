"""AACT panel snapshot -> the normalized Tables + RiskFields the daily run builds."""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from typing import Any

import polars as pl
import pytest

from trialradar.aact.adapter import ENUM_MAPS, UnmappedValue, load_snapshot
from trialradar.aact.panel import TABLES
from trialradar.normalize import normalize
from trialradar.risk.fields import categories_from, risk_fields
from trialradar.tables import SCHEMAS
from trialradar.textnorm import Aliases

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "studies"
SNAP = date(2026, 1, 1)


def _write_panel(panel: Path, rows: dict[str, list[dict[str, Any]]], snap: date = SNAP) -> None:
    for table, cols in TABLES.items():
        df = pl.DataFrame(
            [{c: r.get(c) for c in cols} for r in rows.get(table, [])],
            schema=dict.fromkeys(cols, pl.String),
        ).with_columns(snapshot_date=pl.lit(snap))
        (panel / table).mkdir(parents=True, exist_ok=True)
        df.write_parquet(panel / table / f"{snap.isoformat()}.parquet")


def _study_row(nct: str = "NCT00000001", **kw: str | None) -> dict[str, Any]:
    return {
        "nct_id": nct,
        "study_type": "INTERVENTIONAL",
        "overall_status": "RECRUITING",
        "phase": "PHASE2",
        "start_date": "2020-01-15",
        "start_date_type": "ACTUAL",
        "enrollment": "40",
        "enrollment_type": "ESTIMATED",
        "source_class": "INDUSTRY",
        **kw,
    }


def _str(v: object) -> str | None:
    return None if v is None else str(v)


def _aact_rows(study: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    """The rows AACT holds for a CT.gov API v2 study (current, API-style spellings)."""
    ps = study["protocolSection"]
    nct = ps["identificationModule"]["nctId"]
    st, de = ps["statusModule"], ps["designModule"]
    info = de.get("designInfo") or {}
    sp = ps["sponsorCollaboratorsModule"]
    arms = ps.get("armsInterventionsModule") or {}
    browse = (study.get("derivedSection") or {}).get("conditionBrowseModule") or {}
    outcomes = ps.get("outcomesModule") or {}

    def dt(key: str) -> tuple[str | None, str | None]:
        s = st.get(key) or {}
        return s.get("date"), s.get("type")

    start, start_t = dt("startDateStruct")
    pcd, pcd_t = dt("primaryCompletionDateStruct")
    cd, _ = dt("completionDateStruct")
    return {
        "studies": [
            {
                "nct_id": nct,
                "study_type": de.get("studyType"),
                "overall_status": st.get("overallStatus"),
                "phase": "/".join(de.get("phases") or []) or None,
                "start_date": start,
                "start_date_type": start_t,
                "primary_completion_date": pcd,
                "primary_completion_date_type": pcd_t,
                "completion_date": cd,
                "enrollment": _str((de.get("enrollmentInfo") or {}).get("count")),
                "enrollment_type": (de.get("enrollmentInfo") or {}).get("type"),
                "last_update_posted_date": st["lastUpdatePostDateStruct"]["date"],
                "source_class": sp["leadSponsor"]["class"],
            }
        ],
        "interventions": [
            {"nct_id": nct, "intervention_type": i["type"], "name": i["name"]}
            for i in arms.get("interventions") or []
        ],
        "facilities": [
            {
                "nct_id": nct,
                "name": loc.get("facility"),
                "city": loc.get("city"),
                "country": loc.get("country"),
                "status": loc.get("status"),
            }
            for loc in (ps.get("contactsLocationsModule") or {}).get("locations") or []
        ],
        "design_groups": [
            {"nct_id": nct, "group_type": g["type"]} for g in arms.get("armGroups") or []
        ],
        "design_outcomes": [
            {"nct_id": nct, "outcome_type": kind}
            for kind, key in (
                ("primary", "primaryOutcomes"),
                ("secondary", "secondaryOutcomes"),
                ("other", "otherOutcomes"),
            )
            for _ in outcomes.get(key) or []
        ],
        "conditions": [{"nct_id": nct, "name": c} for c in ps["conditionsModule"]["conditions"]],
        "browse_conditions": [
            {"nct_id": nct, "mesh_term": t["term"], "mesh_type": mesh_type}
            for key, mesh_type in (("meshes", "mesh-list"), ("ancestors", "mesh-ancestor"))
            for t in browse.get(key) or []
        ],
        "sponsors": [
            {
                "nct_id": nct,
                "name": sp["leadSponsor"]["name"],
                "lead_or_collaborator": "lead",
                "agency_class": sp["leadSponsor"]["class"],
            },
            *(
                {
                    "nct_id": nct,
                    "name": c["name"],
                    "lead_or_collaborator": "collaborator",
                    "agency_class": c.get("class"),
                }
                for c in sp.get("collaborators") or []
            ),
        ],
        "designs": [
            {
                "nct_id": nct,
                "allocation": info.get("allocation"),
                "masking": (info.get("maskingInfo") or {}).get("masking"),
            }
        ],
    }


def test_tables_match_schemas(tmp_path: Path) -> None:
    _write_panel(tmp_path, {"studies": [_study_row()]})
    snap = load_snapshot(tmp_path, SNAP)
    for name, schema in SCHEMAS.items():
        assert dict(getattr(snap.tables, name).schema) == schema, name
    assert snap.date == SNAP


def test_empty_panel_tables_match_schemas(tmp_path: Path) -> None:
    _write_panel(tmp_path, {})
    snap = load_snapshot(tmp_path, SNAP)
    for name, schema in SCHEMAS.items():
        assert dict(getattr(snap.tables, name).schema) == schema, name
    assert snap.fields == {} and snap.has_results == set()


@pytest.mark.parametrize("name", ["multi_phase.json", "many_sites.json", "no_enrollment.json"])
def test_matches_normalize_and_risk_fields(tmp_path: Path, name: str) -> None:
    """The keystone: a CT.gov study and its AACT rows give the same tables and fields."""
    study = json.loads((FIXTURES / name).read_text())
    _write_panel(tmp_path, _aact_rows(study))
    snap = load_snapshot(tmp_path, SNAP)
    want = normalize([study], tmp_path / "no-aliases")
    nct = study["protocolSection"]["identificationModule"]["nctId"]

    always_null = {"title", "why_stopped", "completion_date_type"}
    trial_cols = [c for c in SCHEMAS["trial"] if c not in always_null]
    assert (
        snap.tables.trial.select(trial_cols).to_dicts() == want.trial.select(trial_cols).to_dicts()
    )
    assert snap.tables.trial.select(sorted(always_null)).null_count().row(0) == (1, 1, 1)

    def rows(df: pl.DataFrame, cols: list[str]) -> list[tuple[Any, ...]]:
        return sorted(df.select(cols).rows(), key=repr)

    assert rows(snap.tables.condition, ["nct_id", "condition"]) == rows(
        want.condition, ["nct_id", "condition"]
    )
    assert rows(snap.tables.intervention, list(SCHEMAS["intervention"])) == rows(
        want.intervention, list(SCHEMAS["intervention"])
    )
    assert snap.tables.sponsor.to_dicts() == want.sponsor.to_dicts()
    assert rows(snap.tables.site, list(SCHEMAS["site"])) == rows(want.site, list(SCHEMAS["site"]))
    assert rows(snap.tables.outcome, ["nct_id", "kind"]) == rows(want.outcome, ["nct_id", "kind"])
    assert snap.fields == {nct: risk_fields(study)}


def test_old_spellings_map_to_api_spellings(tmp_path: Path) -> None:
    _write_panel(
        tmp_path,
        {
            "studies": [
                _study_row(
                    overall_status="Active, not recruiting",
                    phase="Phase 1/Phase 2",
                    start_date_type="Anticipated",
                    enrollment_type="Anticipated",
                    primary_completion_date="2021-03",
                    primary_completion_date_type="Actual",
                    source_class="Industry",
                )
            ],
            "sponsors": [
                {"nct_id": "NCT00000001", "name": "Acme ", "lead_or_collaborator": "lead",
                 "agency_class": None},
                {"nct_id": "NCT00000001", "name": "U Somewhere",
                 "lead_or_collaborator": "collaborator", "agency_class": "U.S. Fed"},
            ],
            "designs": [
                {"nct_id": "NCT00000001", "allocation": "Non-Randomized",
                 "masking": "Double (Participant, Investigator)"}
            ],
            "interventions": [
                {"nct_id": "NCT00000001", "intervention_type": "Dietary Supplement",
                 "name": "Vit D"}
            ],
            "design_groups": [
                {"nct_id": "NCT00000001", "group_type": "Experimental"},
                {"nct_id": "NCT00000001", "group_type": "Sham Comparator"},
            ],
            "design_outcomes": [{"nct_id": "NCT00000001", "outcome_type": "Primary"}],
            "facilities": [
                {"nct_id": "NCT00000001", "name": "H", "city": "C", "country": "France",
                 "status": "Not yet recruiting"}
            ],
        },
    )  # fmt: skip
    snap = load_snapshot(tmp_path, SNAP)
    t = snap.tables.trial.row(0, named=True)
    assert t["overall_status"] == "ACTIVE_NOT_RECRUITING"
    assert t["phases"] == ["PHASE1", "PHASE2"]
    assert t["start_date_type"] == "ESTIMATED"
    assert t["enrollment_type"] == "ESTIMATED"
    assert t["primary_completion_date_type"] == "ACTUAL"
    assert t["allocation"] == "NON_RANDOMIZED"
    assert t["masking"] == "DOUBLE"
    assert t["lead_sponsor"] == "Acme"
    assert t["sponsor_class"] == "INDUSTRY"  # lead row has no class: studies.source_class
    assert snap.tables.sponsor.select("role", "class").rows() == [
        ("lead", "INDUSTRY"),
        ("collaborator", "FED"),
    ]
    assert snap.tables.intervention["type"].to_list() == ["DIETARY_SUPPLEMENT"]
    assert snap.tables.outcome["kind"].to_list() == ["primary"]
    assert snap.tables.site["status"].to_list() == ["NOT_YET_RECRUITING"]
    f = snap.fields["NCT00000001"]
    assert (f.n_arms, f.placebo_arm, f.categories) == (2, True, ())


_SPELLINGS: list[tuple[str, str, str]] = [
    ("phase", "Phase 1", "PHASE1"),
    ("phase", "Phase 2", "PHASE2"),
    ("phase", "Phase 3", "PHASE3"),
    ("phase", "Phase 4", "PHASE4"),
    ("phase", "Early Phase 1", "EARLY_PHASE1"),
    ("phase", "Phase 1/Phase 2", "PHASE1/PHASE2"),
    ("phase", "Phase 2/Phase 3", "PHASE2/PHASE3"),
    ("phase", "N/A", "NA"),
    ("phase", "PHASE1", "PHASE1"),
    ("phase", "PHASE2/PHASE3", "PHASE2/PHASE3"),
    ("phase", "EARLY_PHASE1", "EARLY_PHASE1"),
    ("phase", "NA", "NA"),
    ("overall_status", "Recruiting", "RECRUITING"),
    ("overall_status", "Not yet recruiting", "NOT_YET_RECRUITING"),
    ("overall_status", "Active, not recruiting", "ACTIVE_NOT_RECRUITING"),
    ("overall_status", "Enrolling by invitation", "ENROLLING_BY_INVITATION"),
    ("overall_status", "Completed", "COMPLETED"),
    ("overall_status", "Terminated", "TERMINATED"),
    ("overall_status", "Suspended", "SUSPENDED"),
    ("overall_status", "Withdrawn", "WITHDRAWN"),
    ("overall_status", "Unknown status", "UNKNOWN"),
    ("overall_status", "Withheld", "WITHHELD"),
    ("overall_status", "Approved for marketing", "APPROVED_FOR_MARKETING"),
    ("overall_status", "No longer available", "NO_LONGER_AVAILABLE"),
    ("overall_status", "Temporarily not available", "TEMPORARILY_NOT_AVAILABLE"),
    ("overall_status", "Available", "AVAILABLE"),
    ("overall_status", "ACTIVE_NOT_RECRUITING", "ACTIVE_NOT_RECRUITING"),
    ("overall_status", "UNKNOWN", "UNKNOWN"),
    ("intervention_type", "Drug", "DRUG"),
    ("intervention_type", "Biological", "BIOLOGICAL"),
    ("intervention_type", "Device", "DEVICE"),
    ("intervention_type", "Procedure", "PROCEDURE"),
    ("intervention_type", "Procedure/Surgery", "PROCEDURE"),
    ("intervention_type", "Radiation", "RADIATION"),
    ("intervention_type", "Behavioral", "BEHAVIORAL"),
    ("intervention_type", "Genetic", "GENETIC"),
    ("intervention_type", "Dietary Supplement", "DIETARY_SUPPLEMENT"),
    ("intervention_type", "Combination Product", "COMBINATION_PRODUCT"),
    ("intervention_type", "Diagnostic Test", "DIAGNOSTIC_TEST"),
    ("intervention_type", "Other", "OTHER"),
    ("intervention_type", "DIETARY_SUPPLEMENT", "DIETARY_SUPPLEMENT"),
    ("agency_class", "Industry", "INDUSTRY"),
    ("agency_class", "NIH", "NIH"),
    ("agency_class", "U.S. Fed", "FED"),
    ("agency_class", "Other", "OTHER"),
    ("agency_class", "OTHER_GOV", "OTHER_GOV"),
    ("agency_class", "NETWORK", "NETWORK"),
    ("agency_class", "INDIV", "INDIV"),
    ("agency_class", "UNKNOWN", "UNKNOWN"),
    ("agency_class", "FED", "FED"),
    ("lead_or_collaborator", "lead", "lead"),
    ("lead_or_collaborator", "collaborator", "collaborator"),
    ("allocation", "Randomized", "RANDOMIZED"),
    ("allocation", "Non-Randomized", "NON_RANDOMIZED"),
    ("allocation", "N/A", "NA"),
    ("allocation", "NON_RANDOMIZED", "NON_RANDOMIZED"),
    ("masking", "None (Open Label)", "NONE"),
    ("masking", "Single (Participant)", "SINGLE"),
    ("masking", "Single (Outcomes Assessor)", "SINGLE"),
    ("masking", "Double (Participant, Investigator)", "DOUBLE"),
    ("masking", "Triple (Participant, Care Provider, Investigator)", "TRIPLE"),
    ("masking", "Quadruple (Participant, Care Provider, Investigator, Outcomes Assessor)",
     "QUADRUPLE"),
    ("masking", "QUADRUPLE", "QUADRUPLE"),
    ("masking", "NONE", "NONE"),
    ("group_type", "Experimental", "EXPERIMENTAL"),
    ("group_type", "Active Comparator", "ACTIVE_COMPARATOR"),
    ("group_type", "Placebo Comparator", "PLACEBO_COMPARATOR"),
    ("group_type", "Sham Comparator", "SHAM_COMPARATOR"),
    ("group_type", "No Intervention", "NO_INTERVENTION"),
    ("group_type", "Other", "OTHER"),
    ("group_type", "PLACEBO_COMPARATOR", "PLACEBO_COMPARATOR"),
    ("outcome_type", "primary", "primary"),
    ("outcome_type", "secondary", "secondary"),
    ("outcome_type", "other", "other"),
    ("outcome_type", "PRIMARY", "primary"),
    ("enrollment_type", "Actual", "ACTUAL"),
    ("enrollment_type", "Anticipated", "ESTIMATED"),
    ("enrollment_type", "Estimated", "ESTIMATED"),
    ("enrollment_type", "ESTIMATED", "ESTIMATED"),
    ("start_date_type", "Anticipated", "ESTIMATED"),
    ("start_date_type", "ACTUAL", "ACTUAL"),
    ("primary_completion_date_type", "Estimate", "ESTIMATED"),
    ("mesh_type", "mesh-list", "mesh"),
    ("mesh_type", "mesh-ancestor", "ancestor"),
    ("status", "Active, not recruiting", "ACTIVE_NOT_RECRUITING"),
    ("status", "RECRUITING", "RECRUITING"),
]  # fmt: skip


@pytest.mark.parametrize(("column", "aact", "api"), _SPELLINGS)
def test_enum_maps_cover_fixture_values(column: str, aact: str, api: str) -> None:
    from trialradar.aact.adapter import map_value

    assert column in ENUM_MAPS
    assert map_value("t", column, aact) == api


def test_unmapped_value_raises(tmp_path: Path) -> None:
    _write_panel(tmp_path, {"studies": [_study_row(phase="Phase 9")]})
    with pytest.raises(UnmappedValue) as err:
        load_snapshot(tmp_path, SNAP)
    msg = str(err.value)
    assert "studies" in msg and "phase" in msg and "Phase 9" in msg


def test_unmapped_value_in_child_table_raises(tmp_path: Path) -> None:
    _write_panel(
        tmp_path,
        {
            "studies": [_study_row()],
            "design_groups": [{"nct_id": "NCT00000001", "group_type": "Wizard Arm"}],
        },
    )
    with pytest.raises(UnmappedValue, match="design_groups.*group_type.*Wizard Arm"):
        load_snapshot(tmp_path, SNAP)


def test_categories_from_matches_risk_fields() -> None:
    study = json.loads((FIXTURES / "multi_phase.json").read_text())
    browse = study["derivedSection"]["conditionBrowseModule"]
    meshes = {t["term"] for t in browse["meshes"]}
    ancestors = {t["term"] for t in browse["ancestors"]}
    assert categories_from(meshes, ancestors) == risk_fields(study).categories
    assert categories_from(meshes, ancestors) == (
        "Immune System Diseases",
        "Nervous System Diseases",
    )


def test_month_precision_date(tmp_path: Path) -> None:
    _write_panel(tmp_path, {"studies": [_study_row(start_date="2019-05")]})
    t = load_snapshot(tmp_path, SNAP).tables.trial.row(0, named=True)
    assert t["start_date"] == date(2019, 5, 1)
    assert t["start_date_precision"] == "month"  # normalize's spelling (parse_ct_date)
    _write_panel(tmp_path, {"studies": [_study_row(start_date="2019-05-31")]})
    t = load_snapshot(tmp_path, SNAP).tables.trial.row(0, named=True)
    assert (t["start_date"], t["start_date_precision"]) == (date(2019, 5, 31), "day")


def test_phase_null_is_empty_list_and_has_results(tmp_path: Path) -> None:
    _write_panel(
        tmp_path,
        {
            "studies": [
                _study_row("NCT00000001", phase=None, results_first_posted_date="2025-12-31"),
                _study_row("NCT00000002", results_first_posted_date="2026-01-02"),
                _study_row("NCT00000003", results_first_posted_date="2026-01-01"),
            ]
        },
    )
    snap = load_snapshot(tmp_path, SNAP)
    assert snap.tables.trial["phases"].to_list()[0] == []
    assert snap.has_results == {"NCT00000001", "NCT00000003"}
    assert set(snap.fields) == {"NCT00000001", "NCT00000002", "NCT00000003"}
    assert snap.fields["NCT00000002"].n_arms is None


def test_aliases_applied_to_sponsor_and_intervention(tmp_path: Path) -> None:
    _write_panel(
        tmp_path,
        {
            "studies": [_study_row()],
            "sponsors": [
                {"nct_id": "NCT00000001", "name": "acme inc", "lead_or_collaborator": "lead",
                 "agency_class": "INDUSTRY"}
            ],
            "interventions": [
                {"nct_id": "NCT00000001", "intervention_type": "DRUG", "name": "ABC-1"}
            ],
        },
    )  # fmt: skip
    aliases = Aliases(sponsor={"acme inc": "Acme"}, intervention={"abc-1": "abcmab"})
    snap = load_snapshot(tmp_path, SNAP, aliases=aliases)
    assert snap.tables.trial["lead_sponsor"].to_list() == ["Acme"]
    assert snap.tables.sponsor["name_normalized"].to_list() == ["Acme"]
    assert snap.tables.intervention["name_normalized"].to_list() == ["abcmab"]


def test_sponsor_rows_lead_first_per_trial(tmp_path: Path) -> None:
    def row(nct: str, name: str, role: str) -> dict[str, Any]:
        return {"nct_id": nct, "name": name, "lead_or_collaborator": role, "agency_class": "OTHER"}

    _write_panel(
        tmp_path,
        {
            "studies": [_study_row("NCT00000001"), _study_row("NCT00000002")],
            "sponsors": [
                row("NCT00000001", "C1", "collaborator"),
                row("NCT00000001", "L1", "lead"),
                row("NCT00000002", "C2", "collaborator"),
                row("NCT00000002", "L2", "lead"),
            ],
        },
    )
    snap = load_snapshot(tmp_path, SNAP)
    assert snap.tables.sponsor["name"].to_list() == ["L1", "C1", "L2", "C2"]
    assert snap.tables.trial["lead_sponsor"].to_list() == ["L1", "L2"]


def test_feature_build_runs_unchanged_on_snapshot(tmp_path: Path) -> None:
    from trialradar.risk.features import FEATURES, build

    study = json.loads((FIXTURES / "multi_phase.json").read_text())
    _write_panel(tmp_path, _aact_rows(study))
    snap = load_snapshot(tmp_path, SNAP)
    counts = pl.DataFrame(
        schema={"nct_id": pl.Utf8, "sponsor_prior_n": pl.Int64, "sponsor_prior_stopped": pl.Int64}
    )
    got = build(snap.tables, snap.fields, counts)
    want = build(
        normalize([study], tmp_path / "x"), {f.nct_id: f for f in [risk_fields(study)]}, counts
    )
    assert got.columns == ["nct_id", *FEATURES]
    assert got.to_dicts() == want.to_dicts()
