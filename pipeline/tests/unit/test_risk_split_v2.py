"""Cutoff split, labels and exclusions for stop-risk v2 (spec 2026-11-15 §5.2, §5.3, §7.1)."""

from __future__ import annotations

from datetime import date
from typing import Any

import polars as pl
import pytest

from trialradar.aact.adapter import Snapshot
from trialradar.risk.split_v2 import (
    CUTOFF,
    SnapshotSummary,
    cutoff_snapshot,
    ended_by,
    final_record_before,
    holdout_rows,
    in_scope,
    labels,
    summarize,
    train_rows,
)
from trialradar.tables import SCHEMAS, Tables

FINAL = date(2026, 1, 31)


def _trial(
    nct: str,
    status: str,
    phases: tuple[str, ...] = ("PHASE2",),
    pcd: date | None = None,
    pcd_type: str | None = None,
) -> dict[str, Any]:
    row: dict[str, Any] = dict.fromkeys(SCHEMAS["trial"])
    row.update(
        nct_id=nct,
        phases=list(phases),
        overall_status=status,
        primary_completion_date=pcd,
        primary_completion_date_type=pcd_type,
    )
    return row


def _snap(
    day: date,
    trials: list[dict[str, Any]],
    *,
    no_drug: frozenset[str] = frozenset(),
    has_results: frozenset[str] = frozenset(),
) -> Snapshot:
    e = Tables.empty()
    iv = [
        {"nct_id": t["nct_id"], "type": "DEVICE" if t["nct_id"] in no_drug else "DRUG",
         "name": "x", "name_normalized": "x"}
        for t in trials
    ]  # fmt: skip
    tables = Tables(
        trial=pl.DataFrame(trials, schema=SCHEMAS["trial"]),
        condition=e.condition,
        intervention=pl.DataFrame(iv, schema=SCHEMAS["intervention"]),
        sponsor=e.sponsor,
        site=e.site,
        outcome=e.outcome,
    )
    return Snapshot(date=day, tables=tables, fields={}, has_results=set(has_results))


def _sum(day: date, status: dict[str, str], scope: set[str] | None = None) -> SnapshotSummary:
    """Hand-built summary: `scope` defaults to every running-status trial."""
    running = {"RECRUITING", "NOT_YET_RECRUITING", "ACTIVE_NOT_RECRUITING",
               "ENROLLING_BY_INVITATION"}  # fmt: skip
    if scope is None:
        scope = {n for n, s in status.items() if s in running}
    return SnapshotSummary(
        date=day, present=frozenset(status), in_scope=frozenset(scope), status=dict(status)
    )


Q = [date(2021, 3, 1), date(2021, 6, 2), date(2021, 9, 1), date(2021, 12, 3), date(2022, 3, 1)]


def _panel() -> tuple[list[SnapshotSummary], SnapshotSummary]:
    """A: ran 3 quarters then terminated by C. B: ran 1 quarter, completed by C.
    T: running at C, completed later. R: running at C and still running at the end.
    W: running at C, later withdrawn. M: running at C, missing from the final."""
    s = [
        _sum(Q[0], {"A": "RECRUITING", "B": "COMPLETED", "T": "RECRUITING"}),
        _sum(Q[1], {"A": "RECRUITING", "B": "ACTIVE_NOT_RECRUITING", "T": "RECRUITING"}),
        _sum(Q[2], {"A": "ACTIVE_NOT_RECRUITING", "B": "COMPLETED", "T": "RECRUITING"}),
        _sum(
            Q[3],
            {
                "A": "TERMINATED",
                "B": "COMPLETED",
                "T": "RECRUITING",
                "R": "RECRUITING",
                "W": "NOT_YET_RECRUITING",
                "M": "RECRUITING",
            },
        ),
        _sum(Q[4], {"A": "TERMINATED", "T": "RECRUITING", "M": "RECRUITING"}),
    ]
    final = _sum(
        FINAL,
        {"A": "TERMINATED", "B": "COMPLETED", "T": "COMPLETED", "R": "RECRUITING",
         "W": "WITHDRAWN"},
    )  # fmt: skip
    return s, final


# --- scope -----------------------------------------------------------------------------------


def test_in_scope_applies_status_phase_and_drug() -> None:
    snap = _snap(
        date(2021, 12, 1),
        [
            _trial("NCT1", "RECRUITING"),
            _trial("NCT2", "COMPLETED"),
            _trial("NCT3", "RECRUITING", phases=("PHASE4",)),
            _trial("NCT4", "RECRUITING", phases=("EARLY_PHASE1",)),
            _trial("NCT5", "RECRUITING"),
            _trial("NCT6", "ENROLLING_BY_INVITATION", phases=("PHASE1", "PHASE2")),
        ],
        no_drug=frozenset({"NCT5"}),
    )
    assert in_scope(snap) == {"NCT1", "NCT6"}


