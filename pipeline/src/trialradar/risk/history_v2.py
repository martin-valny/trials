"""Edit-history features from the monthly registry snapshots (v2 research arm, never shipped).

For each (trial, as_of) row the monthly snapshots dated within (as_of - window, as_of] are
compared pairwise, each with the previous *available* snapshot of the same trial (missing
months are skipped). Events counted: primary-completion-date slips, planned-enrollment cuts
of at least 20%, and status regressions (running -> not yet recruiting). Everything is a
join / window expression; there are no per-row Python loops.
"""

from __future__ import annotations

from pathlib import Path

import polars as pl

HISTORY_FEATURES = (
    "pcd_slips_12m",
    "pcd_slip_months_12m",
    "enrollment_cuts_12m",
    "status_regressions_12m",
)

CUT_FRACTION = 0.8  # new <= 0.8 * old, i.e. a reduction of at least 20%
_DAYS_PER_MONTH = 30.4375
_RUNNING = ("recruiting", "active_not_recruiting", "enrolling_by_invitation")


MONTHLY_COLUMNS = (
    "nct_id",
    "primary_completion_date",
    "overall_status",
    "enrollment",
    "enrollment_type",
)
"""The only monthly columns the history features read (an absent one is filled in later)."""


def _read_monthly(f: Path) -> pl.DataFrame:
    lazy = pl.scan_parquet(f)
    present = set(lazy.collect_schema().names())
    return (
        lazy.select([c for c in MONTHLY_COLUMNS if c in present])
        .with_columns(pl.lit(f.stem).str.to_date("%Y-%m-%d", strict=False).alias("snapshot_date"))
        .collect()
    )


def load_monthly(panel_dir: Path) -> pl.DataFrame:
    """The needed columns (``MONTHLY_COLUMNS``) of all `studies_monthly/*.parquet` stacked,
    with `snapshot_date` taken from the file name."""
    frames = [_read_monthly(f) for f in sorted((panel_dir / "studies_monthly").glob("*.parquet"))]
    if not frames:
        return pl.DataFrame(schema={"nct_id": pl.Utf8, "snapshot_date": pl.Date})
    return pl.concat(frames, how="diagonal_relaxed")


def _events(monthly: pl.DataFrame) -> pl.DataFrame:
    """One row per (nct_id, snapshot) with the event flags versus the previous snapshot."""
    cols = monthly.columns
    for c in ("primary_completion_date", "overall_status", "enrollment", "enrollment_type"):
        if c not in cols:
            monthly = monthly.with_columns(pl.lit(None, dtype=pl.Utf8).alias(c))
    base = (
        monthly.select(
            "nct_id",
            pl.col("snapshot_date").cast(pl.Date),
            pl.col("primary_completion_date")
            .cast(pl.Utf8)
            .str.to_date("%Y-%m-%d", strict=False)
            .alias("pcd"),
            pl.col("overall_status")
            .cast(pl.Utf8)
            .str.to_lowercase()
            .str.replace_all(r"[^a-z]+", "_")
            .str.strip_chars("_")
            .alias("status"),
            pl.col("enrollment").cast(pl.Float64, strict=False).alias("enr"),
            pl.col("enrollment_type")
            .cast(pl.Utf8)
            .str.to_lowercase()
            .is_in(["anticipated", "estimated"])
            .alias("est"),
        )
        .filter(pl.col("snapshot_date").is_not_null())
        .unique(subset=["nct_id", "snapshot_date"], keep="last")
        .sort("nct_id", "snapshot_date")
    )
    prev = {c: pl.col(c).shift(1).over("nct_id") for c in ("pcd", "status", "enr", "est")}
    slip = pl.col("pcd") > prev["pcd"]
    cut = (
        pl.col("est")
        & prev["est"]
        & (prev["enr"] > 0)
        & (pl.col("enr") <= CUT_FRACTION * prev["enr"])
    )
    regress = prev["status"].is_in(_RUNNING) & (pl.col("status") == "not_yet_recruiting")
    return base.select(
        "nct_id",
        "snapshot_date",
        slip.fill_null(False).alias("slip"),
        pl.when(slip)
        .then((pl.col("pcd") - prev["pcd"]).dt.total_days() / _DAYS_PER_MONTH)
        .otherwise(0.0)
        .alias("slip_months"),
        cut.fill_null(False).alias("cut"),
        regress.fill_null(False).alias("regress"),
    )


def history_features(
    monthly: pl.DataFrame, rows: pl.DataFrame, window_months: int = 12
) -> pl.DataFrame:
    """One row per input row (same order): nct_id, as_of and the HISTORY_FEATURES."""
    keyed = rows.select("nct_id", "as_of").with_row_index("_i")
    events = _events(monthly)
    agg = (
        keyed.join(events, on="nct_id", how="inner")
        .filter(
            (pl.col("snapshot_date") <= pl.col("as_of"))
            & (pl.col("snapshot_date") > pl.col("as_of").dt.offset_by(f"-{window_months}mo"))
        )
        .group_by("_i")
        .agg(
            pl.col("slip").sum().alias("pcd_slips_12m"),
            pl.col("slip_months").sum().alias("pcd_slip_months_12m"),
            pl.col("cut").sum().alias("enrollment_cuts_12m"),
            pl.col("regress").sum().alias("status_regressions_12m"),
        )
    )
    return (
        keyed.join(agg, on="_i", how="left")
        .sort("_i")
        .with_columns(
            pl.col("pcd_slips_12m", "enrollment_cuts_12m", "status_regressions_12m")
            .fill_null(0)
            .cast(pl.Int64),
            pl.col("pcd_slip_months_12m").fill_null(0.0),
        )
        .select("nct_id", "as_of", *HISTORY_FEATURES)
    )


__all__ = ["HISTORY_FEATURES", "history_features", "load_monthly"]
