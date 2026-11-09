"""Decide which drugs are approved for which disease, per pipeline row (no network here).

Candidates for a row come from ChEMBL (seed drugs, widened through the same target, action
and modality for class rows). A drug is approved for a disease when ChEMBL has a phase-4
indication for it or its FDA label names the disease; hand overrides then add or exclude.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field, replace
from typing import Any, Protocol

from trialradar.approvals.io import SOURCES, Approval, Override
from trialradar.approvals.match import (
    LabelHit,
    Mech,
    indication_disease,
    label_hits,
    modality_group,
    widen,
)
from trialradar.config import ApprovalTerms
from trialradar.mechanisms.io import DrugMapping
from trialradar.pipeline_figure.io import FigureRow

Json = dict[str, Any]
DAILYMED = "https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid="
CHEMBL_CARD = "https://www.ebi.ac.uk/chembl/compound_report_card/"
_HAND_OK = ("mapped", "manual")
_BIOSIMILAR_SUFFIX = re.compile(r"-[a-z]{4}$")


class ChemblLike(Protocol):
    def molecule(self, chembl_id: str) -> Json: ...
    def mechanisms(self, parent_id: str) -> list[Json]: ...
    def mechanisms_on_target(self, target_id: str) -> list[Json]: ...
    def indications(self, parent_id: str) -> list[Json]: ...


class FdaLike(Protocol):
    def labels(self, generic_name: str) -> list[Json]: ...


@dataclass
class Review:
    """Printable lines, each ``"{row_id} × {disease}: {drug} — {detail}"``."""

    one_source: list[str] = field(default_factory=list)
    disagree: list[str] = field(default_factory=list)
    hand: list[str] = field(default_factory=list)
    negated: list[str] = field(default_factory=list)
    counts: dict[str, int] = field(default_factory=dict)


def _line(row_id: str, disease: str, drug: str, detail: str) -> str:
    return f"{row_id} × {disease}: {drug} — {detail}"


class _Lookups:
    """Memoised client calls: rows share drugs and targets."""

    def __init__(self, chembl: ChemblLike, fda: FdaLike) -> None:
        self._chembl = chembl
        self._fda = fda
        self._molecule: dict[str, Json] = {}
        self._on_target: dict[str, list[Json]] = {}
        self._indications: dict[str, list[Json]] = {}
        self._labels: dict[str, list[Json]] = {}

    def molecule(self, chembl_id: str) -> Json:
        if chembl_id not in self._molecule:
            self._molecule[chembl_id] = self._chembl.molecule(chembl_id)
        return self._molecule[chembl_id]

    def group(self, chembl_id: str) -> str:
        return modality_group(self.molecule(chembl_id).get("molecule_type"))

    def on_target(self, target_id: str) -> list[Json]:
        if target_id not in self._on_target:
            self._on_target[target_id] = self._chembl.mechanisms_on_target(target_id)
        return self._on_target[target_id]

    def indications(self, chembl_id: str) -> list[Json]:
        if chembl_id not in self._indications:
            self._indications[chembl_id] = self._chembl.indications(chembl_id)
        return self._indications[chembl_id]

    def labels(self, name: str) -> list[Json]:
        if name not in self._labels:
            self._labels[name] = self._fda.labels(name)
        return self._labels[name]

    def mechanisms(self, chembl_id: str) -> list[Json]:
        return self._chembl.mechanisms(chembl_id)


def _seed_ids(row: FigureRow, mappings: Mapping[str, DrugMapping]) -> set[str]:
    def usable(m: DrugMapping) -> bool:
        return m.status in _HAND_OK and bool(m.chembl_id)

    named = {mappings[n.casefold()] for n in row.drugs if n.casefold() in mappings}
    found = {m for m in named if usable(m)}
    if row.classes:
        wanted = set(row.classes)
        # all of a mapping's classes must belong to the row: a combination stays out
        found |= {
            m
            for m in mappings.values()
            if usable(m) and m.mechanism_class and set(m.mechanism_class) <= wanted
        }
    return {m.chembl_id for m in found if m.chembl_id}


def _candidates(row: FigureRow, seeds: set[str], look: _Lookups) -> set[str]:
    """ChEMBL ids (parents) of the drugs that count for ``row``."""
    seed_mechs: list[Mech] = []
    out: set[str] = set()
    for seed in sorted(seeds):
        group = look.group(seed)
        found = [
            Mech(
                str(r.get("parent_molecule_chembl_id") or seed),
                str(r["target_chembl_id"]),
                str(r.get("action_type") or "").upper(),
                group,
            )
            for r in look.mechanisms(seed)
            if r.get("target_chembl_id")
        ]
        seed_mechs += found
        out.update(m.parent_id for m in found)
        if not found:
            out.add(seed)  # no mechanism target: the seed itself still counts
    if not row.classes:
        return out
    on_target: dict[str, list[Mech]] = {}
    for target in sorted({m.target_id for m in seed_mechs}):
        actions = {m.action for m in seed_mechs if m.target_id == target}
        for r in look.on_target(target):
            action = str(r.get("action_type") or "").upper()
            parent = str(r.get("parent_molecule_chembl_id") or r.get("molecule_chembl_id") or "")
            if parent and action in actions:
                on_target.setdefault(target, []).append(
                    Mech(parent, target, action, look.group(parent))
                )
    return out | widen(seed_mechs, on_target)


def _label_is_for(name: str, label: Json) -> bool:
    """A single-ingredient label for ``name`` (kits and combinations are not)."""
    generic = str(label.get("generic_name") or "").casefold().strip()
    if generic:
        if ";" in generic or "," in generic or " and " in generic:
            return False
        generic = _BIOSIMILAR_SUFFIX.sub("", generic)
        return generic == name or generic.startswith(f"{name} ")
    want = name.split()
    words = str(label.get("product") or "").casefold().split()[: len(want) + 2]
    return any(words[i : i + len(want)] == want for i in range(len(words)))


def _phase(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _chembl_phases(
    indications: Sequence[Json], terms: Mapping[str, ApprovalTerms]
) -> tuple[set[str], set[str]]:
    """Diseases with a phase-4 indication, and those with an indication below phase 4."""
    approved: set[str] = set()
    below: set[str] = set()
    for ind in indications:
        disease = indication_disease(ind.get("mesh_heading"), ind.get("efo_term"), terms)
        if disease is None:
            continue
        (approved if _phase(ind.get("max_phase_for_ind")) >= 4 else below).add(disease)
    return approved, below


def _auto(
    row: FigureRow,
    cid: str,
    terms: Mapping[str, ApprovalTerms],
    look: _Lookups,
    review: Review,
    out: dict[tuple[str, str, str], Approval],
) -> None:
    mol = look.molecule(cid)
    name = str(mol.get("pref_name") or "").casefold() or cid
    withdrawn = bool(mol.get("withdrawn_flag"))
    chembl_ok, chembl_below = _chembl_phases(look.indications(cid), terms)
    labels = (
        [lb for lb in look.labels(name) if _label_is_for(name, lb)] if mol.get("pref_name") else []
    )
    fda_set: dict[str, str] = {}
    negated: dict[str, LabelHit] = {}
    for label in labels:
        for hit in label_hits(str(label.get("indications") or ""), terms):
            if hit.negated:
                negated.setdefault(hit.disease, hit)
            else:
                fda_set.setdefault(hit.disease, str(label.get("set_id") or ""))
    for disease, hit in sorted(negated.items()):
        if disease not in fda_set:
            review.negated.append(_line(row.id, disease, name, hit.sentence))
    for disease in sorted(chembl_ok | set(fda_set)):
        sources = tuple(
            s
            for s in SOURCES
            if (s == "chembl" and disease in chembl_ok) or (s == "fda_label" and disease in fda_set)
        )
        if "chembl" not in sources:
            if disease in chembl_below:
                review.disagree.append(
                    _line(row.id, disease, name, "FDA label yes, ChEMBL below phase 4")
                )
            else:
                review.one_source.append(_line(row.id, disease, name, "FDA label only"))
        elif "fda_label" not in sources:
            if labels:
                review.disagree.append(
                    _line(row.id, disease, name, "ChEMBL phase 4, FDA label does not name it")
                )
            else:
                review.one_source.append(_line(row.id, disease, name, "ChEMBL only"))
        set_id = fda_set.get(disease, "")
        url = f"{DAILYMED}{set_id}" if set_id else f"{CHEMBL_CARD}{cid}/"
        key = (row.id, disease, name)
        prior = out.get(key)
        if prior is not None:  # two molecules with one name: merge into one line
            sources = tuple(s for s in SOURCES if s in prior.sources or s in sources)
            withdrawn = withdrawn and prior.withdrawn
        out[key] = Approval(row.id, disease, name, cid, sources, withdrawn, "", None, url)


def _fold_variants(out: dict[tuple[str, str, str], Approval]) -> None:
    """Within one row x disease, fold "x acetate" into "x" (a name starting with another
    drug's name and a space); sources union, withdrawn only if both are."""
    for key in sorted(out, key=lambda k: (k[0], k[1], len(k[2]), k[2])):
        if key not in out:
            continue
        row_id, disease, name = key
        roots = [k for k in out if k[:2] == (row_id, disease) and name.startswith(f"{k[2]} ")]
        if not roots:
            continue
        root_key = min(roots, key=lambda k: len(k[2]))
        root, var = out[root_key], out.pop(key)
        out[root_key] = replace(
            root,
            chembl_id=root.chembl_id or var.chembl_id,
            url=root.url or var.url,
            sources=tuple(s for s in SOURCES if s in root.sources or s in var.sources),
            withdrawn=root.withdrawn and var.withdrawn,
        )


def _apply_overrides(
    out: dict[tuple[str, str, str], Approval], overrides: Sequence[Override], review: Review
) -> None:
    for o in overrides:
        key = (o.row_id, o.disease, o.drug.casefold())
        found = out.get(key)
        who = f"{o.row_id} × {o.disease}: {o.drug}"
        if o.action == "exclude":
            if found is None:
                review.hand.append(f"{who} — exclude (no match)")
            else:
                del out[key]
                review.hand.append(f"{who} — exclude" + (f": {o.note}" if o.note else ""))
            continue
        if found is None:
            out[key] = Approval(
                o.row_id, o.disease, o.drug.casefold(), "", ("hand",), o.withdrawn,
                o.regulator, o.year, o.source_url,
            )  # fmt: skip
        else:
            out[key] = Approval(
                found.row_id, found.disease, found.drug, found.chembl_id,
                tuple(s for s in SOURCES if s in found.sources or s == "hand"),
                found.withdrawn or o.withdrawn, o.regulator, o.year, o.source_url,
            )  # fmt: skip
        detail = " ".join(x for x in (o.regulator, str(o.year or "")) if x)
        review.hand.append(f"{who} — add {detail}".rstrip() + (f": {o.note}" if o.note else ""))


def build_approvals(
    rows: Sequence[FigureRow],
    mappings: Mapping[str, DrugMapping],
    terms: Mapping[str, ApprovalTerms],
    chembl: ChemblLike,
    fda: FdaLike,
    overrides: Sequence[Override],
) -> tuple[list[Approval], Review]:
    """Approvals sorted by ``(row_id, disease, drug)``, and the review for the human."""
    look = _Lookups(chembl, fda)
    review = Review()
    out: dict[tuple[str, str, str], Approval] = {}
    for row in rows:
        seeds = _seed_ids(row, mappings)
        for cid in sorted(_candidates(row, seeds, look)):
            _auto(row, cid, terms, look, review, out)
    _fold_variants(out)
    _apply_overrides(out, overrides, review)
    items = sorted(out.values(), key=lambda a: (a.row_id, a.disease, a.drug.casefold()))
    review.counts = {d: len({a.row_id for a in items if a.disease == d}) for d in sorted(terms)}
    for lines in (review.one_source, review.disagree, review.negated):
        lines[:] = sorted(set(lines))
    return items, review
