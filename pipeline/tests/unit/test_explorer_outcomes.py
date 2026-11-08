from __future__ import annotations

from datetime import date

import polars as pl

from trialradar.explorer.outcomes import (
    TrialLabels,
    can_succeed,
    in_pool,
    label_outcomes,
    success_drugs,
    success_labels,
    top_phase,
)

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


def _labels(t: pl.DataFrame, *labels: str) -> TrialLabels:
    """Every trial in ``t`` gets the same condition labels."""
    return {n: frozenset(labels) for n in t["nct_id"].to_list()}


def test_phase2_completed_drug_later_in_phase3_succeeds() -> None:
    t = _trial(
        [
            ("A", ["PHASE2"], "COMPLETED", date(2015, 1, 1)),
            ("B", ["PHASE3"], "RECRUITING", date(2018, 1, 1)),
        ]
    )
    out = label_outcomes(t, {"A": _fs("x"), "B": _fs("x")}, _labels(t, "MS"))
    assert out["A"] == "succeeded"
    assert out["B"] == "running"


def test_comparator_drug_does_not_count() -> None:
    t = _trial(
        [
            ("A", ["PHASE2"], "COMPLETED", date(2015, 1, 1)),
            ("B", ["PHASE3"], "COMPLETED", date(2018, 1, 1)),
        ]
    )
    out = label_outcomes(t, {"A": _fs("x"), "B": _fs("y")}, _labels(t, "MS"))
    assert out["A"] == "completed_unknown"


def test_already_late_phase_drug_does_not_count() -> None:
    t = _trial(
        [
            ("E", ["PHASE3"], "TERMINATED", date(2010, 1, 1)),
            ("A", ["PHASE2"], "COMPLETED", date(2015, 1, 1)),
            ("B", ["PHASE3"], "RECRUITING", date(2018, 1, 1)),
        ]
    )
    out = label_outcomes(t, {"E": _fs("x"), "A": _fs("x"), "B": _fs("x")}, _labels(t, "MS"))
    assert out["A"] == "completed_unknown"


def test_later_trial_must_start_after() -> None:
    t = _trial(
        [
            ("A", ["PHASE2"], "COMPLETED", date(2015, 1, 1)),
            ("B", ["PHASE3"], "COMPLETED", date(2015, 1, 1)),
        ]
    )
    out = label_outcomes(t, {"A": _fs("x"), "B": _fs("x")}, _labels(t, "MS"))
    assert out["A"] == "completed_unknown"


def test_withdrawn_later_trial_ignored() -> None:
    t = _trial(
        [
            ("A", ["PHASE2"], "COMPLETED", date(2015, 1, 1)),
            ("B", ["PHASE3"], "WITHDRAWN", date(2018, 1, 1)),
        ]
    )
    out = label_outcomes(t, {"A": _fs("x"), "B": _fs("x")}, _labels(t, "MS"))
    assert out["A"] == "completed_unknown"
    assert out["B"] == "stopped"


def test_phase3_never_succeeds() -> None:
    t = _trial(
        [
            ("A", ["PHASE3"], "COMPLETED", date(2015, 1, 1)),
            ("B", ["PHASE4"], "COMPLETED", date(2018, 1, 1)),
        ]
    )
    out = label_outcomes(t, {"A": _fs("x"), "B": _fs("x")}, _labels(t, "MS"))
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
    out = label_outcomes(
        t, {"A": _fs("x"), "B": _fs("x"), "C": _fs("z"), "D": _fs("z")}, _labels(t, "MS")
    )
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
    out = label_outcomes(_trial(rows), {}, _labels(_trial(rows), "MS"))
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
    out = label_outcomes(
        t, {"A": _fs("x"), "B": _fs("x"), "C": _fs("x"), "N": _fs("x")}, _labels(t, "MS")
    )
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
    assert (
        label_outcomes(t, {"A": _fs("x"), "B": _fs("x")}, _labels(t, "MS"))["A"]
        == "completed_unknown"
    )


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
    out = label_outcomes(t, {"E": _fs("x"), "A": _fs("x", "z"), "B": _fs("z")}, _labels(t, "MS"))
    assert out["A"] == "succeeded"


def test_same_day_phase3_does_not_block() -> None:
    t = _trial(
        [
            ("A", ["PHASE2"], "COMPLETED", date(2015, 1, 1)),
            ("S", ["PHASE3"], "COMPLETED", date(2015, 1, 1)),
            ("L", ["PHASE3"], "COMPLETED", date(2016, 1, 1)),
        ]
    )
    out = label_outcomes(t, {"A": _fs("x"), "S": _fs("x"), "L": _fs("x")}, _labels(t, "MS"))
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
        out = label_outcomes(t, {"E": _fs("x"), "A": _fs("x"), "L": _fs("x")}, _labels(t, "MS"))
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
    out = label_outcomes(t, {}, _labels(t, "MS"))
    assert out == {"N": "running", "A": "running", "E": "running", "Z": "unknown"}


def test_phase4_and_na_completed_never_succeed() -> None:
    t = _trial(
        [
            ("P4", ["PHASE4"], "COMPLETED", date(2015, 1, 1)),
            ("NA", ["NA"], "COMPLETED", date(2015, 1, 1)),
            ("L", ["PHASE4"], "COMPLETED", date(2020, 1, 1)),
        ]
    )
    out = label_outcomes(t, {"P4": _fs("x"), "NA": _fs("x"), "L": _fs("x")}, _labels(t, "MS"))
    assert out["P4"] == "completed_unknown"
    assert out["NA"] == "completed_unknown"


