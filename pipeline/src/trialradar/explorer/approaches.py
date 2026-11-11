"""Per-trial approach bubbles and the drug index for ``explorer.json`` (spec 2026-11-08 §6.3).

Every experimental intervention (of any type) is cleaned like a drug name and sorted by
:mod:`trialradar.approaches.sort`. A missing or invalid ``config/approaches`` (or a kind key
that collides with a molecular class in use) skips the approach parts with one
``approaches:`` warning, and the run continues (R19).
"""

from __future__ import annotations

from collections.abc import Iterable, Iterator, Mapping, Sequence
from typing import Any

from trialradar.approaches.io import (
    APPROACH_LABELS,
    APPROACHES,
    ApproachConfig,
    check_collisions,
    read_approaches,
)
from trialradar.approaches.sort import (
    Intervention,
    TrialApproaches,
    sort_intervention,
    trial_approaches,
)
from trialradar.config import AreaConfig
from trialradar.explorer.drugs import clean_drug_name
from trialradar.explorer.extras import MAPPING_TYPES, StudyExtras
from trialradar.explorer.outcomes import TrialDrugs
from trialradar.mechanisms.io import DrugMapping, read_mappings, split_cell

_RESOLVED = ("mapped", "manual")
_DRUG_TYPES = ("DRUG", "BIOLOGICAL")
EMPTY = TrialApproaches((), (), (), ())


def _interventions(
    study: StudyExtras, aliases: Mapping[str, str], cfg: AreaConfig, *, fallback: bool = False
) -> Iterator[Intervention]:
    """The study's experimental interventions with cleaned names; placebo, sham and other
    ``exclude_terms`` matches are dropped. A cleaned experimental drug that no intervention
    carries is added as a Drug, so every drug is sorted. With ``fallback`` (approach sorting
    only), a trial with no experimental arm yields all its interventions instead."""
    seen: set[str] = set()
    source = study.experimental_interventions
    if fallback and not source and not study.experimental_drugs:
        source = study.fallback_interventions
    for iv in source:
        name = clean_drug_name(iv.name, aliases, cfg.explorer.exclude_terms)
        if name is not None and name not in seen:
            seen.add(name)
            yield Intervention(iv.type.strip().upper(), name, iv.description)
    for raw in study.experimental_drugs:
        name = clean_drug_name(raw, aliases, cfg.explorer.exclude_terms)
        if name is not None and name not in seen:
            seen.add(name)
            yield Intervention("DRUG", name)


def mapping_names(
    full: Mapping[str, StudyExtras], aliases: Mapping[str, str], cfg: AreaConfig
) -> TrialDrugs:
    """Per trial, the cleaned names looked up in the drug mapping: experimental drugs plus
    supplement, genetic and combination-product interventions (:data:`MAPPING_TYPES`)."""
    return {
        nct: frozenset(
            iv.name for iv in _interventions(study, aliases, cfg) if iv.type in MAPPING_TYPES
        )
        for nct, study in full.items()
    }


def mapping_types(
    full: Mapping[str, StudyExtras], aliases: Mapping[str, str], cfg: AreaConfig
) -> dict[str, str]:
    """The intervention type of each mapping name (Drug/Biological win over other types)."""
    types: dict[str, str] = {}
    for study in full.values():
        for iv in _interventions(study, aliases, cfg):
            if iv.type in _DRUG_TYPES:
                types[iv.name] = iv.type
            elif iv.type in MAPPING_TYPES:
                types.setdefault(iv.name, iv.type)
    return types


def mapping_descriptions(
    full: Mapping[str, StudyExtras], aliases: Mapping[str, str], cfg: AreaConfig
) -> dict[str, list[str]]:
    """Every distinct description each mapping name carries (sorted), so the drug index sorts
    a name the way each trial that holds it does."""
    found: dict[str, set[str]] = {}
    for study in full.values():
        for iv in _interventions(study, aliases, cfg):
            found.setdefault(iv.name, set()).add(iv.description)
    return {name: sorted(d) for name, d in found.items()}


def molecular_classes(mappings: Mapping[str, DrugMapping]) -> set[str]:
    """The class of each resolved single-class row that has gene targets (the collision
    check's input). A multi-part row (``immunoglobulin;glucocorticoid receptor modulator``
    with ``NR3C1``) is left out: its targets cannot be told apart by part, and spec §6.2
    sorts each part on its own, so a kind key there is a combination, not a clash."""
    return {
        m.mechanism_class[0]
        for m in mappings.values()
        if m.status in _RESOLVED and m.targets and len(m.mechanism_class) == 1
    }


