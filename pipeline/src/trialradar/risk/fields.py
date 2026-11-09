"""Raw registry fields the stop-risk model reads straight from a study record."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

_PLACEBO_ARMS = {"PLACEBO_COMPARATOR", "SHAM_COMPARATOR"}


@dataclass(frozen=True)
class RiskFields:
    nct_id: str
    n_arms: int | None
    placebo_arm: bool
    branches: tuple[str, ...]
    """MeSH condition-browse branch abbreviations, sorted and deduped."""


def risk_fields(study: dict[str, Any]) -> RiskFields:
    """Read the raw risk fields; missing modules give None / False / empty, never an error."""
    proto = study.get("protocolSection") or {}
    nct_id = (proto.get("identificationModule") or {}).get("nctId") or ""
    arms = (proto.get("armsInterventionsModule") or {}).get("armGroups")
    groups = [a for a in arms if isinstance(a, dict)] if isinstance(arms, list) else None
    branches = ((study.get("derivedSection") or {}).get("conditionBrowseModule") or {}).get(
        "browseBranches"
    ) or []
    return RiskFields(
        nct_id=nct_id,
        n_arms=len(groups) if groups else None,
        placebo_arm=any(g.get("type") in _PLACEBO_ARMS for g in groups or []),
        branches=tuple(
            sorted({b["abbrev"] for b in branches if isinstance(b, dict) and b.get("abbrev")})
        ),
    )
