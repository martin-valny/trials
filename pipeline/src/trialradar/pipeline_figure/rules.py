"""Pure rules for the Pipeline figure: row placement, 1b mark state, sponsors, stop reasons.

Spec §6.2–6.3. Nothing here reads files or the clock; the stage (Task 3) feeds it data.
"""

from __future__ import annotations

import re
from collections import Counter
from collections.abc import Iterable, Mapping, Sequence
from typing import Any, Literal

from trialradar.pipeline_figure.io import (
    FigureConfig,
    Parent,
    ReasonRule,
    SponsorKind,
    norm_sponsor,
)

COLUMN: Mapping[str, int] = {
    "EARLY_PHASE1": 1,
    "PHASE1": 1,
    "PHASE2": 2,
    "PHASE3": 3,
    "PHASE4": 4,
}

MarkState = Literal["adv", "run", "stop", "fin", "unk"]

_PLAIN_STATE: Mapping[str, MarkState] = {
    "running": "run",
    "stopped": "stop",
    "completed_unknown": "fin",
    "unknown": "unk",
}

_SUFFIX = re.compile(
    r"[\s,]+(?:co\.?,?\s*ltd\.?|ltd\.?|inc\.?|llc|gmbh|ag|s\.a\.|sa|plc|b\.v\.|bv|corporation"
    r"|a gilead company)[\s.,]*$",
    re.IGNORECASE,
)
_ACADEMIC = re.compile(
    r"universit|hospital|college|institut|clinic|foundation|center|centre|school|nih|national"
    r"|ministry|council|society|charit|hopitaux|assistance|medical|research",
    re.IGNORECASE,
)
_GOV_CLASSES = frozenset({"NIH", "FED", "OTHER_GOV"})


def span(phases: Sequence[str]) -> Literal["1/2", "2/3"] | None:
    s = set(phases)
    if len(phases) == 2 and s == {"PHASE1", "PHASE2"}:
        return "1/2"
    if len(phases) == 2 and s == {"PHASE2", "PHASE3"}:
        return "2/3"
    return None


def _class_row(cfg: FigureConfig) -> dict[str, str]:
    return {c: r.id for r in cfg.rows for c in r.classes}


def _drug_row(cfg: FigureConfig) -> dict[str, str]:
    return {d.casefold(): r.id for r in cfg.rows for d in r.drugs}


def _classes_of(drug: str, drug_mechanisms: Mapping[str, Sequence[str]]) -> Sequence[str]:
    if drug in drug_mechanisms:
        return drug_mechanisms[drug]
    folded = drug.casefold()
    for name, classes in drug_mechanisms.items():
        if name.casefold() == folded:
            return classes
    return ()


def placements(
    drugs: Sequence[str],
    drug_mechanisms: Mapping[str, Sequence[str]],
    cfg: FigureConfig,
) -> dict[str, str]:
    """Row id -> the drug that put the trial there (first drug wins per row)."""
    kept = [d for d in drugs if d.casefold() not in cfg.background] or list(drugs)
    by_class, by_drug = _class_row(cfg), _drug_row(cfg)
    out: dict[str, str] = {}
    for drug in kept:
        row = by_drug.get(drug.casefold())
        if row is not None:
            out.setdefault(row, drug)
            continue
        for cls in _classes_of(drug, drug_mechanisms):
            row = by_class.get(cls)
            if row is not None:
                out.setdefault(row, drug)
    return out


def mark_state(
    outcome: str, drug: str, succeeded_by: Sequence[str]
) -> tuple[MarkState, str | None]:
    """The 1b state of one trial in one row, and the crediting drug if it advanced elsewhere."""
    if outcome == "succeeded":
        if drug.casefold() in {d.casefold() for d in succeeded_by}:
            return "adv", None
        return "fin", (min(succeeded_by) if succeeded_by else None)
    return _PLAIN_STATE.get(outcome, "unk"), None


def sponsor_display(raw: str) -> str:
    """Trim legal suffixes and trailing commas; never trims to nothing."""
    s = raw.strip()
    while True:
        trimmed = _SUFFIX.sub("", s).rstrip(" ,")
        if trimmed == s or not trimmed:
            return s.rstrip(" ,") or raw.strip()
        s = trimmed


def parent_of(raw: str | None, sponsor_class: str | None, parents: Mapping[str, Parent]) -> Parent:
    if raw is None or not raw.strip():
        return Parent("Not given", "other")
    display = sponsor_display(raw)
    listed = parents.get(norm_sponsor(raw)) or parents.get(norm_sponsor(display))
    if listed is not None:
        return listed
    kind: SponsorKind
    if sponsor_class == "INDUSTRY":
        kind = "industry"
    elif sponsor_class in _GOV_CLASSES:
        kind = "government"
    elif _ACADEMIC.search(raw):
        kind = "academic"
    else:
        kind = "other"
    return Parent(display, kind)


def reason_group(why: str | None, rules: Sequence[ReasonRule]) -> str:
    if why is None or not why.strip():
        return "Not given"
    for rule in rules:
        if rule.pattern.search(why):
            return rule.group
    return "Other"


def unlisted_classes(
    trials: Iterable[Mapping[str, Any]],
    drug_mechanisms: Mapping[str, Sequence[str]],
    cfg: FigureConfig,
    *,
    since: int = 2012,
    min_trials: int = 3,
) -> list[tuple[str, int]]:
    """Classes of recent Targeted trials that are in neither a row nor ``cfg.unrowed``."""
    known = set(_class_row(cfg)) | set(cfg.unrowed)
    by_drug = _drug_row(cfg)
    counts: Counter[str] = Counter()
    for t in trials:
        year = t.get("start_year")
        if "targeted" not in t.get("approaches", ()) or year is None or year < since:
            continue
        if t.get("phase") == "NA":  # a trial without a drug phase never gets a mark
            continue
        drugs: list[str] = list(t.get("drugs", ()))
        kept = [d for d in drugs if d.casefold() not in cfg.background] or drugs
        classes = {
            c
            for d in kept
            if d.casefold() not in by_drug
            for c in _classes_of(d, drug_mechanisms)
            if c not in known
        }
        counts.update(classes)
    return sorted(
        ((c, n) for c, n in counts.items() if n >= min_trials), key=lambda cn: (-cn[1], cn[0])
    )
