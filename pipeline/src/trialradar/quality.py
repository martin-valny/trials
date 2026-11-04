"""Data quality checks on a pipeline run (spec section 7)."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

import polars as pl

from trialradar.config import AreaConfig
from trialradar.tables import Tables

KNOWN_STATUSES: frozenset[str] = frozenset(
    {
        "ACTIVE_NOT_RECRUITING",
        "COMPLETED",
        "ENROLLING_BY_INVITATION",
        "NOT_YET_RECRUITING",
        "RECRUITING",
        "SUSPENDED",
        "TERMINATED",
        "WITHDRAWN",
        "AVAILABLE",
        "NO_LONGER_AVAILABLE",
        "TEMPORARILY_NOT_AVAILABLE",
        "APPROVED_FOR_MARKETING",
        "WITHHELD",
        "UNKNOWN",
    }
)

_REQUIRED_PATHS: tuple[tuple[str, ...], ...] = (
    ("protocolSection", "identificationModule", "nctId"),
    ("protocolSection", "identificationModule", "briefTitle"),
    ("protocolSection", "statusModule", "overallStatus"),
)
_NULL_CHECKED = ("nct_id", "title", "overall_status")
_MAX_IDS = 5


@dataclass
class QualityReport:
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors


def _ids(ids: Sequence[str]) -> str:
    shown = ", ".join(ids[:_MAX_IDS])
    extra = len(ids) - _MAX_IDS
    return f"{shown} … and {extra} more" if extra > 0 else shown


def _get(study: dict[str, Any], path: tuple[str, ...]) -> Any:
    node: Any = study
    for key in path:
        if not isinstance(node, dict):
            return None
        node = node.get(key)
    return node


def _label(study: dict[str, Any], index: int) -> str:
    nct = _get(study, _REQUIRED_PATHS[0])
    return str(nct) if nct else f"<study #{index}>"


def _check_schema(raw: Sequence[dict[str, Any]], report: QualityReport) -> None:
    for path in _REQUIRED_PATHS:
        missing = [_label(s, i) for i, s in enumerate(raw) if _get(s, path) in (None, "")]
        if missing:
            report.errors.append(
                f"schema: {len(missing)} study(ies) missing {'.'.join(path)}: {_ids(missing)}"
            )


def _check_nulls(trial: pl.DataFrame, cfg: AreaConfig, report: QualityReport) -> None:
    n = trial.height
    for col in _NULL_CHECKED:
        bad = trial.filter(pl.col(col).is_null() | (pl.col(col) == ""))
        rate = bad.height / n
        if rate > cfg.thresholds.max_null_rate:
            ids = [
                str(v) if v else f"<row {i}>"
                for i, v in enumerate(trial["nct_id"].to_list())
                if v is None or v == "" or trial[col][i] in (None, "")
            ]
            report.errors.append(
                f"null_rate: {col} null/empty in {bad.height} of {n} trials "
                f"({rate:.1%} > {cfg.thresholds.max_null_rate:.1%}): {_ids(ids)}"
            )


def _check_dates(trial: pl.DataFrame, report: QualityReport) -> None:
    errors: list[str] = []
    estimated: list[str] = []
    for i, row in enumerate(trial.iter_rows(named=True)):
        label = row["nct_id"] or f"<row {i}>"
        start, end = row["start_date"], row["completion_date"]
        if start is None or end is None or end >= start:
            continue
        if row["start_date_type"] == "ACTUAL" and row["completion_date_type"] == "ACTUAL":
            errors.append(label)
        else:
            estimated.append(label)
    if errors:
        report.errors.append(
            f"date_order: completion before start (both ACTUAL) in {len(errors)} trials: "
            f"{_ids(errors)}"
        )
    if estimated:
        report.warnings.append(
            "date_order_estimated: completion before start with an estimated or untyped date "
            f"in {len(estimated)} trials: {_ids(estimated)}"
        )


def check(
    raw: Sequence[dict[str, Any]],
    tables: Tables,
    prev_trial_count: int | None,
    cfg: AreaConfig,
    fetched_count: int | None = None,
) -> QualityReport:
    report = QualityReport()
    _check_schema(raw, report)

    trial = tables.trial
    n = trial.height
    if n == 0:
        report.errors.append("empty: no trials in this run")
        return report

    _check_nulls(trial, cfg, report)
    _check_dates(trial, report)

    dups = (
        trial.filter(pl.col("nct_id").is_not_null() & pl.col("nct_id").is_duplicated())["nct_id"]
        .unique()
        .sort()
        .to_list()
    )
    if dups:
        report.errors.append(f"duplicate: {len(dups)} repeated nct_id: {_ids(dups)}")

    if prev_trial_count is not None and prev_trial_count > 0:
        drop = (prev_trial_count - n) / prev_trial_count
        th = cfg.thresholds
        if drop > th.row_drop_error:
            report.errors.append(
                f"row_drop_error: trial count fell from {prev_trial_count} to {n} "
                f"({drop:.1%} > {th.row_drop_error:.1%})"
            )
        elif drop > th.row_drop_warn:
            report.warnings.append(
                f"row_drop: trial count fell from {prev_trial_count} to {n} "
                f"({drop:.1%} > {th.row_drop_warn:.1%})"
            )

    if fetched_count is not None and fetched_count > 0:
        share = n / fetched_count
        if share < cfg.thresholds.min_relevant_share:
            report.warnings.append(
                f"off_topic: only {n} of {fetched_count} fetched studies are relevant "
                f"({share:.1%} < {cfg.thresholds.min_relevant_share:.1%})"
            )

    unknown = sorted(
        {s for s in trial["overall_status"].drop_nulls().to_list() if s not in KNOWN_STATUSES}
    )
    if unknown:
        report.warnings.append(
            f"unknown_status: unrecognised overallStatus values: {', '.join(unknown)}"
        )
    return report
