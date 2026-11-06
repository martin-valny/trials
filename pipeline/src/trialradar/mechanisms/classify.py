"""Derive a short mechanism class ("anti-CD20", "S1P receptor modulator") from ChEMBL rows."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from trialradar.mechanisms.chembl import ChemblClient
from trialradar.mechanisms.io import DrugMapping

MODALITY: dict[str, str] = {
    "Small molecule": "small molecule",
    "Antibody": "antibody",
    "Protein": "protein",
    "Oligonucleotide": "oligonucleotide",
    "Cell": "cell therapy",
    "Gene": "gene therapy",
}

_WORDS: dict[str, tuple[str, ...]] = {
    "inhibitor": ("INHIBITOR", "NEGATIVE ALLOSTERIC MODULATOR", "BLOCKER"),
    "inverse agonist": ("INVERSE AGONIST",),
    "antagonist": ("ANTAGONIST",),
    "modulator": (
        "AGONIST",
        "PARTIAL AGONIST",
        "POSITIVE ALLOSTERIC MODULATOR",
        "MODULATOR",
        "BINDING AGENT",
    ),
    "activator": ("ACTIVATOR", "OPENER"),
    "agent": (
        "DISRUPTING AGENT",
        "CROSS-LINKING AGENT",
        "CHELATING AGENT",
        "HYDROLYTIC ENZYME",
        "RELEASING AGENT",
        "SEQUESTERING AGENT",
    ),
    "silencer": ("RNAI INHIBITOR", "ANTISENSE INHIBITOR"),
}
ACTION_WORD: dict[str, str] = {a: word for word, actions in _WORDS.items() for a in actions}

_BIOLOGIC = frozenset({"antibody", "protein"})
_ANTI_WORDS = frozenset({"inhibitor", "antagonist", "agent"})


def modality(molecule_type: str | None) -> str:
    return MODALITY.get(molecule_type or "", "other")


def action_word(action_type: str) -> str:
    return ACTION_WORD.get(action_type, action_type.lower())


def mechanism_class(target_label: str, action_type: str, modality: str | None) -> str:
    if modality == "cell therapy":
        return f"{target_label} CAR-T"
    word = action_word(action_type)
    if modality in _BIOLOGIC and (word in _ANTI_WORDS or action_type == "BINDING AGENT"):
        return f"anti-{target_label}"
    return f"{target_label} {word}"


def target_label(
    target: Mapping[str, Any], genes: tuple[str, ...], labels: Mapping[str, str]
) -> str:
    tid = target.get("target_chembl_id")
    if isinstance(tid, str) and tid in labels:
        return labels[tid]
    if genes and (joined := ";".join(genes)) in labels:
        return labels[joined]
    for gene in genes:
        if gene in labels:
            return labels[gene]
    name = target.get("pref_name")
    name = name.strip() if isinstance(name, str) and name.strip() else str(tid or "unknown target")
    # "X receptor family" -> "X receptor", "Y family" -> "Y"
    return name.removesuffix(" family")


def map_drug(client: ChemblClient, drug: str, labels: Mapping[str, str]) -> DrugMapping:
    """Molecule → parent → mechanisms (by parent id) → targets → genes → label → class.

    No exact name match → ``unmapped`` with empty fields. A molecule with no usable
    mechanism row stays ``unmapped`` but keeps its ChEMBL id and modality.
    """
    mol = client.find_molecule(drug)
    if mol is None:
        return DrugMapping(drug, "unmapped", None, None, (), (), (), ())
    pid = client.parent_id(mol)
    parent = mol if mol.get("molecule_chembl_id") == pid else client.molecule(pid)
    mod = modality(parent.get("molecule_type"))

    classes: set[str] = set()
    texts: set[str] = set()
    actions: set[str] = set()
    targets: set[str] = set()
    for row in client.mechanisms(pid):
        action = row.get("action_type")
        text = row.get("mechanism_of_action")
        if isinstance(text, str) and text.strip():
            texts.add(text.strip())
        if isinstance(action, str) and action:
            actions.add(action)
        tid = row.get("target_chembl_id")
        if not (isinstance(tid, str) and tid and isinstance(action, str) and action):
            continue
        target = client.target(tid)
        genes = client.target_genes(target)
        targets.update(genes)
        classes.add(mechanism_class(target_label(target, genes, labels), action, mod))
    return DrugMapping(
        drug=drug,
        status="mapped" if classes else "unmapped",
        chembl_id=pid,
        modality=mod,
        mechanism_class=tuple(sorted(classes)),
        mechanism=tuple(sorted(texts)),
        action_type=tuple(sorted(actions)),
        targets=tuple(sorted(targets)),
    )
