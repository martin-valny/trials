"""Drug-name cleaning so the same drug matches across trials."""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence

from trialradar.textnorm import apply_alias, norm_key

_BRACKETED = re.compile(r"\([^)]*\)|\[[^\]]*\]")
_DOSE = re.compile(
    r"\d+(?:\.\d+)?\s*(?:mg/kg|mg|g|mcg|µg|ug|ml|iu|units?|%)(?:\s*/\s*(?:kg|ml|m2|day|d|dl|l|dose))?(?![a-z0-9])",
)
_NOISE = re.compile(
    r"\b(?:oral|iv|intravenous|subcutaneous|sc|im|intramuscular|infusion|injection|"
    r"tablets?|capsules?|hydrochloride|hcl|sodium|acetate|sulfate|phosphate|maleate)\b",
)
_WS = re.compile(r"\s+")


def clean_drug_name(
    name: str, aliases: Mapping[str, str], exclude_terms: Sequence[str]
) -> str | None:
    """Canonical lower-case drug name, or None for empty/excluded (e.g. placebo) names."""
    original = norm_key(name)
    s = apply_alias(name, aliases).casefold()
    s = _BRACKETED.sub(" ", s)
    s = _DOSE.sub(" ", s)
    s = _NOISE.sub(" ", s)
    s = _WS.sub(" ", s).strip(" ,;:-/")
    if not s:
        return None
    s = apply_alias(s, aliases).casefold()
    terms = [k for t in exclude_terms if (k := norm_key(t))]
    if not s or any(k in s or k in original for k in terms):
        return None
    return s
