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

_PARANEOPLASTIC = frozenset(
    {"Paraneoplastic Syndromes", "Paraneoplastic Syndromes, Nervous System"}
)
_PARANEOPLASTIC_CHAIN = _PARANEOPLASTIC | {
    "Nervous System Neoplasms",
    "Neoplasms by Site",
    "Neoplasms",
}
"""MeSH files some non-tumour conditions under paraneoplastic syndromes, whose ancestors climb
to "Neoplasms" through these terms. Reached only this way, "Neoplasms" is not counted."""
_NEOPLASM_ROOT_CHILDREN = frozenset({"Cysts", "Hamartoma", "Precancerous Conditions"})
"""Children of "Neoplasms" whose names do not say neoplasm."""


def _is_neoplasm_term(term: str) -> bool:
    return term in _NEOPLASM_ROOT_CHILDREN or (
        "neoplas" in term.lower() and term not in _PARANEOPLASTIC
    )


def _neoplasms_only_via_paraneoplastic(meshes: set[str], ancestors: set[str]) -> bool:
    """True when "Neoplasms" is reached only through the paraneoplastic chain.

    Ancestors are flat, so evidence of a real neoplasm is any direct mesh term that is a
    neoplasm (chain members included), or any neoplasm ancestor outside the chain.
    """
    if not (meshes | ancestors) & _PARANEOPLASTIC:
        return False
    if any(_is_neoplasm_term(t) for t in meshes):
        return False
    return not any(_is_neoplasm_term(t) for t in ancestors - _PARANEOPLASTIC_CHAIN)


@dataclass(frozen=True)
class RiskFields:
    nct_id: str
    n_arms: int | None
    placebo_arm: bool
    categories: tuple[str, ...]
    """Members of CATEGORIES found among the condition mesh and ancestor terms, sorted.

    "Neoplasms" reached only through the paraneoplastic-syndromes chain is left out."""


def risk_fields(study: dict[str, Any]) -> RiskFields:
    """Read the raw risk fields; missing modules give None / False / empty, never an error."""
    proto = study.get("protocolSection") or {}
    nct_id = (proto.get("identificationModule") or {}).get("nctId") or ""
    arms = (proto.get("armsInterventionsModule") or {}).get("armGroups")
    groups = [a for a in arms if isinstance(a, dict)] if isinstance(arms, list) else None
    browse = (study.get("derivedSection") or {}).get("conditionBrowseModule") or {}

    def read(key: str) -> set[str]:
        return {
            t["term"]
            for t in browse.get(key) or []
            if isinstance(t, dict) and isinstance(t.get("term"), str)
        }

    meshes, ancestors = read("meshes"), read("ancestors")
    terms = meshes | ancestors
    if _neoplasms_only_via_paraneoplastic(meshes, ancestors):
        terms.discard("Neoplasms")
    return RiskFields(
        nct_id=nct_id,
        n_arms=len(groups) if groups else None,
        placebo_arm=any(g.get("type") in _PLACEBO_ARMS for g in groups or []),
        categories=tuple(sorted(terms & set(CATEGORIES))),
    )
