"""Stop-risk v2 rows, labels and the cutoff split (spec 2026-11-15 §5.2, §5.3, §7.1).

Frozen evaluation design. C is the quarterly snapshot nearest ``CUTOFF`` (within
``MAX_CUTOFF_GAP_DAYS``); every "at or before C" below means "dated at or before that snapshot",
so a C snapshot dated a few days after 2021-12-01 is still C itself.

- Train: trials COMPLETED or TERMINATED in the C snapshot whose final (2026-01) label agrees
  with that status; one row per quarterly snapshot <= C where the trial is in scope, weight 1/k.
  Left out and counted (among trials in scope at some snapshot <= C): "unlabelled" (final
  status not a label, or missing from the final) and "relabelled" (final label differs from
  the status at C: it would carry a post-C change a trainer at C could not know).
- Holdout (test): trials in scope in the C snapshot, one row each (weight 1), labelled from
  the final snapshot; the rest are counted by reason (``EXCLUSIONS``; an unexpected final
  status such as WITHHELD goes to "other", never an error).
- Holdout rows are disjoint from ``ended_by`` (running at C vs ended at C); asserted.

Snapshots are taken as ``SnapshotSummary`` (ids, scope and status only), so the caller can load
one AACT snapshot at a time, summarize it and drop it.

Scope is the daily run's: running status, phase 1-3, a drug or biologic, and not finished in
all but status (``scope.finished_reason``). Interventional study type is not re-checked: the
AACT panel already keeps only trials that were interventional, phase 1-3 with a drug or
biologic in some archive, and ``Tables`` carries no study type.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date

import polars as pl

from trialradar.aact.adapter import Snapshot
from trialradar.risk.scope import LABELS, RUNNING, finished_reason, has_drug, in_phase_scope

CUTOFF = date(2021, 12, 1)
MAX_CUTOFF_GAP_DAYS = 31
"""The panel picks the archive nearest each quarter date within 31 days."""

EXCLUSIONS = ("running", "unknown", "withdrawn", "suspended", "missing", "other")
TRAIN_DROPS = ("unlabelled", "relabelled")
_EXCLUDED_STATUS = {"UNKNOWN": "unknown", "WITHDRAWN": "withdrawn", "SUSPENDED": "suspended"}

ROW_SCHEMA = pl.Schema(
    {"nct_id": pl.Utf8, "snapshot_date": pl.Date, "weight": pl.Float64, "label": pl.Int64}
)


@dataclass(frozen=True)
class SnapshotSummary:
    date: date
    present: frozenset[str]
    """Every trial in the snapshot, any status."""
    in_scope: frozenset[str]
    """Trials in the model's scope at this snapshot (see ``in_scope``)."""
    status: Mapping[str, str]
    """overall_status of every present trial."""


@dataclass(frozen=True)
class Rows:
    keys: pl.DataFrame
    """nct_id, snapshot_date, weight, label; sorted by nct_id then snapshot_date."""


def in_scope(snap: Snapshot) -> set[str]:
    """Trials in scope at the snapshot date: running, phase 1-3, a drug or biologic, and not
    finished in all but status."""
    types: dict[str, list[str]] = {}
    for nct, kind in snap.tables.intervention.select("nct_id", "type").iter_rows():
        types.setdefault(nct, []).append(kind)
    running = snap.tables.trial.filter(pl.col("overall_status").is_in(sorted(RUNNING)))
    return {
        r["nct_id"]
        for r in running.iter_rows(named=True)
        if in_phase_scope(list(r["phases"] or []))
        and has_drug(types.get(r["nct_id"], []))
        and finished_reason(r, r["nct_id"] in snap.has_results, snap.date) is None
    }


def summarize(snap: Snapshot) -> SnapshotSummary:
    trial = snap.tables.trial
    status = dict(zip(trial["nct_id"].to_list(), trial["overall_status"].to_list(), strict=True))
    if len(status) != trial.height:
        raise ValueError(f"duplicate nct_id in the {snap.date} snapshot")
    return SnapshotSummary(
        date=snap.date,
        present=frozenset(status),
        in_scope=frozenset(in_scope(snap)),
        status=status,
    )


def _reason(status: str) -> str:
    if status in RUNNING:
        return "running"
    return _EXCLUDED_STATUS.get(status, "other")


def labels(final: SnapshotSummary) -> tuple[dict[str, int], dict[str, int]]:
    """(label per nct_id, exclusion counts by reason) over every trial in the final snapshot.

    TERMINATED -> 1, COMPLETED -> 0; running, UNKNOWN, WITHDRAWN, SUSPENDED are counted, any
    other status under "other". "missing" is always 0 here (only ``holdout_rows`` knows who
    is missing)."""
    lab: dict[str, int] = {}
    excl = dict.fromkeys(EXCLUSIONS, 0)
    for nct, status in final.status.items():
        if status in LABELS:
            lab[nct] = LABELS[status]
        else:
            excl[_reason(status)] += 1
    return lab, excl


