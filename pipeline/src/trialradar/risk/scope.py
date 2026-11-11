"""Which trials the stop-risk model covers, and how outcomes are labelled."""

from __future__ import annotations

from collections.abc import Iterable

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