def test_drug_free_trial_is_never_in_pool() -> None:
    """A trial without a cleaned experimental drug cannot succeed, so it is not in the pool (R18)."""
    for outcome in ("succeeded", "stopped", "completed_unknown"):
        assert in_pool(["PHASE2"], outcome, True)
        assert not in_pool(["PHASE2"], outcome, False)


def test_progression_in_other_disease_does_not_count() -> None:
    t = _trial(
        [
            ("A", ["PHASE2"], "COMPLETED", date(2015, 1, 1)),
            ("B", ["PHASE3"], "RECRUITING", date(2018, 1, 1)),
        ]
    )
    out = label_outcomes(t, {"A": _fs("x"), "B": _fs("x")}, {"A": _fs("CIDP"), "B": _fs("MG")})
    assert out["A"] == "completed_unknown"


def test_multi_label_trial_succeeds_only_where_progressed() -> None:
    t = _trial(
        [
            ("A", ["PHASE2"], "COMPLETED", date(2015, 1, 1)),
            ("B", ["PHASE3"], "RECRUITING", date(2018, 1, 1)),
        ]
    )
    drugs = {"A": _fs("x"), "B": _fs("x")}
    labels = {"A": _fs("MG", "CIDP"), "B": _fs("MG")}
    sl = success_labels(t, drugs, labels)
    assert sl["A"] == _fs("MG")
    assert label_outcomes(t, drugs, labels)["A"] == "succeeded"


def test_late_phase_block_is_per_disease() -> None:
    # x already in Phase 3 for MS before A starts; A (CIDP Ph2) then x goes to Ph3 in CIDP
    t = _trial(
        [
            ("V", ["PHASE3"], "COMPLETED", date(2010, 1, 1)),
            ("A", ["PHASE2"], "COMPLETED", date(2015, 1, 1)),
            ("B", ["PHASE3"], "RECRUITING", date(2018, 1, 1)),
        ]
    )
    out = label_outcomes(
        t, {k: _fs("x") for k in "VAB"}, {"V": _fs("MS"), "A": _fs("CIDP"), "B": _fs("CIDP")}
    )
    assert out["A"] == "succeeded"


def test_unlabelled_trial_never_succeeds() -> None:
    t = _trial(
        [
            ("A", ["PHASE2"], "COMPLETED", date(2015, 1, 1)),
            ("B", ["PHASE3"], "RECRUITING", date(2018, 1, 1)),
        ]
    )
    out = label_outcomes(t, {"A": _fs("x"), "B": _fs("x")}, {"A": _fs(), "B": _fs("MS")})
    assert out["A"] == "completed_unknown"


def test_succeeded_by_lists_only_progressing_drugs() -> None:
    """1b: an aHSCT + cyclophosphamide trial that succeeded because cyclophosphamide moved
    on credits cyclophosphamide only; ``success_labels`` is unchanged."""
    t = _trial(
        [
            ("T", ["PHASE2"], "COMPLETED", date(2015, 1, 1)),
            ("U", ["PHASE3"], "RECRUITING", date(2018, 1, 1)),
        ]
    )
    drugs = {"T": _fs("ahsct-x", "cyclophosphamide"), "U": _fs("cyclophosphamide")}
    labels = _labels(t, "MS")
    assert success_drugs(t, drugs, labels)["T"] == _fs("cyclophosphamide")
    assert success_drugs(t, drugs, labels)["U"] == _fs()
    assert success_labels(t, drugs, labels) == {"T": _fs("MS"), "U": _fs()}


def test_success_drugs_need_the_same_label() -> None:
    """A drug that progressed only in another disease is not credited (R21)."""
    t = _trial(
        [
            ("T", ["PHASE2"], "COMPLETED", date(2015, 1, 1)),
            ("U", ["PHASE3"], "RECRUITING", date(2018, 1, 1)),
            ("W", ["PHASE3"], "RECRUITING", date(2019, 1, 1)),
        ]
    )
    drugs = {"T": _fs("a", "b"), "U": _fs("a"), "W": _fs("b")}
    labels = {"T": _fs("MS", "MG"), "U": _fs("MS"), "W": _fs("CIDP")}
    assert success_drugs(t, drugs, labels)["T"] == _fs("a")


def test_success_drugs_credit_every_progressing_drug() -> None:
    t = _trial(
        [
            ("T", ["PHASE2"], "COMPLETED", date(2015, 1, 1)),
            ("U", ["PHASE3"], "RECRUITING", date(2018, 1, 1)),
            ("W", ["PHASE3"], "RECRUITING", date(2019, 1, 1)),
        ]
    )
    drugs = {"T": _fs("a", "b"), "U": _fs("a"), "W": _fs("b")}
    labels = {"T": _fs("MS", "MG"), "U": _fs("MS"), "W": _fs("MG")}
    assert success_drugs(t, drugs, labels)["T"] == _fs("a", "b")
    assert success_labels(t, drugs, labels)["T"] == _fs("MS", "MG")