def test_finished_in_all_but_status_excluded() -> None:
    day = date(2021, 12, 1)
    snap = _snap(
        day,
        [
            _trial("RES", "RECRUITING"),
            _trial("DONE", "ACTIVE_NOT_RECRUITING", pcd=date(2021, 6, 1), pcd_type="ACTUAL"),
            # same dates, but ESTIMATED / still recruiting / not yet passed: all stay in scope
            _trial("EST", "ACTIVE_NOT_RECRUITING", pcd=date(2021, 6, 1), pcd_type="ESTIMATED"),
            _trial("REC", "RECRUITING", pcd=date(2021, 6, 1), pcd_type="ACTUAL"),
            _trial("TODAY", "ACTIVE_NOT_RECRUITING", pcd=day, pcd_type="ACTUAL"),
        ],
        has_results=frozenset({"RES"}),
    )
    assert in_scope(snap) == {"EST", "REC", "TODAY"}
    summary = summarize(snap)
    assert summary.in_scope == frozenset({"EST", "REC", "TODAY"})
    assert summary.present == frozenset({"RES", "DONE", "EST", "REC", "TODAY"})
    assert summary.status["RES"] == "RECRUITING"
    assert summary.date == day


def test_finished_rule_is_the_daily_runs() -> None:
    """One helper serves both: the daily run's reason codes come from the shared rule."""
    from trialradar.risk import apply, scope

    r = {"overall_status": "ACTIVE_NOT_RECRUITING", "primary_completion_date": date(2021, 1, 1),
         "primary_completion_date_type": "ACTUAL"}  # fmt: skip
    assert apply._finished_reason(r, None, date(2021, 2, 1)) == scope.finished_reason(
        r, False, date(2021, 2, 1)
    )
    assert scope.finished_reason(r, False, date(2021, 1, 1)) is None
    assert scope.finished_reason({**r, "overall_status": "RECRUITING"}, True, date(2020, 1, 1))


# --- labels ----------------------------------------------------------------------------------


def test_labels_and_counts() -> None:
    final = _sum(
        FINAL,
        {"a": "TERMINATED", "b": "COMPLETED", "c": "RECRUITING", "d": "ACTIVE_NOT_RECRUITING",
         "e": "UNKNOWN", "f": "WITHDRAWN", "g": "SUSPENDED"},
    )  # fmt: skip
    lab, excl = labels(final)
    assert lab == {"a": 1, "b": 0}
    assert excl == {"running": 2, "unknown": 1, "withdrawn": 1, "suspended": 1, "missing": 0,
                    "other": 0}  # fmt: skip


def test_unexpected_final_status_counted_as_other() -> None:
    lab, excl = labels(_sum(FINAL, {"a": "WITHHELD", "b": "COMPLETED"}))
    assert lab == {"b": 0}
    assert excl["other"] == 1
    s, final = _panel()
    odd = _sum(FINAL, {**final.status, "R": "WITHHELD"})
    _, excl = holdout_rows(s, CUTOFF, odd)
    assert excl == {"running": 0, "unknown": 0, "withdrawn": 1, "suspended": 0, "missing": 1,
                    "other": 1}  # fmt: skip


# --- cutoff snapshot -------------------------------------------------------------------------


def test_cutoff_snapshot_nearest_and_within_window() -> None:
    s, _ = _panel()
    assert cutoff_snapshot(s, CUTOFF).date == date(2021, 12, 3)
    with pytest.raises(ValueError, match="2021-12-01"):
        cutoff_snapshot([x for x in s if x.date != date(2021, 12, 3)], CUTOFF)


# --- split -----------------------------------------------------------------------------------


def test_ended_by_reads_the_cutoff_snapshot() -> None:
    s, _ = _panel()
    # The cutoff snapshot is dated 2021-12-03, after CUTOFF: it is still "the C snapshot".
    assert ended_by(s, CUTOFF) == {"A", "B"}


def test_train_and_test_disjoint() -> None:
    s, final = _panel()
    lab, _ = labels(final)
    train = train_rows(s, CUTOFF, lab)[0]
    test, _ = holdout_rows(s, CUTOFF, final)
    tr = set(train.keys["nct_id"].to_list())
    te = set(test.keys["nct_id"].to_list())
    assert tr == {"A", "B"}
    assert te == {"T"}
    assert not tr & te
    # No training row is dated after the cutoff snapshot.
    assert train.keys["snapshot_date"].max() <= date(2021, 12, 3)  # type: ignore[operator]


