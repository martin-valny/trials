"""Point-in-time stop-risk features (v2).

Same values from live API tables and AACT snapshot tables: everything here is relative to
`as_of` (snapshot date in training, run date in the daily run). Month-precision dates are
already first-of-month on both sides and are not adjusted.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import date

import numpy as np
import polars as pl

from trialradar.risk import features
from trialradar.risk.features import FEATURES
from trialradar.risk.fields import RiskFields
from trialradar.tables import Tables

__all__ = ["BASELINE_V2", "FEATURES_V2", "NEW_FEATURES", "build_v2", "feature_matrix_v2"]

NEW_FEATURES: tuple[str, ...] = (
    "log_enrollment",
    "enrollment_anticipated",
    "status_not_yet_recruiting",
    "status_recruiting",
    "status_enrolling_by_invitation",
    "status_active_not_recruiting",
    "age_months",
    "planned_duration_months",
    "pcd_overdue_months",
    "months_since_update",
)
FEATURES_V2: tuple[str, ...] = tuple(f for f in FEATURES if f != "start_year") + NEW_FEATURES
BASELINE_V2: tuple[str, ...] = (
    "phase_1",
    "phase_2",
    "phase_3",
    "sponsor_industry",
    "sponsor_academic",
    "age_months",
)

_DAYS_PER_MONTH = 30.4375
_STATUSES = {
    "status_not_yet_recruiting": "NOT_YET_RECRUITING",
    "status_recruiting": "RECRUITING",
    "status_enrolling_by_invitation": "ENROLLING_BY_INVITATION",
    "status_active_not_recruiting": "ACTIVE_NOT_RECRUITING",
}


def _months(delta: pl.Expr) -> pl.Expr:
    return delta.dt.total_days().cast(pl.Float64) / _DAYS_PER_MONTH


def build_v2(
    tables: Tables,
    fields: Mapping[str, RiskFields],
    sponsor_counts: pl.DataFrame,
    as_of: date,
) -> pl.DataFrame:
    """One row per trial: nct_id plus FEATURES_V2 (nulls allowed)."""
    v1 = features.build(tables, fields, sponsor_counts, max_start_year=None).drop("start_year")
    today = pl.lit(as_of, dtype=pl.Date)
    start = pl.col("start_date")
    pcd = pl.col("primary_completion_date")
    extra = tables.trial.select(
        "nct_id",
        pl.col("enrollment").cast(pl.Float64).log1p().alias("log_enrollment"),
        (pl.col("enrollment_type") == "ESTIMATED")
        .fill_null(False)
        .cast(pl.Int64)
        .alias("enrollment_anticipated"),
        *(
            (pl.col("overall_status") == status).fill_null(False).cast(pl.Int64).alias(col)
            for col, status in _STATUSES.items()
        ),
        _months(today - start).alias("age_months"),
        _months(pcd - start).alias("planned_duration_months"),
        pl.when(pcd.is_null())
        .then(None)
        .when(pcd < today)
        .then(_months(today - pcd))
        .otherwise(0.0)
        .alias("pcd_overdue_months"),
        _months(today - pl.col("last_update_post_date")).alias("months_since_update"),
    )
    return v1.join(extra, on="nct_id", how="left").select("nct_id", *FEATURES_V2)


def feature_matrix_v2(frame: pl.DataFrame) -> np.ndarray:
    """FEATURES_V2 as a float matrix, nulls as NaN."""
    return (
        frame.select(pl.col(c).cast(pl.Float64) for c in FEATURES_V2)
        .fill_null(float("nan"))
        .to_numpy()
    )
