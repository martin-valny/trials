from __future__ import annotations

import re
from dataclasses import replace
from typing import Any

import pytest

from trialradar.pipeline_figure.io import (
    FigureConfig,
    FigureRow,
    Parent,
    ReasonRule,
    norm_sponsor,
)
from trialradar.pipeline_figure.rules import (
    mark_state,
    parent_of,
    placements,
    reason_group,
    span,
    sponsor_display,
    unlisted_classes,
)


def _row(rid: str, classes: tuple[str, ...] = (), drugs: tuple[str, ...] = ()) -> FigureRow:
    return FigureRow(rid, rid, "", "fam", 1, classes, drugs, None, "b", ())


@pytest.fixture
def cfg() -> FigureConfig:
    return FigureConfig(
        families=(),
        rows=(
            _row("cd20", classes=("anti-CD20",)),
            _row("car19", classes=("CD19 CAR-T",)),
            _row("dna", drugs=("cladribine",)),
            _row("gc", classes=("glucocorticoid receptor modulator",)),
        ),
        unrowed={"ignored class": "why"},
        background=frozenset({"fludarabine", "cyclophosphamide", "methylprednisolone"}),
        parents={},
        reasons=(
            ReasonRule(re.compile("business|strategic", re.IGNORECASE), "Business or strategy"),
            ReasonRule(re.compile("enrol?l?ment|accrual", re.IGNORECASE), "Slow enrolment"),
        ),
    )


MECH = {
    "kyv-101": ["CD19 CAR-T"],
    "ocrelizumab": ["anti-CD20"],
    "methylprednisolone": ["glucocorticoid receptor modulator"],
    "cladribine": ["DNA inhibitor"],
    "fludarabine": ["purine analog"],
}


def test_placements_drops_background(cfg: FigureConfig) -> None:
    got = placements(["kyv-101", "fludarabine", "cyclophosphamide"], MECH, cfg)
    assert got == {"car19": "kyv-101"}


def test_placements_background_only_fallback(cfg: FigureConfig) -> None:
    assert placements(["methylprednisolone"], MECH, cfg) == {"gc": "methylprednisolone"}


def test_placements_drug_override_beats_class(cfg: FigureConfig) -> None:
    assert placements(["cladribine"], MECH, cfg) == {"dna": "cladribine"}


def test_placements_multi_row_keeps_each_drug(cfg: FigureConfig) -> None:
    got = placements(["ocrelizumab", "kyv-101"], MECH, cfg)
    assert got == {"cd20": "ocrelizumab", "car19": "kyv-101"}


def test_placements_casefolds_drugs(cfg: FigureConfig) -> None:
    assert placements(["Cladribine"], MECH, cfg) == {"dna": "Cladribine"}
    assert placements(["Fludarabine", "KYV-101"], MECH, cfg) == {"car19": "KYV-101"}


def test_span() -> None:
    assert span(["PHASE1", "PHASE2"]) == "1/2"
    assert span(["PHASE2", "PHASE1"]) == "1/2"
    assert span(["PHASE2", "PHASE3"]) == "2/3"
    assert span(["PHASE2"]) is None
    assert span([]) is None


def test_mark_state_1b() -> None:
    assert mark_state("succeeded", "ocrelizumab", ["ocrelizumab"]) == ("adv", None)
    assert mark_state("succeeded", "kyv-101", ["ocrelizumab"]) == ("fin", "ocrelizumab")
    assert mark_state("running", "x", []) == ("run", None)
    assert mark_state("stopped", "x", []) == ("stop", None)
    assert mark_state("completed_unknown", "x", []) == ("fin", None)
    assert mark_state("unknown", "x", []) == ("unk", None)
    assert mark_state("weird", "x", []) == ("unk", None)


