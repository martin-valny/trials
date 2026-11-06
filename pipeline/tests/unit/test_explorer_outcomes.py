from __future__ import annotations

from datetime import date

import polars as pl

from trialradar.explorer.outcomes import can_succeed, in_pool, label_outcomes, top_phase

Row = tuple[str, list[str], str, date | None]


def _trial(rows: list[Row]) -> pl.DataFrame:
    return pl.DataFrame(
        {
            "nct_id": [r[0] for r in rows],
            "phases": [r[1] for r in rows],
            "overall_status": [r[2] for r in rows],
            "start_date": [r[3] for r in rows],
        },
        schema={
            "nct_id": pl.Utf8,
            "phases": pl.List(pl.Utf8),
            "overall_status": pl.Utf8,
            "start_date": pl.Date,
        },
    )


def _fs(*names: str) -> frozenset[str]:
    return frozenset(names)


def test_phase2_completed_drug_later_in_phase3_succeeds() -> None:
    t = _trial(
        [
            ("A", ["PHASE2"], "COMPLETED", date(2015, 1, 1)),
            ("B", ["PHASE3"], "RECRUITING", date(2018, 1, 1)),
        ]
    )
    out = label_outcomes(t, {"A": _fs("x"), "B": _fs("x")})
    assert out["A"] == "succeeded"
    assert out["B"] == "running"


def test_comparator_drug_does_not_count() -> None:
    t = _trial(
        [
            ("A", ["PHASE2"], "COMPLETED", date(2015, 1, 1)),
            ("B", ["PHASE3"], "COMPLETED", date(2018, 1, 1)),
        ]
    )
    out = label_outcomes(t, {"A": _fs("x"), "B": _fs("y")})
    assert out["A"] == "completed_unknown"


def test_already_late_phase_drug_does_not_count() -> None:
    t = _trial(
        [
            ("E", ["PHASE3"], "TERMINATED", date(2010, 1, 1)),
            ("A", ["PHASE2"], "COMPLETED", date(2015, 1, 1)),
            ("B", ["PHASE3"], "RECRUITING", date(2018, 1, 1)),
        ]
    )
    out = label_outcomes(t, {"E": _fs("x"), "A": _fs("x"), "B": _fs("x")})
    assert out["A"] == "completed_unknown"


def test_later_trial_must_start_after() -> None:
    t = _trial(
        [
            ("A", ["PHASE2"], "COMPLETED", date(2015, 1, 1)),
            ("B", ["PHASE3"], "COMPLETED", date(2015, 1, 1)),
        ]
    )
    out = label_outcomes(t, {"A": _fs("x"), "B": _fs("x")})
    assert out["A"] == "completed_unknown"


def test_withdrawn_later_trial_ignored() -> None:
    t = _trial(
        [
            ("A", ["PHASE2"], "COMPLETED", date(2015, 1, 1)),
            ("B", ["PHASE3"], "WITHDRAWN", date(2018, 1, 1)),
        ]
    )
    out = label_outcomes(t, {"A": _fs("x"), "B": _fs("x")})
    assert out["A"] == "completed_unknown"
    assert out["B"] == "stopped"


def test_phase3_never_succeeds() -> None:
    t = _trial(
        [
            ("A", ["PHASE3"], "COMPLETED", date(2015, 1, 1)),
            ("B", ["PHASE4"], "COMPLETED", date(2018, 1, 1)),
        ]
    )
    out = label_outcomes(t, {"A": _fs("x"), "B": _fs("x")})
    assert out["A"] == "completed_unknown"


def test_combined_phase2_phase3_uses_phase3() -> None:
    t = _trial(
        [
            ("A", ["PHASE2", "PHASE3"], "COMPLETED", date(2015, 1, 1)),
            ("B", ["PHASE3"], "COMPLETED", date(2018, 1, 1)),
            ("C", ["PHASE2", "PHASE3"], "COMPLETED", date(2016, 1, 1)),
            ("D", ["PHASE4"], "COMPLETED", date(2019, 1, 1)),
        ]
    )
    out = label_outcomes(t, {"A": _fs("x"), "B": _fs("x"), "C": _fs("z"), "D": _fs("z")})
    assert out["A"] == "completed_unknown"
    assert out["C"] == "succeeded"


def test_status_buckets() -> None:
    d = date(2015, 1, 1)
    rows: list[Row] = [
        ("T", ["PHASE2"], "TERMINATED", d),
        ("W", ["PHASE2"], "WITHDRAWN", d),
        ("S", ["PHASE2"], "SUSPENDED", d),
        ("R", ["PHASE2"], "RECRUITING", d),
        ("U", ["PHASE2"], "UNKNOWN", d),
        ("O", ["PHASE2"], "WEIRD", d),
    ]
    out = label_outcomes(_trial(rows), {})
    assert out == {
        "T": "stopped",
        "W": "stopped",
        "S": "stopped",
        "R": "running",
        "U": "unknown",
        "O": "unknown",
    }


