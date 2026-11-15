"""Which trials the stop-risk model covers, and how outcomes are labelled."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from datetime import date
from typing import Any

RUNNING: frozenset[str] = frozenset(
    {"NOT_YET_RECRUITING", "RECRUITING", "ENROLLING_BY_INVITATION", "ACTIVE_NOT_RECRUITING"}
)
"""Statuses of trials still under way: the ones that get a risk score."""

LABELS: dict[str, int] = {"COMPLETED": 0, "TERMINATED": 1}
"""Final statuses used for training: terminated is the positive class."""

_CORE_PHASES = {"PHASE1", "PHASE2", "PHASE3"}
_DRUG_TYPES = {"DRUG", "BIOLOGICAL"}


def in_phase_scope(phases: list[str]) -> bool:
    """True when a trial has a phase 1, 2 or 3 (an early-phase-1-only trial is out)."""
    return any(p in _CORE_PHASES for p in phases)


def has_drug(intervention_types: Iterable[str]) -> bool:
    """True when any intervention is a drug or a biological."""
    return any(t in _DRUG_TYPES for t in intervention_types)


FINISHED_RESULTS = "results posted"
FINISHED_PRIMARY = "primary completion reached"


def finished_reason(trial: Mapping[str, Any], has_results: bool, day: date) -> str | None:
    """Why a running-status trial is finished in all but status on `day`, or None.

    Results posted, or active-not-recruiting with an ACTUAL primary completion date before
    `day`. One rule for the daily run (left unscored) and v2 training (out of scope)."""
    if has_results:
        return FINISHED_RESULTS
    done = trial.get("primary_completion_date")
    if (
        trial["overall_status"] == "ACTIVE_NOT_RECRUITING"
        and trial.get("primary_completion_date_type") == "ACTUAL"
        and done is not None
        and done < day
    ):
        return FINISHED_PRIMARY
    return None