def load_trial_approaches(
    cfg: AreaConfig,
    full: Mapping[str, StudyExtras],
    aliases: Mapping[str, str],
    warnings: list[str],
    mappings: Mapping[str, DrugMapping] | None = None,
) -> tuple[dict[str, TrialApproaches], ApproachConfig | None]:
    """Each trial's approaches, kinds, molecular classes and unsorted names, and the config.

    ``mappings`` defaults to the drug mapping in ``cfg.mechanisms_dir`` (an unreadable mapping
    is reported by the mechanism loader; here it only leaves drugs unsorted). On a missing or
    invalid approach file or a kind collision: one ``approaches:`` warning, every trial
    :data:`EMPTY` and ``None``."""
    if mappings is None:
        try:
            mappings = read_mappings(cfg.mechanisms_dir)
        except (OSError, ValueError):
            mappings = {}
    try:
        acfg = read_approaches(cfg.approaches_dir)
        check_collisions(acfg, molecular_classes(mappings))
    except (OSError, ValueError) as exc:
        warnings.append(f"approaches: {exc}")
        return {nct: EMPTY for nct in full}, None
    out = {
        nct: trial_approaches(
            tuple(_interventions(study, aliases, cfg, fallback=True)), mappings, acfg
        )
        for nct, study in full.items()
    }
    return out, acfg


def drug_index(
    names: Iterable[str],
    mappings: Mapping[str, DrugMapping],
    acfg: ApproachConfig | None,
    types: Mapping[str, str] | None = None,
    descriptions: Mapping[str, Sequence[str]] | None = None,
) -> dict[str, dict[str, list[str]]]:
    """``{name: {mechanisms, modalities, kinds, approaches}}``, sorted by name.

    The web credits a success to a group only through the drugs that moved on (1b), and
    looks their groups up here. ``types`` gives each name's intervention type for the
    keyword and fallback rules (default Drug); ``descriptions`` gives the descriptions its
    trials carry (the keyword rules read each one's first sentence, as in the trial sort, and
    the groups found are united). Without an approach config, ``kinds`` and
    ``approaches`` are empty."""
    types = types or {}
    descriptions = descriptions or {}
    kind_keys = acfg.kinds.keys() if acfg is not None else frozenset()
    out: dict[str, dict[str, list[str]]] = {}
    for name in sorted(set(names)):
        row = mappings.get(name)
        resolved = row is not None and row.status in _RESOLVED
        mechanisms = (
            sorted({c for c in row.mechanism_class if c not in kind_keys})
            if row is not None and resolved
            else []
        )
        modalities = sorted(set(split_cell(row.modality))) if row is not None and resolved else []
        kinds: list[str] = []
        approaches: list[str] = []
        if acfg is not None:
            sorts = [
                sort_intervention(Intervention(types.get(name, "DRUG"), name, d), mappings, acfg)
                for d in descriptions.get(name) or [""]
            ]
            kinds = sorted({k for s in sorts for k in s.kinds})
            found = {acfg.kinds[k].approach for k in kinds}
            if any(s.molecular for s in sorts):
                found.add("targeted")
            if found - {"unclassified"}:
                found.discard("unclassified")
            approaches = [a for a in APPROACHES if a in found]
        out[name] = {
            "mechanisms": mechanisms,
            "modalities": modalities,
            "kinds": kinds,
            "approaches": approaches,
        }
    return out


def approach_meta(acfg: ApproachConfig | None) -> tuple[list[dict[str, str]], dict[str, Any]]:
    """File-level ``approaches`` (in :data:`APPROACHES` order) and ``kinds``; empty without a
    config."""
    if acfg is None:
        return [], {}
    approaches = [{"key": k, "label": APPROACH_LABELS[k]} for k in APPROACHES]
    kinds = {
        k.key: {
            "approach": k.approach,
            "group": k.group,
            "label": k.label,
            "rationale": k.rationale,
            "source_url": k.source_url,
        }
        for k in sorted(acfg.kinds.values(), key=lambda k: k.key)
    }
    return approaches, kinds
