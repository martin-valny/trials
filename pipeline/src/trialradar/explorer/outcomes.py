"""Public outcome labels: did a trial's experimental drug move to a later phase?"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Sequence
from datetime import date
from typing import Literal

import polars as pl

Outcome = Literal["succeeded", "stopped", "completed_unknown", "running", "unknown"]

PHASE_RANK: dict[str, int] = {"EARLY_PHASE1": 0, "PHASE1": 1, "PHASE2": 2, "PHASE3": 3, "PHASE4": 4}

TrialDrugs = dict[str, frozenset[str]]

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


def in_pool(phases: Sequence[str], outcome: Outcome) -> bool:
    return can_succeed(phases) and outcome in ("succeeded", "stopped", "completed_unknown")


def label_outcomes(trial: pl.DataFrame, drugs: TrialDrugs) -> dict[str, Outcome]:
    rows = trial.select("nct_id", "phases", "overall_status", "start_date").iter_rows()
    infos: list[tuple[str, int | None, bool, str | None, date | None]] = []
    # drug -> (rank, start, status) of every dated, ranked trial with that drug
    index: dict[str, list[tuple[int, date, str | None]]] = defaultdict(list)
    for nct_id, phases, status, start in rows:
        phases = phases or []
        top = top_phase(phases)
        rank = PHASE_RANK.get(top) if top is not None else None
        eligible = can_succeed(phases)
        infos.append((nct_id, rank, eligible, status, start))
        if rank is not None and start is not None:
            for drug in drugs.get(nct_id, frozenset()):
                index[drug].append((rank, start, status))

    out: dict[str, Outcome] = {}
    for nct_id, rank, eligible, status, start in infos:
        out[nct_id] = _label(nct_id, rank, eligible, status, start, drugs, index)
    return out


def _label(
    nct_id: str,
    rank: int | None,
    eligible: bool,
    status: str | None,
    start: date | None,
    drugs: TrialDrugs,
    index: dict[str, list[tuple[int, date, str | None]]],
) -> Outcome:
    if status in _STOPPED:
        return "stopped"
    if status in _RUNNING:
        return "running"
    if status != "COMPLETED":
        return "unknown"
    if rank is None or not eligible or start is None:
        return "completed_unknown"
    for drug in drugs.get(nct_id, frozenset()):
        entries = index.get(drug, [])
        if any(r >= _LATE_RANK and s < start for r, s, _ in entries):
            continue
        if any(r > rank and s > start and st != "WITHDRAWN" for r, s, st in entries):
            return "succeeded"
    return "completed_unknown"