def test_missing_start_date_never_succeeds() -> None:
    t = _trial(
        [
            ("A", ["PHASE2"], "COMPLETED", None),
            ("B", ["PHASE3"], "COMPLETED", date(2018, 1, 1)),
            ("C", ["PHASE2"], "COMPLETED", date(2015, 1, 1)),
            ("N", ["PHASE3"], "COMPLETED", None),
        ]
    )
    out = label_outcomes(t, {"A": _fs("x"), "B": _fs("x"), "C": _fs("x"), "N": _fs("x")})
    assert out["A"] == "completed_unknown"
    # undated PHASE3 trial is no evidence for (a) or (b)
    assert out["C"] == "succeeded"


def test_na_phase_is_no_evidence() -> None:
    t = _trial(
        [
            ("A", ["PHASE2"], "COMPLETED", date(2015, 1, 1)),
            ("B", ["NA"], "COMPLETED", date(2018, 1, 1)),
        ]
    )
    assert label_outcomes(t, {"A": _fs("x"), "B": _fs("x")})["A"] == "completed_unknown"


def test_top_phase_and_in_pool() -> None:
    assert top_phase(["PHASE2", "PHASE3"]) == "PHASE3"
    assert top_phase(["NA"]) == "NA"
    assert top_phase([]) is None
    assert not in_pool(["PHASE3"], "stopped", True)
    assert in_pool(["PHASE2", "PHASE3"], "completed_unknown", True)
    assert not in_pool(["NA"], "stopped", True)
    assert not in_pool(["PHASE4"], "completed_unknown", True)
    assert not in_pool(["PHASE2"], "running", True)
    assert in_pool(["PHASE2"], "succeeded", True)
    assert can_succeed(["PHASE1"])
    assert not can_succeed([])


def test_two_drugs_one_blocked_other_qualifies() -> None:
    t = _trial(
        [
            ("E", ["PHASE3"], "COMPLETED", date(2010, 1, 1)),
            ("A", ["PHASE2"], "COMPLETED", date(2015, 1, 1)),
            ("B", ["PHASE3"], "RECRUITING", date(2018, 1, 1)),
        ]
    )
    out = label_outcomes(t, {"E": _fs("x"), "A": _fs("x", "z"), "B": _fs("z")})
    assert out["A"] == "succeeded"


def test_same_day_phase3_does_not_block() -> None:
    t = _trial(
        [
            ("A", ["PHASE2"], "COMPLETED", date(2015, 1, 1)),
            ("S", ["PHASE3"], "COMPLETED", date(2015, 1, 1)),
            ("L", ["PHASE3"], "COMPLETED", date(2016, 1, 1)),
        ]
    )
    out = label_outcomes(t, {"A": _fs("x"), "S": _fs("x"), "L": _fs("x")})
    assert out["A"] == "succeeded"


def test_earlier_phase4_and_withdrawn_phase3_block() -> None:
    for earlier_phase, earlier_status in [("PHASE4", "COMPLETED"), ("PHASE3", "WITHDRAWN")]:
        t = _trial(
            [
                ("E", [earlier_phase], earlier_status, date(2010, 1, 1)),
                ("A", ["PHASE2"], "COMPLETED", date(2015, 1, 1)),
                ("L", ["PHASE3"], "COMPLETED", date(2018, 1, 1)),
            ]
        )
        out = label_outcomes(t, {"E": _fs("x"), "A": _fs("x"), "L": _fs("x")})
        assert out["A"] == "completed_unknown"


def test_more_status_buckets() -> None:
    d = date(2015, 1, 1)
    rows: list[Row] = [
        ("N", ["PHASE2"], "NOT_YET_RECRUITING", d),
        ("A", ["PHASE2"], "ACTIVE_NOT_RECRUITING", d),
        ("E", ["PHASE2"], "ENROLLING_BY_INVITATION", d),
    ]
    t = _trial(rows).vstack(
        pl.DataFrame(
            {"nct_id": ["Z"], "phases": [["PHASE2"]], "overall_status": [None], "start_date": [d]},
            schema=_trial([]).schema,
        )
    )
    out = label_outcomes(t, {})
    assert out == {"N": "running", "A": "running", "E": "running", "Z": "unknown"}


def test_phase4_and_na_completed_never_succeed() -> None:
    t = _trial(
        [
            ("P4", ["PHASE4"], "COMPLETED", date(2015, 1, 1)),
            ("NA", ["NA"], "COMPLETED", date(2015, 1, 1)),
            ("L", ["PHASE4"], "COMPLETED", date(2020, 1, 1)),
        ]
    )
    out = label_outcomes(t, {"P4": _fs("x"), "NA": _fs("x"), "L": _fs("x")})
    assert out["P4"] == "completed_unknown"
    assert out["NA"] == "completed_unknown"


def test_drug_free_trial_is_never_in_pool() -> None:
    """A trial without a cleaned experimental drug cannot succeed, so it is not in the pool (R18)."""
    for outcome in ("succeeded", "stopped", "completed_unknown"):
        assert in_pool(["PHASE2"], outcome, True)
        assert not in_pool(["PHASE2"], outcome, False)
