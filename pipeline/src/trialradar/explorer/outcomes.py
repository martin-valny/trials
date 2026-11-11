"""Public outcome labels: did a trial's experimental drug move to a later phase?"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping, Sequence
from datetime import date
from typing import Literal

import polars as pl

Outcome = Literal["succeeded", "stopped", "completed_unknown", "running", "unknown"]

PHASE_RANK: dict[str, int] = {"EARLY_PHASE1": 0, "PHASE1": 1, "PHASE2": 2, "PHASE3": 3, "PHASE4": 4}

TrialDrugs = dict[str, frozenset[str]]
TrialLabels = dict[str, frozenset[str]]  # nct_id -> condition labels

_STOPPED = frozenset({"TERMINATED", "WITHDRAWN", "SUSPENDED"})
_RUNNING = frozenset(
    {"RECRUITING", "NOT_YET_RECRUITING", "ACTIVE_NOT_RECRUITING", "ENROLLING_BY_INVITATION"}
)
_LATE_RANK = PHASE_RANK["PHASE3"]
_POOL_MAX_RANK = PHASE_RANK["PHASE3"]
_EARLY = frozenset({"EARLY_PHASE1", "PHASE1", "PHASE2"})


def top_phase(phases: Sequence[str]) -> str | None:
    """Highest-ranked phase; "NA" if only NA is present; else None."""
    ranked = [p for p in phases if p in PHASE_RANK]
    if ranked:
        return max(ranked, key=lambda p: PHASE_RANK[p])
    return "NA" if "NA" in phases else None


def can_succeed(phases: Sequence[str]) -> bool:
    """Phases that can succeed: has an early phase (EP1/P1/P2) and tops out at PHASE3 or lower."""
    top = top_phase(phases)
    rank = PHASE_RANK.get(top) if top is not None else None
    return rank is not None and rank <= _POOL_MAX_RANK and any(p in _EARLY for p in phases)


def in_pool(phases: Sequence[str], outcome: Outcome, has_drug: bool) -> bool:
    """Finished trials that could succeed: phases that can succeed, at least one cleaned
    experimental drug (a drug-free trial has nothing to move on), and a finished outcome."""
    return (
        has_drug
        and can_succeed(phases)
        and outcome in ("succeeded", "stopped", "completed_unknown")
    )


_Entry = tuple[int, date, str | None, frozenset[str]]  # rank, start, status, labels


def success_labels(
    trial: pl.DataFrame, drugs: TrialDrugs, labels: TrialLabels
) -> dict[str, frozenset[str]]:
    """For each completed, eligible trial: the condition labels in which one of its drugs
    later progressed (R21). Empty for every other trial.

    Trial T succeeded in label L iff L is one of T's labels and some drug d of T has a later
    trial U (started after T, higher phase, not withdrawn, L among U's labels), and d had no
    trial V of PHASE3 or later that started before T with L among V's labels."""
    return success(trial, drugs, labels)[0]


def success_drugs(
    trial: pl.DataFrame, drugs: TrialDrugs, labels: TrialLabels
) -> dict[str, frozenset[str]]:
    """For each trial: the drugs that progressed under R21 in any of its labels (option 1b:
    a group is credited with a success only through these drugs). Empty when not succeeded."""
    return success(trial, drugs, labels)[1]


def success(
    trial: pl.DataFrame, drugs: TrialDrugs, labels: TrialLabels
) -> tuple[dict[str, frozenset[str]], dict[str, frozenset[str]]]:
    """:func:`success_labels` and :func:`success_drugs` from one pass."""
    rows = trial.select("nct_id", "phases", "overall_status", "start_date").iter_rows()
    infos: list[tuple[str, int | None, bool, str | None, date | None]] = []
    # drug -> (rank, start, status, labels) of every dated, ranked trial with that drug
    index: dict[str, list[_Entry]] = defaultdict(list)
    for nct_id, phases, status, start in rows:
        phases = phases or []
        top = top_phase(phases)
        rank = PHASE_RANK.get(top) if top is not None else None
        infos.append((nct_id, rank, can_succeed(phases), status, start))
        if rank is not None and start is not None:
            mine = labels.get(nct_id, frozenset())
            for drug in drugs.get(nct_id, frozenset()):
                index[drug].append((rank, start, status, mine))

    won_labels: dict[str, frozenset[str]] = {}
    won_drugs: dict[str, frozenset[str]] = {}
    for nct_id, rank, eligible, status, start in infos:
        if status != "COMPLETED" or rank is None or not eligible or start is None:
            won_labels[nct_id] = won_drugs[nct_id] = frozenset()
            continue
        won_labels[nct_id], won_drugs[nct_id] = _success(
            rank, start, drugs.get(nct_id, frozenset()), labels.get(nct_id, frozenset()), index
        )
    return won_labels, won_drugs


def _success(
    rank: int,
    start: date,
    my_drugs: frozenset[str],
    my_labels: frozenset[str],
    index: dict[str, list[_Entry]],
) -> tuple[frozenset[str], frozenset[str]]:
    """The labels this trial succeeded in, and the drugs that progressed in any of them."""
    won: set[str] = set()
    winners: set[str] = set()
    for drug in my_drugs:
        entries = index.get(drug, [])
        for label in my_labels:
            # Planner's call: the late-phase block is per label ("already late in this disease").
            if any(r >= _LATE_RANK and s < start and label in ls for r, s, _, ls in entries):
                continue
            if any(
                r > rank and s > start and st != "WITHDRAWN" and label in ls
                for r, s, st, ls in entries
            ):
                won.add(label)
                winners.add(drug)
    return frozenset(won), frozenset(winners)


def label_outcomes(
    trial: pl.DataFrame, drugs: TrialDrugs, labels: TrialLabels
) -> dict[str, Outcome]:
    """One outcome per trial; ``"succeeded"`` iff :func:`success_labels` is non-empty."""
    return outcomes_from_success(trial, success_labels(trial, drugs, labels))


def outcomes_from_success(
    trial: pl.DataFrame, won: Mapping[str, frozenset[str]]
) -> dict[str, Outcome]:
    """Outcomes from an already computed :func:`success_labels` result (saves a second pass)."""
    rows = trial.select("nct_id", "overall_status").iter_rows()
    return {nct_id: _label(status, bool(won[nct_id])) for nct_id, status in rows}


def _label(status: str | None, succeeded: bool) -> Outcome:
    if status in _STOPPED:
        return "stopped"
    if status in _RUNNING:
        return "running"
    if status != "COMPLETED":
        return "unknown"
    return "succeeded" if succeeded else "completed_unknown"