def test_weights_sum_to_one_per_trial() -> None:
    s, final = _panel()
    lab, _ = labels(final)
    keys = train_rows(s, CUTOFF, lab)[0].keys
    assert keys.schema == pl.Schema(
        {"nct_id": pl.Utf8, "snapshot_date": pl.Date, "weight": pl.Float64, "label": pl.Int64}
    )
    per = dict(keys.group_by("nct_id").agg(pl.col("weight").sum()).iter_rows())
    assert per == pytest.approx({"A": 1.0, "B": 1.0})
    a = keys.filter(pl.col("nct_id") == "A")
    assert a["snapshot_date"].to_list() == Q[:3]
    assert a["weight"].to_list() == pytest.approx([1 / 3] * 3)
    assert set(a["label"].to_list()) == {1}
    b = keys.filter(pl.col("nct_id") == "B")
    assert b["snapshot_date"].to_list() == [Q[1]]  # only the quarter it was in scope
    assert b["label"].to_list() == [0]
    assert keys.equals(keys.sort("nct_id", "snapshot_date"))


def test_reappearing_trial_rows_only_where_present() -> None:
    s = [
        _sum(Q[0], {"X": "RECRUITING"}),
        _sum(Q[1], {}),  # X absent from this archive
        _sum(Q[2], {"X": "RECRUITING"}),
        _sum(Q[3], {"X": "COMPLETED"}),
    ]
    keys = train_rows(s, CUTOFF, {"X": 0})[0].keys
    assert keys["snapshot_date"].to_list() == [Q[0], Q[2]]
    assert keys["weight"].to_list() == pytest.approx([0.5, 0.5])
    assert final_record_before(s, CUTOFF, {"X"}) == {"X": Q[3]}
    gone = [*s[:3], _sum(Q[3], {})]  # X absent from the C snapshot itself
    assert final_record_before(gone, CUTOFF, {"X"}) == {"X": Q[2]}


def test_train_excludes_unlabelled_and_relabelled() -> None:
    s = [
        _sum(Q[0], {"U": "RECRUITING", "G": "RECRUITING", "F": "RECRUITING", "K": "RECRUITING"}),
        _sum(
            Q[3],
            {
                "U": "COMPLETED",
                "G": "TERMINATED",
                "F": "COMPLETED",
                "K": "TERMINATED",
                "OLD": "COMPLETED",
            },
        ),
    ]
    # U: final status not a label. G: missing from the final (no label either). F: completed
    # at C but terminated in the final record (a post-C change a trainer at C could not know).
    # K: settled -> in. OLD: ended at C but never in scope by C -> not counted at all.
    rows, dropped = train_rows(s, CUTOFF, {"F": 1, "K": 1, "OLD": 0})
    assert rows.keys["nct_id"].to_list() == ["K"]
    assert dropped == {"unlabelled": 2, "relabelled": 1}


def test_train_counts_zero_when_nothing_dropped() -> None:
    s, final = _panel()
    lab, _ = labels(final)
    assert train_rows(s, CUTOFF, lab)[1] == {"unlabelled": 0, "relabelled": 0}


def test_missing_in_final_excluded_and_counted() -> None:
    s, final = _panel()
    test, excl = holdout_rows(s, CUTOFF, final)
    assert excl == {"running": 1, "unknown": 0, "withdrawn": 1, "suspended": 0, "missing": 1,
                    "other": 0}  # fmt: skip
    assert test.keys.rows() == [("T", date(2021, 12, 3), 1.0, 0)]
    assert test.keys.schema == pl.Schema(
        {"nct_id": pl.Utf8, "snapshot_date": pl.Date, "weight": pl.Float64, "label": pl.Int64}
    )


def test_holdout_rows_need_a_later_final() -> None:
    s, _ = _panel()
    with pytest.raises(ValueError, match="after the cutoff"):
        holdout_rows(s, CUTOFF, s[3])


def test_final_record_before_never_after_cutoff() -> None:
    s, _ = _panel()
    got = final_record_before(s, CUTOFF, {"A", "B", "T", "M", "nope"})
    # M appears at C and after; T every quarter; nothing dated after the C snapshot.
    assert got == {"A": Q[3], "B": Q[3], "T": Q[3], "M": Q[3]}
    early = [x for x in s if x.date != Q[3]]
    early.append(_sum(date(2021, 11, 20), {"A": "TERMINATED"}))  # nearest to C now 11-20
    got = final_record_before(early, CUTOFF, {"A", "T"})
    assert got == {"A": date(2021, 11, 20), "T": Q[2]}
    assert all(d <= date(2021, 11, 20) for d in got.values())
