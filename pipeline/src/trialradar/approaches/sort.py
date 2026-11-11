"""Sort an experimental intervention into molecular classes or kinds (spec §6.2).

Order, for every intervention whatever its type:

1. a ``not_a_drug`` mapping row → ``not_a_treatment``;
2. a ``mapped``/``manual`` row with a class → each class part is a kind (if it is a key
   in ``kinds.csv``) or molecular (Targeted drugs);
3. otherwise every matching keyword rule adds its kind;
4. otherwise the type fallback ``type:<TYPE>`` (``type:OTHER`` for an unknown type).

Nothing is guessed from a name ending; unmatched names stay visible as "Not yet sorted".
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from trialradar.approaches.io import (
    APPROACHES,
    NOT_A_TREATMENT_KIND,
    NOT_YET_SORTED,
    TYPE_PREFIX,
    ApproachConfig,
    Rule,
)
from trialradar.mechanisms.io import DrugMapping

_SENTENCE_END = re.compile(r"\.(?:\s|$)")


@dataclass(frozen=True)
class Intervention:
    type: str  # ClinicalTrials.gov intervention type, e.g. "BEHAVIORAL"
    name: str  # cleaned, casefolded
    description: str = ""


@dataclass(frozen=True)
class Sorted:
    molecular: tuple[str, ...]
    kinds: tuple[str, ...]
    unsorted: bool


@dataclass(frozen=True)
class TrialApproaches:
    approaches: tuple[str, ...]
    kinds: tuple[str, ...]
    mechanisms: tuple[str, ...]
    unsorted: tuple[str, ...]


def _first_sentence(text: str) -> str:
    """``text`` up to the first ``". "`` or ``".\\n"`` (or its end)."""
    m = _SENTENCE_END.search(text)
    return text[: m.start()] if m else text


def _matches(rule: Rule, texts: Sequence[str]) -> bool:
    pat = re.compile(rf"(?<!\w){re.escape(rule.pattern)}(?!\w)")
    return any(pat.search(t) for t in texts)


def sort_intervention(
    iv: Intervention, mappings: Mapping[str, DrugMapping], cfg: ApproachConfig
) -> Sorted:
    """Where one intervention goes; see the module docstring for the order."""
    name = iv.name.casefold()
    row = mappings.get(name)
    if row is not None and row.status == "not_a_drug":
        return Sorted((), (NOT_A_TREATMENT_KIND,), False)
    if row is not None and row.status in ("mapped", "manual") and row.mechanism_class:
        kinds = tuple(dict.fromkeys(p for p in row.mechanism_class if p in cfg.kinds))
        molecular = tuple(dict.fromkeys(p for p in row.mechanism_class if p not in cfg.kinds))
        return Sorted(molecular, kinds, False)

    texts = (" ".join(name.split()), " ".join(_first_sentence(iv.description.casefold()).split()))
    itype = iv.type.upper()
    matched = sorted(
        {r.kind for r in cfg.rules if (not r.types or itype in r.types) and _matches(r, texts)}
    )
    if matched:
        return Sorted((), tuple(matched), False)

    key = f"{TYPE_PREFIX}{itype}"
    if key not in cfg.kinds:
        key = f"{TYPE_PREFIX}OTHER"
    return Sorted((), (key,), cfg.kinds[key].group == NOT_YET_SORTED)


def trial_approaches(
    ivs: Sequence[Intervention], mappings: Mapping[str, DrugMapping], cfg: ApproachConfig
) -> TrialApproaches:
    """A trial's bubbles: Targeted if any molecular class, plus each kind's approach.

    A trial is Unclassified only when it is in no other bubble; then ``kinds`` keeps the
    unclassified kinds, otherwise they are dropped. ``unsorted`` lists every name that
    landed in "Not yet sorted", even when the trial has other bubbles.
    """
    molecular: set[str] = set()
    kinds: set[str] = set()
    unsorted: set[str] = set()
    for iv in ivs:
        s = sort_intervention(iv, mappings, cfg)
        molecular.update(s.molecular)
        kinds.update(s.kinds)
        if s.unsorted:
            unsorted.add(iv.name)

    found = {cfg.kinds[k].approach for k in kinds} - {"unclassified"}
    if molecular:
        found.add("targeted")
    if found:
        approaches = tuple(a for a in APPROACHES if a in found)
        kinds = {k for k in kinds if cfg.kinds[k].approach != "unclassified"}
    else:
        approaches = ("unclassified",)
    return TrialApproaches(
        approaches=approaches,
        kinds=tuple(sorted(kinds)),
        mechanisms=tuple(sorted(molecular)),
        unsorted=tuple(sorted(unsorted)),
    )
