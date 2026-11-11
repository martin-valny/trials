from trialradar.approvals.match import (
    LabelHit,
    Mech,
    indication_disease,
    label_hits,
    modality_group,
    widen,
)
from trialradar.config import ApprovalTerms

TERMS = {
    "MG": ApprovalTerms(mesh=["Myasthenia Gravis"], label_terms=["myasthenia gravis"]),
    "AE": ApprovalTerms(
        efo=[("Autoimmune Diseases of the Nervous System", "autoimmune encephalitis")]
    ),
    "NMOSD": ApprovalTerms(label_terms=["neuromyelitis optica spectrum disorder"]),
    "MS": ApprovalTerms(label_terms=["multiple sclerosis"]),
    "MOGAD": ApprovalTerms(label_terms=["MOGAD"]),
}


def test_modality_groups() -> None:
    assert modality_group("Antibody") == "Antibody"
    assert modality_group("Protein") == "Protein"
    assert modality_group("Small molecule") == "Small molecule"
    assert modality_group("Cell") == "cell therapy"
    assert modality_group("Gene") == "cell therapy"
    assert modality_group(None) == "unknown"
    assert modality_group("") == "unknown"
    assert modality_group("Oligonucleotide") == "Oligonucleotide"


def test_widen_pairs_not_cross_product() -> None:
    seeds = [
        Mech("S1", "T1", "INHIBITOR", "Antibody"),
        Mech("S2", "T1", "AGONIST", "Small molecule"),
    ]
    on_target = {
        "T1": [
            Mech("A", "T1", "INHIBITOR", "Antibody"),
            Mech("B", "T1", "AGONIST", "Small molecule"),
            Mech("C", "T1", "INHIBITOR", "Small molecule"),
            Mech("D", "T1", "AGONIST", "Antibody"),
        ]
    }
    assert widen(seeds, on_target) == {"S1", "S2", "A", "B"}


def test_widen_keeps_cell_therapy_apart() -> None:
    seeds = [Mech("CAR1", "CD19T", "BINDING AGENT", "cell therapy")]
    on_target = {"CD19T": [Mech("INEB", "CD19T", "BINDING AGENT", "Antibody")]}
    assert widen(seeds, on_target) == {"CAR1"}


def test_indication_disease() -> None:
    assert indication_disease("Myasthenia Gravis", None, TERMS) == "MG"
    lems = "Lambert-Eaton Myasthenic Syndrome"
    assert indication_disease(lems, "Myasthenia gravis", TERMS) is None
    ae_mesh = "Autoimmune Diseases of the Nervous System"
    assert indication_disease(ae_mesh, "Autoimmune Encephalitis", TERMS) == "AE"
    assert indication_disease("Encephalitis, Japanese", "Japanese encephalitis", TERMS) is None
    assert indication_disease(ae_mesh, "multiple sclerosis", TERMS) is None
    assert indication_disease(None, None, TERMS) is None


def test_indication_mesh_without_match_ignores_efo_case() -> None:
    # Unlisted MeSH carrying another disease's EFO term must not match.
    assert (
        indication_disease(
            "Lambert-Eaton Myasthenic Syndrome", "Myasthenia gravis", {"MG": TERMS["MG"]}
        )
        is None
    )


def test_label_hits() -> None:
    text = (
        "Soliris is indicated for the treatment of generalized myasthenia gravis (gMG) in adult "
        "patients who are anti-AChR antibody positive. It is also indicated for neuromyelitis "
        "optica spectrum disorder (NMOSD) in adults."
    )
    hits = label_hits(text, TERMS)
    assert {h.disease for h in hits} == {"MG", "NMOSD"}
    assert all(not h.negated for h in hits)
    assert all(len(h.sentence) <= 300 for h in hits)


def test_label_hits_flags_negation() -> None:
    hits = label_hits(
        "Limitations of Use: Not indicated for the treatment of multiple sclerosis.", TERMS
    )
    assert hits == [
        LabelHit(
            "MS",
            "Limitations of Use: Not indicated for the treatment of multiple sclerosis.",
            True,
        )
    ]


def test_label_hits_negation_from_previous_sentence() -> None:
    hits = label_hits("Limitations of Use. Multiple sclerosis was not studied.", TERMS)
    assert [(h.disease, h.negated) for h in hits] == [("MS", True)]


def test_label_hits_whole_phrase() -> None:
    assert label_hits("MOGADISHU", TERMS) == []
    assert [h.disease for h in label_hits("Indicated for MOGAD.", TERMS)] == ["MOGAD"]
