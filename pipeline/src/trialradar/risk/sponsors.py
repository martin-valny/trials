"""Sponsor track record: how many of a sponsor's earlier finished trials stopped early.

Counts are point-in-time: a trial only sees history rows that ended strictly before it
started, so no outcome from its own future leaks into its features.
"""

from __future__ import annotations

from datetime import date

import polars as pl

from trialradar.risk.scope import LABELS

SPONSOR_FLOOR = 5
"""Fewer earlier finished trials than this and the sponsor rate is treated as unknown."""

_COUNT_SCHEMA = {"nct_id": pl.Utf8, "sponsor_prior_n": pl.Int64, "sponsor_prior_stopped": pl.Int64}


def history_rows(trial: pl.DataFrame) -> pl.DataFrame:
    """One row per labelled trial with a sponsor and an end date: sponsor, end_date, stopped."""
    return (
        trial.filter(pl.col("overall_status").is_in(list(LABELS)))
        .select(
            pl.col("lead_sponsor").alias("sponsor"),
            pl.coalesce("completion_date", "primary_completion_date").alias("end_date"),
            (pl.col("overall_status") == "TERMINATED").cast(pl.Int64).alias("stopped"),
        )
        .drop_nulls()
        .cast({"sponsor": pl.Utf8, "end_date": pl.Date, "stopped": pl.Int64})
    )


def prior_counts(trials: pl.DataFrame, history: pl.DataFrame) -> pl.DataFrame:
    """nct_id, sponsor_prior_n, sponsor_prior_stopped from history ended before each start."""
    base = trials.select("nct_id", "lead_sponsor", "start_date")
    joined = base.join(history, left_on="lead_sponsor", right_on="sponsor", how="left")
    earlier = pl.col("end_date") < pl.col("start_date")
    counted = joined.group_by("nct_id", maintain_order=True).agg(
        earlier.sum().cast(pl.Int64).alias("sponsor_prior_n"),
        (earlier & (pl.col("stopped") == 1)).sum().cast(pl.Int64).alias("sponsor_prior_stopped"),
    )
    return counted.select(list(_COUNT_SCHEMA))


def aggregate(history: pl.DataFrame, as_of: date) -> pl.DataFrame:
    """One row per sponsor (the committed sponsor_history.csv format)."""
    return (
        history.group_by("sponsor")
        .agg(pl.len().cast(pl.Int64).alias("earlier"), pl.col("stopped").sum().alias("stopped"))
        .with_columns(pl.lit(as_of).alias("as_of"))
        .sort("sponsor")
        .select("sponsor", "earlier", "stopped", "as_of")
    )


def live_counts(trials: pl.DataFrame, table: pl.DataFrame) -> pl.DataFrame:
    """Same output as prior_counts, read from the aggregate table; unknown sponsor is 0, 0."""
    agg = table.select("sponsor", "earlier", "stopped")
    return (
        trials.select("nct_id", "lead_sponsor")
        .join(agg, left_on="lead_sponsor", right_on="sponsor", how="left")
        .select(
            "nct_id",
            pl.col("earlier").fill_null(0).cast(pl.Int64).alias("sponsor_prior_n"),
            pl.col("stopped").fill_null(0).cast(pl.Int64).alias("sponsor_prior_stopped"),
        )
    )
