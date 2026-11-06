"""Mechanism-class derivation: modality, action words, target labels."""

from __future__ import annotations

from typing import Any

import pytest

from trialradar.mechanisms.classify import (
    ACTION_WORD,
    MODALITY,
    mechanism_class,
    modality,
    target_label,
)


@pytest.mark.parametrize(
    ("label", "action", "mod", "expected"),
    [
        ("CD20", "INHIBITOR", "antibody", "anti-CD20"),
        ("S1P receptor", "AGONIST", "small molecule", "S1P receptor modulator"),
        ("FcRn", "BINDING AGENT", "antibody", "anti-FcRn"),
        ("BTK", "INHIBITOR", "small molecule", "BTK inhibitor"),
        ("FcRn", "ANTAGONIST", "protein", "anti-FcRn"),
        ("CD20", "DISRUPTING AGENT", "antibody", "anti-CD20"),
        ("IFN-α/β receptor", "AGONIST", "protein", "IFN-α/β receptor modulator"),
        ("NRF2", "ACTIVATOR", "small molecule", "NRF2 activator"),
        ("X", "ANTISENSE INHIBITOR", "oligonucleotide", "X silencer"),
        ("X", "SUBSTRATE", None, "X substrate"),
        ("S1P receptor", "BINDING AGENT", "small molecule", "S1P receptor modulator"),
    ],
)
def test_mechanism_class_examples(label: str, action: str, mod: str | None, expected: str) -> None:
    assert mechanism_class(label, action, mod) == expected


def test_modality_mapping_for_every_listed_type() -> None:
    assert MODALITY == {
        "Small molecule": "small molecule",
        "Antibody": "antibody",
        "Protein": "protein",
        "Oligonucleotide": "oligonucleotide",
        "Cell": "cell therapy",
        "Gene": "gene therapy",
    }
    for raw, mapped in MODALITY.items():
        assert modality(raw) == mapped
    assert modality("Enzyme") == "other"
    assert modality("Unknown") == "other"
    assert modality(None) == "other"


def test_action_words() -> None:
    for a in ("INHIBITOR", "NEGATIVE ALLOSTERIC MODULATOR", "BLOCKER"):
        assert ACTION_WORD[a] == "inhibitor"
    assert ACTION_WORD["ANTAGONIST"] == "antagonist"
    for a in ("AGONIST", "PARTIAL AGONIST", "POSITIVE ALLOSTERIC MODULATOR", "MODULATOR"):
        assert ACTION_WORD[a] == "modulator"
    assert ACTION_WORD["BINDING AGENT"] == "modulator"
    assert ACTION_WORD["ACTIVATOR"] == ACTION_WORD["OPENER"] == "activator"
    for a in (
        "DISRUPTING AGENT",
        "CROSS-LINKING AGENT",
        "CHELATING AGENT",
        "HYDROLYTIC ENZYME",
        "RELEASING AGENT",
    ):
        assert ACTION_WORD[a] == "agent"
    assert ACTION_WORD["RNAI INHIBITOR"] == ACTION_WORD["ANTISENSE INHIBITOR"] == "silencer"


def _target(tid: str, name: str) -> dict[str, Any]:
    return {"target_chembl_id": tid, "pref_name": name, "target_components": []}


def test_target_label_precedence() -> None:
    labels = {"CHEMBL1": "by id", "A;B": "by tuple", "B": "by single", "C": "c single"}
    assert target_label(_target("CHEMBL1", "x"), ("A", "B"), labels) == "by id"
    assert target_label(_target("CHEMBL2", "x"), ("A", "B"), labels) == "by tuple"
    assert target_label(_target("CHEMBL2", "x"), ("A", "B", "Z"), labels) == "by single"
    # several single genes labelled: the first in gene order wins, deterministically
    assert target_label(_target("CHEMBL2", "x"), ("B", "C"), labels) == "by single"


def test_target_label_falls_back_to_pref_name() -> None:
    assert target_label(_target("T", "Sphingosine 1-phosphate receptor family"), (), {}) == (
        "Sphingosine 1-phosphate receptor"
    )
    assert (
        target_label(_target("T", "Potassium channel family"), ("K1",), {}) == "Potassium channel"
    )
    assert target_label(_target("T", "Tyrosine-protein kinase BTK"), ("BTK",), {}) == (
        "Tyrosine-protein kinase BTK"
    )
