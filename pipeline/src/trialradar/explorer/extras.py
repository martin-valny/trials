"""Extra per-study fields read straight from the raw relevant study records."""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Literal

from trialradar.config import AreaConfig
from trialradar.relevance import condition_labels
from trialradar.textnorm import norm_text

_DAYS_PER_YEAR = 365.25
_AGE_RE = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*(years?|months?|weeks?|days?)\s*$", re.IGNORECASE)
_UNIT_YEARS = {"year": 1.0, "month": 1 / 12, "week": 1 / 52, "day": 1 / _DAYS_PER_YEAR}
_SEXES = {"ALL", "FEMALE", "MALE"}
_DRUG_PREFIXES = {"drug", "biological"}
_DRUG_TYPES = {"DRUG", "BIOLOGICAL"}


@dataclass(frozen=True)
class StudyExtras:
    nct_id: str
    brief_summary: str | None
    sex: Literal["ALL", "FEMALE", "MALE"] | None
    min_age_years: float | None
    max_age_years: float | None
    has_results: bool
    experimental_drugs: tuple[str, ...]
    mesh_terms: tuple[str, ...]
    condition_labels: tuple[str, ...]


def parse_age_years(text: str | None) -> float | None:
    """Parse an API age such as '18 Years' or '6 Months' into years."""
    if not text:
        return None
    m = _AGE_RE.match(text)
    if m is None:
        return None
    unit = m.group(2).lower().rstrip("s")
    return float(m.group(1)) * _UNIT_YEARS[unit]


def _dedupe(names: Sequence[str]) -> tuple[str, ...]:
    seen: set[str] = set()
    out: list[str] = []
    for n in names:
        key = norm_text(n)
        if key and key not in seen:
            seen.add(key)
            out.append(n)
    return tuple(out)


def _experimental_drugs(arms_module: dict[str, Any]) -> tuple[str, ...]:
    names: list[str] = []
    for arm in arms_module.get("armGroups") or []:
        if arm.get("type") != "EXPERIMENTAL":
            continue
        for raw in arm.get("interventionNames") or []:
            prefix, sep, rest = str(raw).partition(":")
            if sep and prefix.strip().lower() in _DRUG_PREFIXES and rest.strip():
                names.append(rest.strip())
    if not names:
        for item in arms_module.get("interventions") or []:
            name = (item.get("name") or "").strip()
            if item.get("type") in _DRUG_TYPES and name:
                names.append(name)
    return _dedupe(names)


def _extras(study: dict[str, Any], cfg: AreaConfig) -> StudyExtras:
    proto = study.get("protocolSection") or {}
    elig = proto.get("eligibilityModule") or {}
    sex = elig.get("sex")
    meshes = ((study.get("derivedSection") or {}).get("conditionBrowseModule") or {}).get(
        "meshes"
    ) or []
    return StudyExtras(
        nct_id=proto["identificationModule"]["nctId"],
        brief_summary=(proto.get("descriptionModule") or {}).get("briefSummary"),
        sex=sex if sex in _SEXES else None,
        min_age_years=parse_age_years(elig.get("minimumAge")),
        max_age_years=parse_age_years(elig.get("maximumAge")),
        has_results=bool(study.get("hasResults", False)),
        experimental_drugs=_experimental_drugs(proto.get("armsInterventionsModule") or {}),
        mesh_terms=tuple(m["term"] for m in meshes if m.get("term")),
        condition_labels=tuple(condition_labels(study, cfg)),
    )


def extract_extras(relevant: Sequence[dict[str, Any]], cfg: AreaConfig) -> dict[str, StudyExtras]:
    """Extras keyed by NCT id for each relevant raw study."""
    result = (_extras(s, cfg) for s in relevant)
    return {e.nct_id: e for e in result}
