from __future__ import annotations

import json
from datetime import date
from typing import Any

import polars as pl
import pytest
from conftest import REPO_ROOT, make_study

from trialradar import diff as diff_mod
from trialradar.config import TRACKED_FIELDS, AreaConfig
from trialradar.diff import TRIAL_CHANGE_SCHEMA, diff
from trialradar.normalize import normalize
from trialradar.tracked import TrackedState, tracked_state

ALIASES = REPO_ROOT / "config" / "aliases"
NCT = "NCT00000001"
DAY = date(2026, 11, 4)
REG = {NCT: date(2026, 11, 3)}


def state(*studies: dict[str, Any]) -> TrackedState:
    return tracked_state(normalize(list(studies), ALIASES), TRACKED_FIELDS)


def st(**overrides: Any) -> TrackedState:
    return state(make_study(NCT, **overrides))


def run(prev: TrackedState | None, curr: TrackedState, cfg: AreaConfig) -> pl.DataFrame:
    out = diff(prev, curr, REG, cfg, DAY)
    assert dict(out.schema) == TRIAL_CHANGE_SCHEMA
    assert out.columns == list(TRIAL_CHANGE_SCHEMA)
    return out


def only(df: pl.DataFrame, field: str) -> dict[str, Any]:
    rows = df.filter(pl.col("field") == field).to_dicts()
    assert len(rows) == 1, df
    return rows[0]


def test_schema_exact() -> None:
    assert TRIAL_CHANGE_SCHEMA == {
        "nct_id": pl.Utf8(),
        "field": pl.Utf8(),
        "old_value": pl.Utf8(),
        "new_value": pl.Utf8(),
        "detected_date": pl.Date(),
        "registry_update_date": pl.Date(),
        "delta_days": pl.Int64(),
        "notable": pl.Boolean(),
        "notable_reason": pl.Utf8(),
    }


def test_baseline_emits_nothing(cfg: AreaConfig) -> None:
    assert run(None, st(), cfg).height == 0


def test_identical_states_emit_nothing(cfg: AreaConfig) -> None:
    assert run(st(), st(), cfg).height == 0


def test_cosmetic_text_changes_emit_nothing(cfg: AreaConfig) -> None:
    prev = state(
        make_study(
            **{
                "conditionsModule.conditions": ["Multiple Sclerosis", "Myasthenia Gravis"],
                "outcomesModule.primaryOutcomes": [
                    {"measure": "Annualized relapse rate", "timeFrame": "48 weeks"}
                ],
                "armsInterventionsModule.interventions": [{"type": "DRUG", "name": "Drug A"}],
                "contactsLocationsModule.locations": [{"country": "United States"}],
            }
        )
    )
    curr = state(
        make_study(
            **{
                "conditionsModule.conditions": ["myasthenia  gravis", "MULTIPLE SCLEROSIS "],
                "outcomesModule.primaryOutcomes": [
                    {"measure": "  annualized Relapse   RATE", "timeFrame": "48 Weeks"}
                ],
                "armsInterventionsModule.interventions": [{"type": "DRUG", "name": "drug  a"}],
                "contactsLocationsModule.locations": [{"country": "united states"}],
            }
        )
    )
    assert run(prev, curr, cfg).height == 0


def test_lead_sponsor_case_change_is_a_change(cfg: AreaConfig) -> None:
    curr = st(**{"sponsorCollaboratorsModule.leadSponsor": {"name": "EXAMPLE PHARMA"}})
    row = only(run(st(), curr, cfg), "lead_sponsor")
    assert row["notable"] is False


def test_status_change_is_notable(cfg: AreaConfig) -> None:
    out = run(st(), st(**{"statusModule.overallStatus": "TERMINATED"}), cfg)
    row = only(out, "overall_status")
    assert row["old_value"] == '"RECRUITING"'
    assert row["new_value"] == '"TERMINATED"'
    assert row["notable"] is True
    assert row["notable_reason"] == "status_change"
    assert row["delta_days"] is None
    assert row["detected_date"] == DAY


def test_non_notable_row_has_null_reason(cfg: AreaConfig) -> None:
    out = run(st(), st(**{"statusModule.whyStopped": "Funding"}), cfg)
    row = only(out, "why_stopped")
    assert (row["old_value"], row["new_value"]) == ("null", '"Funding"')
    assert row["notable"] is False
    assert row["notable_reason"] is None


def test_primary_outcome_change_is_notable(cfg: AreaConfig) -> None:
    curr = st(**{"outcomesModule.primaryOutcomes": [{"measure": "EDSS", "timeFrame": "48 weeks"}]})
    row = only(run(st(), curr, cfg), "primary_outcomes")
    assert row["notable"] is True
    assert row["notable_reason"] == "primary_endpoint_change"
    assert json.loads(row["new_value"]) == [["edss", "48 weeks"]]


