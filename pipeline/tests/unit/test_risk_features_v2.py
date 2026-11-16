from __future__ import annotations

from datetime import date
from typing import Any

import numpy as np
import polars as pl

from trialradar.risk import features
from trialradar.risk.features_v2 import (
    BASELINE_V2,
    FEATURES_V2,
    NEW_FEATURES,
    build_v2,
    feature_matrix_v2,
)
from trialradar.tables import SCHEMAS, Tables

AS_OF = date(2024, 1, 1)
DAYS = 30.4375


def _tables(**trial: Any) -> Tables:
    row: dict[str, Any] = {c: None for c in SCHEMAS["trial"]}
    row.update({"nct_id": "NCT00000001", "phases": ["PHASE2"], **trial})
    t = Tables.empty()
    frame = pl.DataFrame([row], schema=SCHEMAS["trial"])
    return Tables(**{**t.__dict__, "trial": frame})


def _counts(ids: list[str]) -> pl.DataFrame:
    return pl.DataFrame(
        {"nct_id": ids, "sponsor_prior_n": [0] * len(ids), "sponsor_prior_stopped": [0] * len(ids)}
    )


def _row(as_of: date = AS_OF, **trial: Any) -> dict[str, Any]:
    tables = _tables(**trial)
    return build_v2(tables, {}, _counts(["NCT00000001"]), as_of).row(0, named=True)


def test_columns_are_features_v2():
    frame = build_v2(_tables(), {}, _counts(["NCT00000001"]), AS_OF)
    assert list(frame.columns) == ["nct_id", *FEATURES_V2]
    assert "start_year" not in FEATURES_V2
    assert set(BASELINE_V2) <= set(FEATURES_V2)
    assert FEATURES_V2[-len(NEW_FEATURES) :] == NEW_FEATURES


def test_as_of_relative_values():
    r = _row(
        start_date=date(2023, 1, 1),
        primary_completion_date=date(2023, 7, 1),
        last_update_post_date=date(2023, 11, 1),
        enrollment=99,
        enrollment_type="ESTIMATED",
        overall_status="RECRUITING",
    )
    assert r["age_months"] == (AS_OF - date(2023, 1, 1)).days / DAYS
    assert r["planned_duration_months"] == (date(2023, 7, 1) - date(2023, 1, 1)).days / DAYS
    assert r["pcd_overdue_months"] == (AS_OF - date(2023, 7, 1)).days / DAYS
    assert r["months_since_update"] == (AS_OF - date(2023, 11, 1)).days / DAYS
    assert r["log_enrollment"] == float(np.log1p(99))
    assert r["enrollment_anticipated"] == 1
    assert r["status_recruiting"] == 1
    assert r["status_not_yet_recruiting"] == 0
    assert r["status_enrolling_by_invitation"] == 0
    assert r["status_active_not_recruiting"] == 0


def test_pcd_in_future_is_not_overdue_and_future_start_negative_age():
    r = _row(start_date=date(2025, 1, 1), primary_completion_date=date(2026, 1, 1))
    assert r["pcd_overdue_months"] == 0
    assert r["age_months"] < 0


def test_missing_dates_give_null():
    r = _row()
    for col in (
        "age_months",
        "planned_duration_months",
        "pcd_overdue_months",
        "months_since_update",
        "log_enrollment",
    ):
        assert r[col] is None
    assert r["enrollment_anticipated"] == 0
    assert r["status_recruiting"] == 0


def test_actual_enrollment_while_running():
    r = _row(enrollment=10, enrollment_type="ACTUAL", overall_status="ACTIVE_NOT_RECRUITING")
    assert r["enrollment_anticipated"] == 0
    assert r["status_active_not_recruiting"] == 1


def test_v1_columns_equal_features_build():
    tables = _tables(
        start_date=date(2022, 5, 1),
        sponsor_class="INDUSTRY",
        masking="DOUBLE",
        allocation="RANDOMIZED",
    )
    counts = _counts(["NCT00000001"])
    v1 = features.build(tables, {}, counts, max_start_year=None)
    v2 = build_v2(tables, {}, counts, AS_OF)
    shared = [c for c in v1.columns if c != "start_year"]
    assert v2.select(shared).equals(v1.select(shared))


def test_feature_matrix_nulls_to_nan():
    frame = build_v2(_tables(), {}, _counts(["NCT00000001"]), AS_OF)
    m = feature_matrix_v2(frame)
    assert m.shape == (1, len(FEATURES_V2))
    assert m.dtype == np.float64
    assert np.isnan(m[0, FEATURES_V2.index("age_months")])
