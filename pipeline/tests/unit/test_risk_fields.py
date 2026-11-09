"""Tests for the raw stop-risk fields."""

from __future__ import annotations

from conftest import make_study

from trialradar.risk.fields import risk_fields


def test_risk_fields_from_make_study() -> None:
    study = make_study(
        "NCT00000007",
        **{
            "armsInterventionsModule.armGroups": [
                {"label": "A", "type": "EXPERIMENTAL"},
                {"label": "B", "type": "PLACEBO_COMPARATOR"},
            ]
        },
    )
    study["derivedSection"] = {
        "conditionBrowseModule": {
            "meshes": [{"id": "D1", "term": "Multiple Sclerosis"}],
            "ancestors": [
                {"id": "D2", "term": "Nervous System Diseases"},
                {"id": "D3", "term": "Neoplasms"},
                {"id": "D4", "term": "Neoplasms"},
                {"id": "D5", "term": "Not A Category"},
            ],
        }
    }
    fields = risk_fields(study)
    assert fields.nct_id == "NCT00000007"
    assert fields.n_arms == 2
    assert fields.placebo_arm is True
    assert fields.categories == ("Neoplasms", "Nervous System Diseases")


def test_sham_counts_as_placebo() -> None:
    study = make_study(**{"armsInterventionsModule.armGroups": [{"type": "SHAM_COMPARATOR"}]})
    assert risk_fields(study).placebo_arm is True


def test_risk_fields_missing_modules() -> None:
    fields = risk_fields({"protocolSection": {}})
    assert fields.n_arms is None
    assert fields.placebo_arm is False
    assert fields.categories == ()


def _browse(meshes: list[str], ancestors: list[str]) -> dict:
    study = make_study("NCT00000008")
    study["derivedSection"] = {
        "conditionBrowseModule": {
            "meshes": [{"id": f"M{i}", "term": t} for i, t in enumerate(meshes)],
            "ancestors": [{"id": f"A{i}", "term": t} for i, t in enumerate(ancestors)],
        }
    }
    return study


# MeSH files some autoimmune conditions under paraneoplastic syndromes; that chain alone
# reaches "Neoplasms" without any tumour in the trial.
_PARA_CHAIN = [
    "Paraneoplastic Syndromes, Nervous System",
    "Paraneoplastic Syndromes",
    "Nervous System Neoplasms",
    "Neoplasms by Site",
    "Neoplasms",
]


def test_paraneoplastic_chain_alone_is_not_neoplasms() -> None:
    mg = _browse(
        ["Myasthenia Gravis"],
        [*_PARA_CHAIN, "Neuromuscular Junction Diseases", "Nervous System Diseases"],
    )
    assert risk_fields(mg).categories == ("Nervous System Diseases",)


def test_anti_nmdar_encephalitis_is_not_neoplasms() -> None:
    enc = _browse(
        ["Anti-N-Methyl-D-Aspartate Receptor Encephalitis", "Encephalitis"],
        [
            *_PARA_CHAIN,
            "Limbic Encephalitis",
            "Autoimmune Diseases of the Nervous System",
            "Autoimmune Diseases",
            "Immune System Diseases",
            "Nervous System Diseases",
        ],
    )
    assert "Neoplasms" not in risk_fields(enc).categories
    assert risk_fields(enc).categories == ("Immune System Diseases", "Nervous System Diseases")


def test_paraneoplastic_with_haematologic_neoplasm_keeps_neoplasms() -> None:
    basket = _browse(
        ["Myasthenia Gravis", "Lymphoma"],
        [*_PARA_CHAIN, "Neoplasms by Histologic Type", "Hematologic Neoplasms"],
    )
    assert "Neoplasms" in risk_fields(basket).categories


def test_paraneoplastic_with_direct_neoplasms_mesh_keeps_neoplasms() -> None:
    both = _browse(["Myasthenia Gravis", "Neoplasms"], _PARA_CHAIN)
    assert "Neoplasms" in risk_fields(both).categories


def test_paraneoplastic_with_thymoma_keeps_neoplasms() -> None:
    thy = _browse(
        ["Myasthenia Gravis", "Thymoma"],
        [*_PARA_CHAIN, "Thymus Neoplasms", "Neoplasms, Complex and Mixed"],
    )
    assert "Neoplasms" in risk_fields(thy).categories


def test_brain_tumour_keeps_neoplasms() -> None:
    gbm = _browse(
        ["Glioblastoma"],
        [
            "Astrocytoma",
            "Glioma",
            "Neoplasms, Neuroepithelial",
            "Neoplasms by Histologic Type",
            "Brain Neoplasms",
            "Central Nervous System Neoplasms",
            "Nervous System Neoplasms",
            "Neoplasms by Site",
            "Neoplasms",
            "Nervous System Diseases",
        ],
    )
    assert risk_fields(gbm).categories == ("Neoplasms", "Nervous System Diseases")