def test_secondary_outcome_change_not_notable(cfg: AreaConfig) -> None:
    curr = st(**{"outcomesModule.secondaryOutcomes": []})
    assert only(run(st(), curr, cfg), "secondary_outcomes")["notable"] is False


def _enrol(count: int | None, kind: str = "ESTIMATED") -> TrackedState:
    return st(**{"designModule.enrollmentInfo": {"count": count, "type": kind}})


@pytest.mark.parametrize(
    ("old", "new", "notable"),
    [(100, 119, False), (100, 120, True), (100, 80, True), (100, 81, False), (30, 36, True)],
)
def test_enrollment_threshold(cfg: AreaConfig, old: int, new: int, notable: bool) -> None:
    row = only(run(_enrol(old), _enrol(new), cfg), "enrollment")
    assert row["notable"] is notable
    assert row["notable_reason"] == ("enrollment_change_ge_20pct" if notable else None)
    assert row["delta_days"] is None


def test_enrollment_threshold_follows_config(cfg: AreaConfig) -> None:
    cfg = cfg.model_copy(
        update={"thresholds": cfg.thresholds.model_copy(update={"enrollment_rel_change": 0.5})}
    )
    assert only(run(_enrol(100), _enrol(120), cfg), "enrollment")["notable"] is False
    assert only(run(_enrol(100), _enrol(150), cfg), "enrollment")["notable"] is True


@pytest.mark.parametrize("old", [None, 0])
def test_enrollment_from_null_or_zero_not_notable(cfg: AreaConfig, old: int | None) -> None:
    row = only(run(_enrol(old), _enrol(50), cfg), "enrollment")
    assert row["old_value"] == json.dumps(old)
    assert row["new_value"] == "50"
    assert row["notable"] is False


def test_enrollment_to_null_not_notable(cfg: AreaConfig) -> None:
    row = only(run(_enrol(100), _enrol(None), cfg), "enrollment")
    assert row["notable"] is False


def test_enrollment_type_tracked(cfg: AreaConfig) -> None:
    out = run(_enrol(100), _enrol(100, "ACTUAL"), cfg)
    assert out["field"].to_list() == ["enrollment_type"]


def _pcd(d: str, kind: str = "ESTIMATED") -> TrackedState:
    return st(**{"statusModule.primaryCompletionDateStruct": {"date": d, "type": kind}})


def test_primary_completion_slip(cfg: AreaConfig) -> None:
    base = _pcd("2026-06-10")
    r = only(run(base, _pcd("2026-09-07"), cfg), "primary_completion_date")
    assert (r["delta_days"], r["notable"]) == (89, False)
    r = only(run(base, _pcd("2026-09-08"), cfg), "primary_completion_date")
    assert (r["delta_days"], r["notable"], r["notable_reason"]) == (90, True, "date_slip_ge_90d")
    r = only(run(base, _pcd("2026-02-10"), cfg), "primary_completion_date")
    assert (r["delta_days"], r["notable"]) == (-120, False)


def test_completion_date_slip_notable(cfg: AreaConfig) -> None:
    prev = st(**{"statusModule.completionDateStruct": {"date": "2026-12-01"}})
    curr = st(**{"statusModule.completionDateStruct": {"date": "2027-12-01"}})
    r = only(run(prev, curr, cfg), "completion_date")
    assert (r["delta_days"], r["notable_reason"]) == (365, "date_slip_ge_90d")


def test_start_date_slip_never_notable(cfg: AreaConfig) -> None:
    prev = st(**{"statusModule.startDateStruct": {"date": "2024-01-01"}})
    curr = st(**{"statusModule.startDateStruct": {"date": "2024-07-19"}})
    r = only(run(prev, curr, cfg), "start_date")
    assert (r["delta_days"], r["notable"]) == (200, False)


def test_month_precision_refinement(cfg: AreaConfig) -> None:
    r = only(run(_pcd("2027-03"), _pcd("2027-03-15"), cfg), "primary_completion_date")
    assert (r["delta_days"], r["notable"]) == (0, False)
    assert json.loads(r["old_value"])["precision"] == "month"
    assert json.loads(r["new_value"]) == {
        "date": "2027-03-15",
        "precision": "day",
        "type": "ESTIMATED",
    }


def test_month_precision_next_month_is_a_real_delta(cfg: AreaConfig) -> None:
    r = only(run(_pcd("2027-03"), _pcd("2027-04-02"), cfg), "primary_completion_date")
    assert r["delta_days"] == 32


