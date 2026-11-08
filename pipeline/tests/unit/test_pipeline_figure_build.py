from __future__ import annotations

import re
from datetime import date
from typing import Any

import polars as pl
import pytest
from conftest import REPO_ROOT

from trialradar.config import AreaConfig, load_config
from trialradar.pipeline_figure.build import build_pipeline_doc
from trialradar.pipeline_figure.io import (
    Family,
    FigureConfig,
    FigureRow,
    Parent,
    ReasonRule,
    norm_sponsor,
)

DAY = date(2026, 11, 8)
KEYS = {
    "generated_for",
    "diseases",
    "counts",
    "families",
    "rows",
    "sponsors",
    "trials",
    "unrowed",
}


@pytest.fixture
def cfg() -> AreaConfig:
    return load_config(REPO_ROOT / "config" / "area.yaml")


def _row(rid: str, classes: tuple[str, ...] = (), related: tuple[str, ...] = ()) -> FigureRow:
    return FigureRow(rid, rid.upper(), "sub", "fam", 1, classes, (), "GENE", "", related)


@pytest.fixture
def fig() -> FigureConfig:
    return FigureConfig(
        families=(Family("fam", "Fam", 1),),
        rows=(_row("cd20", ("anti-CD20",), ("car19",)), _row("car19", ("CD19 CAR-T",))),
        unrowed={"ignored": "symptomatic"},
        background=frozenset(),
        parents={norm_sponsor("Hoffmann-La Roche"): Parent("Roche", "industry")},
        reasons=(ReasonRule(re.compile("business", re.IGNORECASE), "Business or strategy"),),
    )


def _t(nct: str, drugs: list[str], **kw: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "nct_id": nct,
        "drugs": drugs,
        "approaches": ["targeted"],
        "phase": "PHASE3",
        "outcome": "running",
        "succeeded_by": [],
        "succeeded_in": [],
        "start_year": 2020,
        "end_year": 2024,
        "end_estimated": False,
        "condition_labels": ["Multiple sclerosis"],
        "lead_sponsor": "Hoffmann-La Roche",
        "title": "A trial",
    }
    return base | kw


def _table(rows: list[tuple[str, list[str], str | None, str | None]]) -> pl.DataFrame:
    return pl.DataFrame(
        {
            "nct_id": [r[0] for r in rows],
            "phases": [r[1] for r in rows],
            "why_stopped": [r[2] for r in rows],
            "sponsor_class": [r[3] for r in rows],
        },
        schema={
            "nct_id": pl.Utf8,
            "phases": pl.List(pl.Utf8),
            "why_stopped": pl.Utf8,
            "sponsor_class": pl.Utf8,
        },
    )


def _explorer(trials: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "trials": trials,
        "drug_index": {
            "ocrelizumab": {"mechanisms": ["anti-CD20"]},
            "kyv-101": {"mechanisms": ["CD19 CAR-T"]},
            "mystery": {"mechanisms": ["ignored"]},
        },
    }


def _build(
    cfg: AreaConfig, fig: FigureConfig, trials: list[dict[str, Any]], table: pl.DataFrame
) -> tuple[dict[str, Any], list[str]]:
    warnings: list[str] = []
    return build_pipeline_doc(_explorer(trials), table, cfg, fig, DAY, warnings), warnings


