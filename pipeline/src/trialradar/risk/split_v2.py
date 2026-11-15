"""Stop-risk v2 rows, labels and the cutoff split (spec 2026-11-15 §5.2, §5.3, §7.1).

Frozen evaluation design. C is the quarterly snapshot nearest ``CUTOFF`` (within
``MAX_CUTOFF_GAP_DAYS``); every "at or before C" below means "dated at or before that snapshot",
so a C snapshot dated a few days after 2021-12-01 is still C itself.

- Train: trials COMPLETED or TERMINATED in the C snapshot whose final (2026-01) label agrees
  with that status; one row per quarterly snapshot <= C where the trial is in scope, weight 1/k.
  A trial whose final label differs from its status at C is left out: its label would carry
  a post-C change a trainer at C could not know.
- Test: trials in scope in the C snapshot, one row each (weight 1), labelled from the final
  snapshot; the rest are counted by reason.
- Disjoint by construction (ended at C vs running at C) and asserted.

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

EXCLUSIONS = ("running", "unknown", "withdrawn", "suspended", "missing")
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
    if status in _EXCLUDED_STATUS:
        return _EXCLUDED_STATUS[status]
    raise ValueError(f"unexpected final status {status!r}: neither a label nor an exclusion")


def labels(final: SnapshotSummary) -> tuple[dict[str, int], dict[str, int]]:
    """(label per nct_id, exclusion counts by reason) over every trial in the final snapshot.

    TERMINATED -> 1, COMPLETED -> 0; running, UNKNOWN, WITHDRAWN, SUSPENDED are counted.
    "missing" is always 0 here (only ``test_rows`` knows who is missing). Any other status
    raises."""
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
) -> Rows:
    """One row per (trial, snapshot <= C where in scope) for trials ended at C whose final
    label agrees with their status at C; weight 1/k for a trial with k rows."""
    c = cutoff_snapshot(snapshots, cutoff)
    ids = {n for n in ended_by(snapshots, cutoff) if label.get(n) == LABELS[c.status[n]]}
    dates: dict[str, list[date]] = {}
    for s in _upto(snapshots, cutoff):
        for n in s.in_scope & ids:
            dates.setdefault(n, []).append(s.date)
    rows = [(n, d, 1.0 / len(ds), label[n]) for n, ds in dates.items() for d in ds]
    return Rows(keys=_frame(rows))


def test_rows(
    snapshots: Sequence[SnapshotSummary], cutoff: date, final: SnapshotSummary
) -> tuple[Rows, dict[str, int]]:
    """Trials in scope at C, labelled from `final` (weight 1), plus exclusion counts by
    reason (running, unknown, withdrawn, suspended, missing = absent from `final`)."""
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
    test = Rows(keys=_frame(rows))
    train_ids = ended_by(snapshots, cutoff)
    if overlap := train_ids & set(test.keys["nct_id"].to_list()):
        raise AssertionError(f"train/test overlap: {sorted(overlap)[:5]}")
    return test, excl


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
    "Rows",
    "SnapshotSummary",
    "cutoff_snapshot",
    "ended_by",
    "final_record_before",
    "in_scope",
    "labels",
    "summarize",
    "test_rows",
    "train_rows",
]
