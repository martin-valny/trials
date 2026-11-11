"""Pure matching rules for the approved-for-disease script: drug widening and disease matching."""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass

from trialradar.config import ApprovalTerms

_GROUPS_AS_IS = {"Antibody", "Protein", "Small molecule"}
_CELL_THERAPY = {"Cell", "Gene"}
_NEGATION = re.compile(r"not indicated|limitations of use", re.IGNORECASE)
_SENTENCE_END = re.compile(r"(?<=[.!?])\s+")
_MAX_SENTENCE = 300


def modality_group(molecule_type: str | None) -> str:
    """Coarse modality used to keep widening within like-for-like drugs."""
    if not molecule_type:
        return "unknown"
    if molecule_type in _CELL_THERAPY:
        return "cell therapy"
    return molecule_type


@dataclass(frozen=True)
class Mech:
    """One mechanism of one molecule; ``action`` is upper-case as ChEMBL gives it."""

    parent_id: str
    target_id: str
    action: str
    group: str


def widen(seeds: Iterable[Mech], on_target: Mapping[str, Sequence[Mech]]) -> set[str]:
    """Seed parents plus drugs sharing a seed's target, action and modality group."""
    out: set[str] = set()
    for seed in seeds:
        out.add(seed.parent_id)
        key = (seed.action, seed.group)
        out.update(
            m.parent_id for m in on_target.get(seed.target_id, ()) if (m.action, m.group) == key
        )
    return out


def indication_disease(
    mesh: str | None, efo: str | None, terms: Mapping[str, ApprovalTerms]
) -> str | None:
    """Disease whose MeSH list holds ``mesh`` exactly, else whose EFO pairs hold (mesh, efo)."""
    if mesh is None:
        return None
    for disease, t in terms.items():
        if mesh in t.mesh:
            return disease
    if efo is None:
        return None
    efo_key = efo.casefold()
    for disease, t in terms.items():
        if any(m == mesh and e.casefold() == efo_key for m, e in t.efo):
            return disease
    return None


@dataclass(frozen=True)
class LabelHit:
    disease: str
    sentence: str
    negated: bool


def label_hits(indications_text: str, terms: Mapping[str, ApprovalTerms]) -> list[LabelHit]:
    """First label sentence per disease mentioning one of its phrases, flagged if negated."""
    sentences = _SENTENCE_END.split(indications_text)
    hits: list[LabelHit] = []
    for disease, t in terms.items():
        if not t.label_terms:
            continue
        pattern = re.compile("|".join(rf"\b{re.escape(p)}\b" for p in t.label_terms), re.IGNORECASE)
        for i, sentence in enumerate(sentences):
            if pattern.search(sentence):
                context = " ".join(sentences[max(i - 1, 0) : i + 1])
                hits.append(
                    LabelHit(
                        disease,
                        " ".join(sentence.split())[:_MAX_SENTENCE],
                        bool(_NEGATION.search(context)),
                    )
                )
                break
    return hits