def test_placements_prefers_the_credited_drug_in_a_shared_row(cfg: FigureConfig) -> None:
    mech = {**MECH, "ocrelizumab sc": ["anti-CD20"]}
    drugs = ["ocrelizumab", "ocrelizumab sc"]
    got = placements(drugs, mech, cfg, ["ocrelizumab sc"])
    assert got == {"cd20": "ocrelizumab sc"}
    assert mark_state("succeeded", got["cd20"], ["ocrelizumab sc"]) == ("adv", None)
    assert placements(drugs, mech, cfg) == {"cd20": "ocrelizumab"}  # no credit: first wins


def test_mark_state_succeeded_without_crediting_drug() -> None:
    assert mark_state("succeeded", "x", []) == ("fin", None)


def test_sponsor_display() -> None:
    assert sponsor_display("Acme Bio, Inc.") == "Acme Bio"
    assert sponsor_display("argenx BV") == "argenx"
    assert sponsor_display("Foo Co., Ltd.") == "Foo"
    assert sponsor_display("Bar GmbH,") == "Bar"
    assert sponsor_display("Gilead Sciences, a Gilead Company") == "Gilead Sciences"
    assert sponsor_display("Inc.") == "Inc."


def test_parent_of_listed_and_normalises() -> None:
    p = {norm_sponsor("Hoffmann-La Roche"): Parent("Roche", "industry")}
    assert parent_of("HOFFMANN-LA  ROCHE", None, p).parent == "Roche"
    assert parent_of("Hoffmann-La Roche, Inc.", None, p).parent == "Roche"


def test_parent_of_sponsor_class_fallback() -> None:
    assert parent_of("Daishi Tian", "OTHER", {}) == Parent("Daishi Tian", "other")
    assert parent_of("Acme Bio, Inc.", "INDUSTRY", {}) == Parent("Acme Bio", "industry")
    assert parent_of("Mayo Clinic", "OTHER", {}).kind == "academic"
    assert parent_of("NIAID", "NIH", {}).kind == "government"
    assert parent_of("Ministry X", "OTHER_GOV", {}).kind == "government"
    assert parent_of(None, None, {}) == Parent("Not given", "other")


def test_reason_group(cfg: FigureConfig) -> None:
    assert reason_group("Business decision", cfg.reasons) == "Business or strategy"
    assert reason_group("slow enrollment", cfg.reasons) == "Slow enrolment"
    assert reason_group("", cfg.reasons) == "Not given"
    assert reason_group(None, cfg.reasons) == "Not given"
    assert reason_group("Zebra", cfg.reasons) == "Other"


def _t(
    year: int | None, drugs: list[str], approaches: tuple[str, ...] = ("targeted",)
) -> dict[str, Any]:
    return {"start_year": year, "drugs": drugs, "approaches": list(approaches)}


def test_unlisted_classes(cfg: FigureConfig) -> None:
    mech = {
        **MECH,
        "a": ["new class"],
        "b": ["two class"],
        "c": ["old class"],
        "d": ["ignored class"],
        "e": ["bg only"],
    }
    trials = (
        [_t(2020, ["a"])] * 3
        + [_t(2020, ["b"])] * 2
        + [_t(2005, ["c"])] * 5
        + [_t(2020, ["d"])] * 4
        + [_t(2020, ["ocrelizumab"])] * 4
        + [_t(2020, ["a"], ("other",))] * 5
        # background-only class ignored when another drug is present
        + [_t(2020, ["kyv-101", "e"])] * 3
    )
    cfg2 = replace(cfg, background=cfg.background | {"e"})
    assert unlisted_classes(trials, mech, cfg2) == [("new class", 3)]


def test_unlisted_classes_skips_phase_na(cfg: FigureConfig) -> None:
    na = {**_t(2020, ["a"]), "phase": "NA"}
    assert unlisted_classes([na] * 5, {"a": ["new class"]}, cfg) == []


def test_mark_state_is_case_insensitive() -> None:
    assert mark_state("succeeded", "Ocrelizumab", ["ocrelizumab"]) == ("adv", None)
    assert mark_state("succeeded", "ocrelizumab", ["KYV-101"]) == ("fin", "KYV-101")
