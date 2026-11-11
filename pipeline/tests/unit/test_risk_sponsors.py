from __future__ import annotations

from datetime import date

import polars as pl

from trialradar.risk import sponsors


def _trial(nct, sponsor, start, status, end=None, pcd=None):
    return {
        "nct_id": nct,
        "lead_sponsor": sponsor,
        "start_date": start,
        "overall_status": status,
        "completion_date": end,
        "primary_completion_date": pcd,
    }


def _frame(rows):
    return pl.DataFrame(
        rows,
        schema={
            "nct_id": pl.Utf8,
            "lead_sponsor": pl.Utf8,
            "start_date": pl.Date,
            "overall_status": pl.Utf8,
            "completion_date": pl.Date,
            "primary_completion_date": pl.Date,
        },
    )


def _fixture():
    return _frame(
        [
            _trial("A", "S", date(2010, 1, 1), "TERMINATED", date(2012, 1, 1)),
            _trial("B", "S", date(2013, 1, 1), "COMPLETED", None, date(2016, 1, 1)),
            _trial("C", "S", date(2014, 1, 1), "RECRUITING"),
            _trial("D", "S", date(2011, 1, 1), "WITHDRAWN", date(2011, 6, 1)),
            _trial("E", None, date(2011, 1, 1), "COMPLETED", date(2012, 1, 1)),
            _trial("F", "S", date(2011, 1, 1), "COMPLETED"),
        ]
    )


def test_history_rows_labelled_dated_only():
    h = sponsors.history_rows(_fixture())
    assert list(h.columns) == ["sponsor", "end_date", "stopped"]
    assert sorted(h["stopped"].to_list()) == [0, 1]
    assert h.height == 2


def test_sponsor_history_ignores_later_trials():
    t = _fixture()
    out = sponsors.prior_counts(t.filter(pl.col("nct_id") == "C"), sponsors.history_rows(t))
    row = out.row(0, named=True)
    assert row["sponsor_prior_n"] == 1
    assert row["sponsor_prior_stopped"] == 1


def test_prior_counts_excludes_self():
    t = _frame([_trial("A", "S", date(2010, 1, 1), "TERMINATED", date(2012, 1, 1))])
    out = sponsors.prior_counts(t, sponsors.history_rows(t))
    assert out.row(0, named=True)["sponsor_prior_n"] == 0


def test_prior_counts_one_row_per_trial_even_without_history():
    t = _fixture()
    out = sponsors.prior_counts(t, sponsors.history_rows(t))
    assert out.height == t.height
    assert out.filter(pl.col("nct_id") == "E").row(0, named=True)["sponsor_prior_n"] == 0


def test_aggregate_one_row_per_sponsor():
    h = sponsors.history_rows(_fixture())
    agg = sponsors.aggregate(h, date(2026, 1, 1))
    assert list(agg.columns) == ["sponsor", "earlier", "stopped", "as_of"]
    assert agg.height == 1
    assert agg.row(0, named=True)["earlier"] == 2
    assert agg.row(0, named=True)["stopped"] == 1


def test_live_counts_unknown_sponsor_zero():
    agg = sponsors.aggregate(sponsors.history_rows(_fixture()), date(2026, 1, 1))
    trials = pl.DataFrame(
        {
            "nct_id": ["X", "Y", "Z"],
            "lead_sponsor": ["S", "Nobody", None],
            "start_date": [date(2025, 1, 1)] * 3,
        }
    )
    out = sponsors.live_counts(trials, agg).sort("nct_id")
    assert out["sponsor_prior_n"].to_list() == [2, 0, 0]
    assert out["sponsor_prior_stopped"].to_list() == [1, 0, 0]
