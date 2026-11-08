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

MAPPING_TYPES: frozenset[str] = frozenset(
    {"DRUG", "BIOLOGICAL", "DIETARY_SUPPLEMENT", "GENETIC", "COMBINATION_PRODUCT"}
)
"""Intervention types whose names are looked up in the drug mapping (spec 2026-11-08 §6.2)."""


@dataclass(frozen=True)
class ExperimentalIntervention:
    """One experimental-arm intervention: CT.gov type enum, raw name and description."""

    type: str
    name: str
    description: str


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
    experimental_interventions: tuple[ExperimentalIntervention, ...] = ()
    fallback_interventions: tuple[ExperimentalIntervention, ...] = ()
    """Approach sorting only: every intervention (any type) of a trial whose arms include no
    EXPERIMENTAL arm (spec 2026-11-08 §6.3). Empty otherwise; never feeds drugs, pool or success."""


def empty_extras(nct_id: str) -> StudyExtras:
    """Extras for a trial whose record gave none: no summary, labels or drugs."""
    return StudyExtras(nct_id, None, None, None, None, False, (), (), (), ())


def parse_age_years(text: object) -> float | None:
    """Parse an API age such as '18 Years' or '6 Months' into years (anything else: None)."""
    if not isinstance(text, str) or not text:
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
    arm_groups = arms_module.get("armGroups") or []
    for arm in arm_groups:
        if not isinstance(arm, dict) or arm.get("type") != "EXPERIMENTAL":
            continue
        for raw in arm.get("interventionNames") or []:
            prefix, sep, rest = str(raw).partition(":")
            if sep and prefix.strip().lower() in _DRUG_PREFIXES and rest.strip():
                names.append(rest.strip())
    if not arm_groups:
        for item in arms_module.get("interventions") or []:
            if not isinstance(item, dict):
                continue
            name = (item.get("name") or "").strip()
            if item.get("type") in _DRUG_TYPES and name:
                names.append(name)
    return _dedupe(names)


def _intervention(item: dict[str, Any]) -> ExperimentalIntervention | None:
    name = str(item.get("name") or "").strip()
    if not name:
        return None
    return ExperimentalIntervention(
        type=str(item.get("type") or "").strip(),
        name=name,
        description=str(item.get("description") or "").strip(),
    )


def _experimental_interventions(
    arms_module: dict[str, Any],
) -> tuple[ExperimentalIntervention, ...]:
    """Every intervention of every type in EXPERIMENTAL arms (the ``_experimental_drugs`` rule).

    An arm's ``"Type: Name"`` entry is resolved to the ``interventions`` item of the same name
    for its type and description; with no such item, the prefix gives the type (a bare label
    with no prefix keeps an empty type, so it stays visible). A study with
    no arm groups takes all its interventions. Deduped by name."""
    items = [i for i in arms_module.get("interventions") or [] if isinstance(i, dict)]
    by_name: dict[str, list[ExperimentalIntervention]] = {}
    for item in items:
        iv = _intervention(item)
        key = norm_text(iv.name) if iv else None
        if iv is not None and key:
            by_name.setdefault(key, []).append(iv)
    out: list[ExperimentalIntervention] = []
    arm_groups = arms_module.get("armGroups") or []
    for arm in arm_groups:
        if not isinstance(arm, dict) or arm.get("type") != "EXPERIMENTAL":
            continue
        for raw in arm.get("interventionNames") or []:
            prefix, sep, rest = str(raw).partition(":")
            name = rest.strip() if sep else prefix.strip()
            if not name:
                continue
            # the prefix gives the type; a bare label with no prefix keeps an empty type
            kind = prefix.strip().upper().replace(" ", "_") if sep else ""
            matches = by_name.get(norm_text(name) or "", [])
            same_type = [m for m in matches if m.type == kind]
            if same_type or matches:
                out.append((same_type or matches)[0])
            else:
                out.append(ExperimentalIntervention(kind, name, ""))
    if not arm_groups:
        out = _all_interventions(items)
    return _dedupe_interventions(out)


def _all_interventions(items: Sequence[dict[str, Any]]) -> list[ExperimentalIntervention]:
    return [iv for iv in (_intervention(i) for i in items) if iv is not None]


def _dedupe_interventions(
    ivs: Sequence[ExperimentalIntervention],
) -> tuple[ExperimentalIntervention, ...]:
    seen: set[str] = set()
    deduped: list[ExperimentalIntervention] = []
    for iv in ivs:
        key = norm_text(iv.name)
        if key and key not in seen:
            seen.add(key)
            deduped.append(iv)
    return tuple(deduped)


def _fallback_interventions(arms_module: dict[str, Any]) -> tuple[ExperimentalIntervention, ...]:
    """All interventions when there are arm groups but none is EXPERIMENTAL (else empty).

    Used only to sort the trial into approach bubbles; ``experimental_drugs`` is untouched."""
    arm_groups = arms_module.get("armGroups") or []
    if not arm_groups or any(
        isinstance(a, dict) and a.get("type") == "EXPERIMENTAL" for a in arm_groups
    ):
        return ()
    items = [i for i in arms_module.get("interventions") or [] if isinstance(i, dict)]
    return _dedupe_interventions(_all_interventions(items))


def _extras(study: dict[str, Any], cfg: AreaConfig) -> StudyExtras:
    proto = study.get("protocolSection") or {}
    elig = proto.get("eligibilityModule") or {}
    sex = elig.get("sex")
    arms = proto.get("armsInterventionsModule") or {}
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
        experimental_drugs=_experimental_drugs(arms),
        mesh_terms=tuple(m["term"] for m in meshes if isinstance(m, dict) and m.get("term")),
        condition_labels=tuple(condition_labels(study, cfg)),
        experimental_interventions=_experimental_interventions(arms),
        fallback_interventions=_fallback_interventions(arms),
    )


def _nct_id(study: Any) -> str | None:
    try:
        nct = study["protocolSection"]["identificationModule"]["nctId"]
    except (KeyError, TypeError, IndexError):
        return None
    return nct if isinstance(nct, str) and nct else None


def extract_extras(
    relevant: Sequence[dict[str, Any]], cfg: AreaConfig
) -> tuple[dict[str, StudyExtras], list[str]]:
    """Extras keyed by NCT id for each relevant raw study, and warnings.

    Extras only feed the explorer and the trial pages' extra fields, so a study whose
    record is malformed here gets empty extras and an ``extras_fallback`` warning
    instead of failing the run; one without a usable NCT id is left out."""
    out: dict[str, StudyExtras] = {}
    warnings: list[str] = []
    for study in relevant:
        try:
            e = _extras(study, cfg)
        except Exception as exc:  # noqa: BLE001 - malformed extras never fail the run
            nct = _nct_id(study)
            warnings.append(f"extras_fallback: {nct or '<no id>'}: {type(exc).__name__}: {exc}")
            if nct is not None:
                out[nct] = empty_extras(nct)
            continue
        out[e.nct_id] = e
    return out, warnings
