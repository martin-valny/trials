"""Drug-name cleaning so the same drug matches across trials."""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence

from trialradar.textnorm import apply_alias, norm_key

_BRACKETED = re.compile(r"\([^)]*\)|\[[^\]]*\]")
_DOSE = re.compile(
    r"\d+(?:\.\d+)?\s*(?:mg/kg|mg|g|mcg|µg|ug|ml|iu|units?|%)(?![a-z])",
)
_NOISE = re.compile(
    r"\b(?:oral|iv|intravenous|subcutaneous|sc|im|intramuscular|infusion|injection|"
    r"tablets?|capsules?|hydrochloride|hcl|sodium|acetate|sulfate|phosphate|maleate|"
    r"fumarate)\b",
)
_WS = re.compile(r"\s+")


def clean_drug_name(
    name: str, aliases: Mapping[str, str], exclude_terms: Sequence[str]
) -> str | None:
    """Canonical lower-case drug name, or None for empty/excluded (e.g. placebo) names."""
    s = apply_alias(name, aliases).casefold()
    s = _BRACKETED.sub(" ", s)
    s = _DOSE.sub(" ", s)
    s = _NOISE.sub(" ", s)
    s = _WS.sub(" ", s).strip(" ,;:-/")
    if not s:
        return None
    s = apply_alias(s, aliases).casefold()
    if not s or any(norm_key(t) in s for t in exclude_terms if norm_key(t)):
        return None
    return s