def test_build_pipeline_doc_shapes(cfg: AreaConfig, fig: FigureConfig) -> None:
    trials = [
        _t("NCT00000001", ["ocrelizumab"], outcome="running"),
        _t(
            "NCT00000002",
            ["Ocrelizumab", "kyv-101"],
            outcome="succeeded",
            succeeded_by=["kyv-101"],
            succeeded_in=["Multiple sclerosis"],
            phase="PHASE2",
        ),
        _t(
            "NCT00000003",
            ["ocrelizumab"],
            outcome="stopped",
            start_year=2018,
            end_year=2019,
            end_estimated=True,
        ),
        _t("NCT00000004", ["ocrelizumab"], phase="NA"),
        _t("NCT00000005", ["mystery"], approaches=["nondrug"]),
    ]
    table = _table(
        [
            ("NCT00000001", ["PHASE3"], None, "INDUSTRY"),
            ("NCT00000002", ["PHASE1", "PHASE2"], None, "INDUSTRY"),
            ("NCT00000003", ["PHASE2", "PHASE3"], "Business decision by sponsor", "INDUSTRY"),
            ("NCT00000004", ["NA"], None, "INDUSTRY"),
            ("NCT00000005", ["PHASE1"], None, "OTHER"),
        ]
    )
    doc, warnings = _build(cfg, fig, trials, table)
    assert set(doc) == KEYS
    assert doc["generated_for"] == "2026-11-08"
    assert doc["diseases"][0] == {"code": "MS", "label": "Multiple sclerosis"}
    assert [d["code"] for d in doc["diseases"]] == ["MS", "NMOSD", "MOGAD", "MG", "CIDP", "AE"]
    assert doc["families"] == [{"id": "fam", "label": "Fam", "order": 1}]
    assert doc["counts"] == {"trials": 5, "targeted": 4, "in_rows": 3, "targeted_not_rowed": 1}
    rows = {r["id"]: r for r in doc["rows"]}
    assert set(rows["cd20"]) == {
        "id", "label", "sub", "family", "order", "gene", "blurb", "related", "marks",
    }  # fmt: skip
    assert rows["cd20"]["related"] == ["car19"]
    cd20 = {m["n"]: m for m in rows["cd20"]["marks"]}
    car = {m["n"]: m for m in rows["car19"]["marks"]}
    assert set(cd20) == {"NCT00000001", "NCT00000002", "NCT00000003"}
    assert set(car) == {"NCT00000002"}
    # combination trial: the mixed-case drug is credited correctly in each row
    assert cd20["NCT00000002"]["drug"] == "Ocrelizumab"
    assert cd20["NCT00000002"]["s"] == "fin" and cd20["NCT00000002"]["via"] == "kyv-101"
    assert car["NCT00000002"]["drug"] == "kyv-101" and car["NCT00000002"]["s"] == "adv"
    assert "via" not in car["NCT00000002"]
    assert cd20["NCT00000002"]["c"] == 2 and cd20["NCT00000002"]["span"] == "1/2"
    assert cd20["NCT00000003"]["c"] == 3 and cd20["NCT00000003"]["span"] == "2/3"
    assert cd20["NCT00000003"]["est"] is True
    assert car["NCT00000002"]["si"] == ["MS"]
    assert cd20["NCT00000001"]["dz"] == ["MS"]
    # a mark with defaults has none of span/via/si/est; the combo mark keeps what applies
    assert set(cd20["NCT00000001"]) == {"n", "c", "s", "y", "y2", "dz", "drug", "sp"}
    assert set(cd20["NCT00000002"]) == {
        "n", "c", "s", "y", "y2", "dz", "drug", "sp", "span", "via", "si",
    }  # fmt: skip
    assert set(car["NCT00000002"]) == {
        "n", "c", "s", "y", "y2", "dz", "drug", "sp", "span", "si",
    }  # fmt: skip
    assert doc["trials"]["NCT00000003"] == {
        "t": "A trial",
        "why": "Business decision by sponsor",
        "r": "Business or strategy",
    }
    assert set(doc["trials"]) == {"NCT00000001", "NCT00000002", "NCT00000003"}
    assert doc["trials"]["NCT00000001"] == {"t": "A trial"}
    sp = doc["sponsors"][cd20["NCT00000001"]["sp"]]
    assert sp == {"raw": "Hoffmann-La Roche", "parent": "Roche", "kind": "industry"}
    assert warnings == []


def test_build_tolerates_missing_fields(cfg: AreaConfig, fig: FigureConfig) -> None:
    trials = [
        _t("NCT00000001", ["ocrelizumab"], start_year=None, end_year=None, lead_sponsor=None),
        _t("NCT00000002", ["ocrelizumab"], start_year=2021),
    ]
    table = _table(
        [("NCT00000001", ["PHASE3"], None, None), ("NCT00000002", ["PHASE3"], None, "OTHER")]
    )
    doc, _ = _build(cfg, fig, trials, table)
    marks = doc["rows"][0]["marks"]
    assert [m["n"] for m in marks] == ["NCT00000002", "NCT00000001"]
    last = marks[1]
    assert last["y"] is None and last["y2"] is None
    assert doc["sponsors"][last["sp"]]["parent"] == "Not given"


def test_build_title_and_why_truncated(cfg: AreaConfig, fig: FigureConfig) -> None:
    trials = [_t("NCT00000001", ["ocrelizumab"], outcome="stopped", title="T" * 300)]
    table = _table([("NCT00000001", ["PHASE3"], "w" * 500, "OTHER")])
    doc, _ = _build(cfg, fig, trials, table)
    entry = doc["trials"]["NCT00000001"]
    assert len(entry["t"]) == 80 and len(entry["why"]) == 300


def test_build_warns_unlisted_class(cfg: AreaConfig, fig: FigureConfig) -> None:
    trials = [_t(f"NCT0000000{i}", ["newdrug"]) for i in range(1, 5)]
    trials_ex = _explorer(trials)
    trials_ex["drug_index"]["newdrug"] = {"mechanisms": ["Brand new class"]}
    table = _table([(t["nct_id"], ["PHASE2"], None, "OTHER") for t in trials])
    warnings: list[str] = []
    build_pipeline_doc(trials_ex, table, cfg, fig, DAY, warnings)
    assert warnings == ["pipeline_unlisted_classes: Brand new class (4)"]


def test_build_warns_unlisted_industry_sponsor(cfg: AreaConfig, fig: FigureConfig) -> None:
    trials = [_t(f"NCT0000000{i}", ["ocrelizumab"], lead_sponsor="Newco Inc") for i in range(1, 4)]
    table = _table([(t["nct_id"], ["PHASE2"], None, "INDUSTRY") for t in trials])
    _, warnings = _build(cfg, fig, trials, table)
    assert warnings == ["pipeline_unlisted_sponsors: Newco Inc (3)"]
