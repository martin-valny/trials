"""The compact columnar document behind the intro page."""

from __future__ import annotations

from datetime import date
from typing import Any

from trialradar.intro import build_intro_doc

DAY = date(2026, 11, 12)


def trial(nct: str, x: float = 0.0, y: float = 0.0, **kw: Any) -> dict[str, Any]:
    return {
        "nct_id": nct,
        "x": x,
        "y": y,
        "outcome": kw.get("outcome", "running"),
        "approaches": kw.get("approaches", ["targeted"]),
        "start_year": kw.get("start_year", 2019),
    }


def explorer(*trials: dict[str, Any]) -> dict[str, Any]:
    return {
        "approaches": [
            {"key": "targeted", "label": "Targeted drugs"},
            {"key": "cell", "label": "Cell & transplant"},
        ],
        "trials": list(trials),
    }


def mark(n: str, c: int, s: str, dz: list[str] | None = None) -> dict[str, Any]:
    return {"n": n, "c": c, "s": s, "dz": dz or ["MS"], "drug": "d"}


def figure(*rows: tuple[str, list[dict[str, Any]]]) -> dict[str, Any]:
    return {"rows": [{"id": i, "label": i.upper(), "marks": m} for i, m in rows]}


def change(nct: str, field: str, reason: str | None = None) -> dict[str, Any]:
    return {"nct_id": nct, "field": field, "notable": reason is not None, "notable_reason": reason}


def test_columns_are_parallel_and_in_explorer_order() -> None:
    ex = explorer(trial("NCT2", start_year=2020), trial("NCT1", outcome="stopped"))
    doc = build_intro_doc(ex, None, None, [], DAY)
    t = doc["trials"]
    assert doc["generated_for"] == "2026-11-12" and doc["trial_count"] == 2
    assert doc["approaches"] == ex["approaches"]
    assert t["id"] == ["NCT2", "NCT1"]
    assert t["outcome"] == ["running", "stopped"] and t["start"] == [2020, 2019]
    assert all(len(col) == 2 for col in t.values())


def test_marks_index_rows_and_keep_state() -> None:
    fig = figure(
        ("cd20", [mark("NCT1", 3, "run")]),
        ("cd19", [mark("NCT1", 2, "adv", ["MS", "MG"]), mark("NCT2", 1, "stop")]),
    )
    doc = build_intro_doc(explorer(trial("NCT1"), trial("NCT2"), trial("NCT3")), fig, None, [], DAY)
    assert doc["rows"] == [{"id": "cd20", "label": "CD20"}, {"id": "cd19", "label": "CD19"}]
    assert doc["trials"]["marks"] == [[[0, 3, "run"], [1, 2, "adv"]], [[1, 1, "stop"]], []]
    assert doc["trials"]["dz"] == [["MS", "MG"], ["MS"], []]


def test_change_bin_prefers_notable() -> None:
    ch = [
        change("NCT1", "site_count"),
        change("NCT1", "completion_date", "date_slip_ge_90d"),
        change("NCT2", "site_count"),
        change("NCT2", "enrollment"),
    ]
    doc = build_intro_doc(
        explorer(trial("NCT1"), trial("NCT2"), trial("NCT3")), None, None, ch, DAY
    )
    assert doc["trials"]["change"] == [["dates", "date_slip_ge_90d"], ["sites", None], None]


def test_unknown_field_goes_to_other() -> None:
    doc = build_intro_doc(explorer(trial("NCT1")), None, None, [change("NCT1", "title")], DAY)
    assert doc["trials"]["change"] == [["other", None]]


def test_typical_is_median_and_null_without_risk() -> None:
    risk = {
        "trials": {
            "NCT1": {"p": 0.144, "typical": 0.1},
            "NCT2": {"p": 0.3, "typical": 0.3},
            "NCT9": {"p": 0.2, "typical": 0.2},
        }
    }
    ex = explorer(trial("NCT1"), trial("NCT2"), trial("NCT3"))
    doc = build_intro_doc(ex, None, risk, [], DAY)
    assert doc["typical"] == 0.2
    assert doc["trials"]["risk"] == [0.144, 0.3, None]
    bare = build_intro_doc(ex, None, None, [], DAY)
    assert bare["typical"] is None and bare["trials"]["risk"] == [None, None, None]


def test_no_pipeline_gives_empty_rows_and_marks() -> None:
    doc = build_intro_doc(explorer(trial("NCT1")), None, None, [], DAY)
    assert doc["rows"] == [] and doc["trials"]["marks"] == [[]] and doc["trials"]["dz"] == [[]]


def test_coordinates_rounded_to_3dp() -> None:
    doc = build_intro_doc(explorer(trial("NCT1", 0.123456, -0.98765)), None, None, [], DAY)
    assert doc["trials"]["x"] == [0.123] and doc["trials"]["y"] == [-0.988]


def test_risk_without_per_trial_gives_null_risk_and_typical() -> None:
    risk = {"enabled": True, "not_scored": []}  # no "trials" key when per_trial is off
    doc = build_intro_doc(explorer(trial("NCT1")), None, risk, [], DAY)
    assert doc["typical"] is None and doc["trials"]["risk"] == [None]