def _ordered(snapshots: Sequence[SnapshotSummary]) -> list[SnapshotSummary]:
    out = sorted(snapshots, key=lambda s: s.date)
    if len({s.date for s in out}) != len(out):
        raise ValueError("two snapshots share a date")
    return out


def cutoff_snapshot(snapshots: Sequence[SnapshotSummary], cutoff: date) -> SnapshotSummary:
    """The snapshot dated nearest `cutoff`; raises unless within MAX_CUTOFF_GAP_DAYS."""
    if not snapshots:
        raise ValueError("no snapshots")
    near = min(_ordered(snapshots), key=lambda s: abs((s.date - cutoff).days))
    if abs((near.date - cutoff).days) > MAX_CUTOFF_GAP_DAYS:
        raise ValueError(
            f"no snapshot within {MAX_CUTOFF_GAP_DAYS} days of {cutoff.isoformat()} "
            f"(nearest {near.date.isoformat()})"
        )
    return near


def _upto(snapshots: Sequence[SnapshotSummary], cutoff: date) -> list[SnapshotSummary]:
    c = cutoff_snapshot(snapshots, cutoff)
    return [s for s in _ordered(snapshots) if s.date <= c.date]


def ended_by(snapshots: Sequence[SnapshotSummary], cutoff: date) -> set[str]:
    """Trials COMPLETED or TERMINATED in the cutoff snapshot."""
    c = cutoff_snapshot(snapshots, cutoff)
    return {n for n, s in c.status.items() if s in LABELS}


def _frame(rows: list[tuple[str, date, float, int]]) -> pl.DataFrame:
    return pl.DataFrame(rows, schema=ROW_SCHEMA, orient="row").sort("nct_id", "snapshot_date")


def train_rows(
    snapshots: Sequence[SnapshotSummary], cutoff: date, label: Mapping[str, int]
) -> tuple[Rows, dict[str, int]]:
    """One row per (trial, snapshot <= C where in scope) for trials ended at C whose final
    label agrees with their status at C; weight 1/k for a trial with k rows.

    Also returns counts (``TRAIN_DROPS``) of ended-at-C trials that were in scope at some
    snapshot <= C but left out: "unlabelled" (no final label: missing from the final or a
    non-label status) and "relabelled" (final label differs from the status at C)."""
    c = cutoff_snapshot(snapshots, cutoff)
    ended = ended_by(snapshots, cutoff)
    dates: dict[str, list[date]] = {}
    for s in _upto(snapshots, cutoff):
        for n in s.in_scope & ended:
            dates.setdefault(n, []).append(s.date)
    dropped = dict.fromkeys(TRAIN_DROPS, 0)
    rows: list[tuple[str, date, float, int]] = []
    for n, ds in dates.items():
        if n not in label:
            dropped["unlabelled"] += 1
        elif label[n] != LABELS[c.status[n]]:
            dropped["relabelled"] += 1
        else:
            rows.extend((n, d, 1.0 / len(ds), label[n]) for d in ds)
    return Rows(keys=_frame(rows)), dropped


def holdout_rows(
    snapshots: Sequence[SnapshotSummary], cutoff: date, final: SnapshotSummary
) -> tuple[Rows, dict[str, int]]:
    """The test set: trials in scope at C, labelled from `final` (weight 1), plus exclusion
    counts by reason (``EXCLUSIONS``; missing = absent from `final`, other = an unexpected
    final status). Disjoint from ``ended_by`` (asserted)."""
    c = cutoff_snapshot(snapshots, cutoff)
    if final.date <= c.date:
        raise ValueError(f"final snapshot {final.date} must be after the cutoff snapshot {c.date}")
    lab, _ = labels(final)
    excl = dict.fromkeys(EXCLUSIONS, 0)
    rows: list[tuple[str, date, float, int]] = []
    for n in sorted(c.in_scope):
        if n in lab:
            rows.append((n, c.date, 1.0, lab[n]))
        elif n not in final.present:
            excl["missing"] += 1
        else:
            excl[_reason(final.status[n])] += 1
    holdout = Rows(keys=_frame(rows))
    if overlap := ended_by(snapshots, cutoff) & set(holdout.keys["nct_id"].to_list()):
        raise AssertionError(f"holdout rows overlap ended_by: {sorted(overlap)[:5]}")
    return holdout, excl


def final_record_before(
    snapshots: Sequence[SnapshotSummary], cutoff: date, ids: set[str]
) -> dict[str, date]:
    """For the v1-recipe: the latest snapshot <= C in which each id appears (any status).
    Ids that never appear by C are left out."""
    out: dict[str, date] = {}
    for s in _upto(snapshots, cutoff):
        for n in s.present & ids:
            out[n] = s.date
    return out


__all__ = [
    "CUTOFF",
    "EXCLUSIONS",
    "MAX_CUTOFF_GAP_DAYS",
    "ROW_SCHEMA",
    "TRAIN_DROPS",
    "Rows",
    "SnapshotSummary",
    "cutoff_snapshot",
    "ended_by",
    "final_record_before",
    "holdout_rows",
    "in_scope",
    "labels",
    "summarize",
    "train_rows",
]
