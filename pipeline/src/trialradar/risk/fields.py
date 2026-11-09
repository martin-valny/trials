"""Raw registry fields the stop-risk model reads straight from a study record."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

CATEGORIES: tuple[str, ...] = (
    "Infections",
    "Neoplasms",
    "Musculoskeletal Diseases",
    "Digestive System Diseases",
    "Stomatognathic Diseases",
    "Respiratory Tract Diseases",
    "Otorhinolaryngologic Diseases",
    "Nervous System Diseases",
    "Eye Diseases",
    "Urogenital Diseases",
    "Female Urogenital Diseases and Pregnancy Complications",
    "Pregnancy Complications",
    "Cardiovascular Diseases",
    "Hemic and Lymphatic Diseases",
    "Congenital, Hereditary, and Neonatal Diseases and Abnormalities",
    "Skin and Connective Tissue Diseases",
    "Nutritional and Metabolic Diseases",
    "Endocrine System Diseases",
    "Immune System Diseases",
    "Disorders of Environmental Origin",
    "Pathological Conditions, Signs and Symptoms",
    "Occupational Diseases",
    "Chemically-Induced Disorders",
    "Wounds and Injuries",
    "Mental Disorders",
)
"""MeSH top-level disease categories, matched against condition-browse mesh/ancestor terms."""

_PLACEBO_ARMS = {"PLACEBO_COMPARATOR", "SHAM_COMPARATOR"}


@dataclass(frozen=True)
class RiskFields:
    nct_id: str
    n_arms: int | None
    placebo_arm: bool
    categories: tuple[str, ...]
    """Members of CATEGORIES found among the condition mesh and ancestor terms, sorted."""


def risk_fields(study: dict[str, Any]) -> RiskFields:
    """Read the raw risk fields; missing modules give None / False / empty, never an error."""
    proto = study.get("protocolSection") or {}
    nct_id = (proto.get("identificationModule") or {}).get("nctId") or ""
    arms = (proto.get("armsInterventionsModule") or {}).get("armGroups")
    groups = [a for a in arms if isinstance(a, dict)] if isinstance(arms, list) else None
    browse = (study.get("derivedSection") or {}).get("conditionBrowseModule") or {}
    terms = {
        t["term"]
        for key in ("meshes", "ancestors")
        for t in browse.get(key) or []
        if isinstance(t, dict) and isinstance(t.get("term"), str)
    }
    return RiskFields(
        nct_id=nct_id,
        n_arms=len(groups) if groups else None,
        placebo_arm=any(g.get("type") in _PLACEBO_ARMS for g in groups or []),
        categories=tuple(sorted(terms & set(CATEGORIES))),
    )
