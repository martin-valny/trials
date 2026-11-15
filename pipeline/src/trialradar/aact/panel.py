"""Compact quarterly panel of AACT tables, built one archive at a time.

Each archive contributes only the kept columns of nine tables, restricted to the in-scope
trials (interventional, phase 1-3, at least one drug/biological intervention), written as
one Parquet file per table per snapshot date. All values stay strings (dates included);
parsing happens downstream.
"""

from __future__ import annotations

import logging
import re
import shutil
from datetime import date
from pathlib import Path

import polars as pl

from trialradar.aact.archive import Archive

log = logging.getLogger(__name__)

TABLES: dict[str, tuple[str, ...]] = {
    "studies": (
        "nct_id",
        "study_type",
        "overall_status",
        "phase",
        "start_date",
        "start_date_type",
        "primary_completion_date",
        "primary_completion_date_type",
        "completion_date",
        "enrollment",
        "enrollment_type",
        "last_update_posted_date",
        "results_first_posted_date",
        "source_class",
    ),
    "interventions": ("nct_id", "intervention_type", "name"),
    "facilities": ("nct_id", "name", "city", "country", "status"),
    "design_groups": ("nct_id", "group_type"),
    "design_outcomes": ("nct_id", "outcome_type"),
    "conditions": ("nct_id", "name"),
    "browse_conditions": ("nct_id", "mesh_term", "mesh_type"),
    "sponsors": ("nct_id", "name", "lead_or_collaborator", "agency_class"),
    "designs": ("nct_id", "allocation", "masking"),
}

NCT_RE = r"^NCT\d{8}$"
QUARTER_MONTHS = (3, 6, 9, 12)
MAX_GAP_DAYS = 20
_warned: set[tuple[str, str]] = set()


def pick_quarterly(archives: list[Archive]) -> list[Archive]:
    """Nearest archive to each 1 Mar/Jun/Sep/Dec (2018-12..2025-12), plus the latest in 2026-01."""
    picked: list[Archive] = []
    for year in range(2018, 2026):
        for month in QUARTER_MONTHS:
            target = date(year, month, 1)
            if target < date(2018, 12, 1):
                continue
            near = min(archives, key=lambda a: abs((a.snap_date - target).days), default=None)
            if near is None or abs((near.snap_date - target).days) > MAX_GAP_DAYS:
                log.warning(
                    "no AACT archive within %d days of %s; quarter skipped", MAX_GAP_DAYS, target
                )
                continue
            if near not in picked:
                picked.append(near)
    jan = [a for a in archives if (a.snap_date.year, a.snap_date.month) == (2026, 1)]
    if jan:
        last = max(jan, key=lambda a: a.snap_date)
        if last not in picked:
            picked.append(last)
    return sorted(picked, key=lambda a: a.snap_date)


_EARLY = re.compile(r"EARLY[ _]?PHASE[ _]?1")
_PHASE = re.compile(r"PHASE[ _]?([123])")


def _phase_in_scope(phase: str | None) -> bool:
    if not phase:
        return False
    return _PHASE.search(_EARLY.sub("", phase.upper())) is not None


def in_scope_ids(studies: pl.DataFrame, interventions: pl.DataFrame) -> set[str]:
    """Interventional phase 1-3 trials with at least one Drug/Biological intervention (any status)."""
    drug = set(
        interventions.filter(
            pl.col("intervention_type").str.to_uppercase().is_in(["DRUG", "BIOLOGICAL"])
        )["nct_id"].to_list()
    )
    rows = studies.filter(pl.col("study_type").str.to_uppercase() == "INTERVENTIONAL")
    return {
        n
        for n, ph in zip(rows["nct_id"], rows["phase"], strict=True)
        if n in drug and _phase_in_scope(ph)
    }


def _read_table(path: Path, table: str, columns: tuple[str, ...]) -> pl.DataFrame:
    """Kept columns of one pipe-delimited AACT table as strings; absent columns become null."""
    if not path.exists():
        if (table, "*") not in _warned:
            _warned.add((table, "*"))
            log.warning("table %s missing from archive; filled with nulls", table)
        return pl.DataFrame(schema=dict.fromkeys(columns, pl.String))
    lazy = pl.scan_csv(path, separator="|", infer_schema=False, quote_char='"')
    present = set(lazy.collect_schema().names())
    for c in columns:
        if c not in present and (table, c) not in _warned:
            _warned.add((table, c))
            log.warning("column %s.%s missing from archive; filled with nulls", table, c)
    exprs = [pl.col(c) if c in present else pl.lit(None, dtype=pl.String).alias(c) for c in columns]
    return lazy.select(exprs).filter(pl.col("nct_id").str.contains(NCT_RE)).collect()


def _write_replace(df: pl.DataFrame, out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".parquet.tmp")
    df.write_parquet(tmp)
    tmp.replace(out)


def fold_archive(raw_dir: Path, snap_date: date, panel_dir: Path, ids: set[str] | None) -> set[str]:
    """Fold one archive's extracted tables into the panel, then delete `raw_dir`.

    Keeps rows whose nct_id is in scope in this archive or in `ids`. Returns this archive's own
    in-scope ids so the caller can accumulate them. Existing parquet for the date is replaced.
    """
    frames = {t: _read_table(raw_dir / f"{t}.txt", t, cols) for t, cols in TABLES.items()}
    own = in_scope_ids(frames["studies"], frames["interventions"])
    keep = list(own | (ids or set()))
    # studies is written last: its presence marks the date complete for resume
    for t in [*[t for t in TABLES if t != "studies"], "studies"]:
        df = (
            frames[t]
            .filter(pl.col("nct_id").is_in(keep))
            .with_columns(snapshot_date=pl.lit(snap_date))
        )
        _write_replace(df, panel_dir / t / f"{snap_date.isoformat()}.parquet")
    shutil.rmtree(raw_dir)
    return own


def monthly_studies(src_dir: Path, panel_dir: Path, ids: set[str]) -> None:
    """Copy on-disk monthly `studies` extracts, filtered to `ids`, into panel_dir/studies_monthly."""
    keep = list(ids)
    for f in sorted(src_dir.glob("*.parquet")):
        df = pl.read_parquet(f).filter(pl.col("nct_id").is_in(keep))
        _write_replace(df, panel_dir / "studies_monthly" / f.name)


__all__ = ["TABLES", "fold_archive", "in_scope_ids", "monthly_studies", "pick_quarterly"]