def test_date_type_only_change(cfg: AreaConfig) -> None:
    out = run(_pcd("2026-06", "ESTIMATED"), _pcd("2026-06", "ACTUAL"), cfg)
    r = only(out, "primary_completion_date")
    assert (r["delta_days"], r["notable"]) == (0, False)


def test_date_added_or_removed_has_null_delta(cfg: AreaConfig) -> None:
    gone = st(**{"statusModule.primaryCompletionDateStruct": None})
    r = only(run(_pcd("2026-06"), gone, cfg), "primary_completion_date")
    assert (r["new_value"], r["delta_days"], r["notable"]) == ("null", None, False)
    r = only(run(gone, _pcd("2026-06"), cfg), "primary_completion_date")
    assert (r["old_value"], r["delta_days"], r["notable"]) == ("null", None, False)


def test_reason_precedence_status_first(cfg: AreaConfig) -> None:
    curr = st(
        **{
            "statusModule.overallStatus": "TERMINATED",
            "designModule.enrollmentInfo": {"count": 10, "type": "ACTUAL"},
            "statusModule.primaryCompletionDateStruct": {"date": "2028-06"},
        }
    )
    out = run(st(), curr, cfg)
    assert out["field"].to_list() == sorted(out["field"].to_list())
    reasons = dict(zip(out["field"], out["notable_reason"], strict=True))
    assert reasons["overall_status"] == "status_change"
    assert reasons["enrollment"] == "enrollment_change_ge_20pct"
    assert reasons["primary_completion_date"] == "date_slip_ge_90d"


def test_added_and_removed(cfg: AreaConfig) -> None:
    prev = state(make_study("NCT00000001"), make_study("NCT00000002"))
    curr = state(make_study("NCT00000001"), make_study("NCT00000003"))
    regs = {"NCT00000001": date(2026, 1, 1), "NCT00000003": date(2026, 11, 2)}
    out = diff(prev, curr, regs, cfg, DAY)
    assert out.to_dicts() == [
        {
            "nct_id": "NCT00000002",
            "field": "_tracked",
            "old_value": '"present"',
            "new_value": '"removed"',
            "detected_date": DAY,
            "registry_update_date": None,
            "delta_days": None,
            "notable": False,
            "notable_reason": None,
        },
        {
            "nct_id": "NCT00000003",
            "field": "_tracked",
            "old_value": None,
            "new_value": '"added"',
            "detected_date": DAY,
            "registry_update_date": date(2026, 11, 2),
            "delta_days": None,
            "notable": False,
            "notable_reason": None,
        },
    ]


def test_registry_update_date_populated(cfg: AreaConfig) -> None:
    out = run(st(), st(**{"statusModule.overallStatus": "COMPLETED"}), cfg)
    assert out["registry_update_date"].to_list() == [date(2026, 11, 3)]
    out = diff(st(), st(**{"statusModule.overallStatus": "COMPLETED"}), {}, cfg, DAY)
    assert out["registry_update_date"].to_list() == [None]


def test_rows_sorted_by_nct_and_field(cfg: AreaConfig) -> None:
    over = {"statusModule.overallStatus": "COMPLETED", "designModule.phases": ["PHASE3"]}
    prev = state(make_study("NCT00000002"), make_study("NCT00000001"))
    curr = state(make_study("NCT00000002", **over), make_study("NCT00000001", **over))
    out = diff(prev, curr, {}, cfg, DAY)
    keys = list(zip(out["nct_id"], out["field"], strict=True))
    assert keys == sorted(keys) and len(keys) == 4


def test_only_configured_fields_compared(cfg: AreaConfig) -> None:
    narrow = cfg.model_copy(update={"tracked_fields": ["enrollment"]})
    curr = st(**{"statusModule.overallStatus": "TERMINATED"})
    assert diff(st(), curr, REG, narrow, DAY).height == 0


def test_only_keys_present_in_both_states_compared(cfg: AreaConfig) -> None:
    prev = {NCT: {"overall_status": "RECRUITING"}}
    curr = {NCT: {"overall_status": "RECRUITING", "site_count": 3}}
    assert diff(prev, curr, REG, cfg, DAY).height == 0


def test_fast_path_uses_hash(cfg: AreaConfig, monkeypatch: pytest.MonkeyPatch) -> None:
    prev, curr = st(), st(**{"statusModule.overallStatus": "TERMINATED"})
    assert diff(prev, curr, REG, cfg, DAY).height == 1
    # The fast path is the only place the hash matters: a forced collision hides
    # the change, proving equal hashes short-circuit field comparison.
    monkeypatch.setattr(diff_mod, "tracked_hash", lambda fields: "same")
    assert diff(prev, curr, REG, cfg, DAY).height == 0
