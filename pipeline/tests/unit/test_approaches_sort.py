"""Sorting interventions into approaches and kinds (spec 2026-11-08 §6.2)."""

from __future__ import annotations

from pathlib import Path

import pytest

from trialradar.approaches.io import ApproachConfig, read_approaches
from trialradar.approaches.sort import (
    Intervention,
    Sorted,
    sort_intervention,
    trial_approaches,
)
from trialradar.mechanisms.io import DrugMapping, Status

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "approaches"


def _row(
    drug: str,
    status: Status = "mapped",
    cls: tuple[str, ...] = (),
    targets: tuple[str, ...] = (),
) -> DrugMapping:
    return DrugMapping(
        drug=drug,
        status=status,
        chembl_id=None,
        modality=None,
        mechanism_class=cls,
        mechanism=(),
        action_type=(),
        targets=targets,
    )


MAPPINGS: dict[str, DrugMapping] = {
    m.drug: m
    for m in (
        _row("ocrelizumab", cls=("anti-CD20",), targets=("MS4A1",)),
        _row("rituximab", cls=("anti-CD20",), targets=("MS4A1",)),
        _row("cladribine", status="manual", cls=("DNA inhibitor",)),
        _row("mesenchymal stem cells", status="manual", cls=("msc",)),
        _row("ivig", status="manual", cls=("immunoglobulin",)),
        _row("thymoglobulin cyclophosphamide", status="manual", cls=("DNA inhibitor", "atg")),
        _row("influenza vaccine", status="not_a_drug"),
        _row("mystery-101", status="unmapped"),
        _row("plasma exchange", status="manual"),
    )
}


@pytest.fixture(scope="module")
def cfg() -> ApproachConfig:
    return read_approaches(FIXTURES)


def test_molecular_row_is_targeted(cfg: ApproachConfig) -> None:
    got = sort_intervention(Intervention("BIOLOGICAL", "ocrelizumab"), MAPPINGS, cfg)
    assert got == Sorted(("anti-CD20",), (), False)


def test_molecular_without_targets_is_targeted(cfg: ApproachConfig) -> None:
    got = sort_intervention(Intervention("DRUG", "cladribine"), MAPPINGS, cfg)
    assert got == Sorted(("DNA inhibitor",), (), False)


def test_kind_row_goes_to_kind(cfg: ApproachConfig) -> None:
    got = sort_intervention(Intervention("BIOLOGICAL", "mesenchymal stem cells"), MAPPINGS, cfg)
    assert got.kinds == ("msc",)
    assert got.molecular == ()
    assert not got.unsorted


def test_split_class_goes_to_both(cfg: ApproachConfig) -> None:
    got = sort_intervention(Intervention("DRUG", "thymoglobulin cyclophosphamide"), MAPPINGS, cfg)
    assert got == Sorted(("DNA inhibitor",), ("atg",), False)


def test_not_a_drug_is_not_a_treatment(cfg: ApproachConfig) -> None:
    got = sort_intervention(Intervention("BIOLOGICAL", "influenza vaccine"), MAPPINGS, cfg)
    assert got == Sorted((), ("not_a_treatment",), False)


def test_keyword_sorts_unmapped_biological(cfg: ApproachConfig) -> None:
    iv = Intervention("BIOLOGICAL", "autologous hematopoietic stem cell transplantation")
    assert sort_intervention(iv, MAPPINGS, cfg) == Sorted((), ("ahsct",), False)


def test_keyword_sorts_unmapped_row(cfg: ApproachConfig) -> None:
    iv = Intervention("DRUG", "mystery-101", "Given with plasma exchange. Then more.")
    assert sort_intervention(iv, MAPPINGS, cfg).kinds == ("plasma_exchange",)


def test_resolved_row_without_class_falls_to_keyword(cfg: ApproachConfig) -> None:
    got = sort_intervention(Intervention("PROCEDURE", "plasma exchange"), MAPPINGS, cfg)
    assert got == Sorted((), ("plasma_exchange",), False)


def test_keyword_whole_word_only(cfg: ApproachConfig) -> None:
    got = sort_intervention(Intervention("DEVICE", "tmsx stimulator"), MAPPINGS, cfg)
    assert got.kinds == ("type:DEVICE",)
    got = sort_intervention(Intervention("DEVICE", "rtms (tms)"), MAPPINGS, cfg)
    assert got.kinds == ("tms",)


def test_keyword_is_casefolded(cfg: ApproachConfig) -> None:
    got = sort_intervention(Intervention("BEHAVIORAL", "Aerobic Training"), MAPPINGS, cfg)
    assert got.kinds == ("exercise",)


def test_keyword_in_description_first_sentence(cfg: ApproachConfig) -> None:
    first = Intervention("BEHAVIORAL", "programme a", "Supervised exercise. Weekly calls.")
    assert sort_intervention(first, MAPPINGS, cfg).kinds == ("exercise",)
    later = Intervention("BEHAVIORAL", "programme b", "Weekly calls. Supervised exercise.")
    assert sort_intervention(later, MAPPINGS, cfg).kinds == ("type:BEHAVIORAL",)
    newline = Intervention("BEHAVIORAL", "programme c", "Weekly calls.\nSupervised exercise.")
    assert sort_intervention(newline, MAPPINGS, cfg).kinds == ("type:BEHAVIORAL",)
    decimal = Intervention("BEHAVIORAL", "programme d", "Dose 2.5 then exercise. Calls.")
    assert sort_intervention(decimal, MAPPINGS, cfg).kinds == ("exercise",)


def test_keyword_respects_types(cfg: ApproachConfig) -> None:
    device = Intervention("DEVICE", "transcranial magnetic stimulation")
    assert sort_intervention(device, MAPPINGS, cfg).kinds == ("tms",)
    behav = Intervention("BEHAVIORAL", "transcranial magnetic stimulation")
    assert sort_intervention(behav, MAPPINGS, cfg).kinds == ("type:BEHAVIORAL",)


def test_several_rules_add_every_kind(cfg: ApproachConfig) -> None:
    iv = Intervention("PROCEDURE", "plasma exchange then ahsct")
    assert sort_intervention(iv, MAPPINGS, cfg).kinds == ("ahsct", "plasma_exchange")


def test_behavioral_falls_back_to_type(cfg: ApproachConfig) -> None:
    got = sort_intervention(Intervention("BEHAVIORAL", "group sessions"), MAPPINGS, cfg)
    assert got == Sorted((), ("type:BEHAVIORAL",), False)


def test_other_type_falls_to_not_yet_sorted(cfg: ApproachConfig) -> None:
    got = sort_intervention(Intervention("OTHER", "standard therapy"), MAPPINGS, cfg)
    assert got == Sorted((), ("type:OTHER",), True)


def test_unmapped_drug_is_not_yet_sorted(cfg: ApproachConfig) -> None:
    got = sort_intervention(Intervention("DRUG", "mystery-101"), MAPPINGS, cfg)
    assert got == Sorted((), ("type:DRUG",), True)


def test_diagnostic_test_is_sorted_as_not_a_treatment(cfg: ApproachConfig) -> None:
    got = sort_intervention(Intervention("DIAGNOSTIC_TEST", "mri"), MAPPINGS, cfg)
    assert got == Sorted((), ("type:DIAGNOSTIC_TEST",), False)


def test_unknown_type_uses_type_other(cfg: ApproachConfig) -> None:
    got = sort_intervention(Intervention("SOMETHING_NEW", "thing"), MAPPINGS, cfg)
    assert got == Sorted((), ("type:OTHER",), True)


def test_trial_targeted_only(cfg: ApproachConfig) -> None:
    got = trial_approaches([Intervention("BIOLOGICAL", "ocrelizumab")], MAPPINGS, cfg)
    assert got.approaches == ("targeted",)
    assert got.kinds == ()
    assert got.mechanisms == ("anti-CD20",)
    assert got.unsorted == ()


def test_trial_in_two_bubbles(cfg: ApproachConfig) -> None:
    ivs = [Intervention("BIOLOGICAL", "rituximab"), Intervention("BIOLOGICAL", "ivig")]
    got = trial_approaches(ivs, MAPPINGS, cfg)
    assert got.approaches == ("targeted", "plasma")
    assert got.kinds == ("immunoglobulin",)
    assert got.mechanisms == ("anti-CD20",)


def test_approaches_follow_vocabulary_order(cfg: ApproachConfig) -> None:
    ivs = [
        Intervention("BEHAVIORAL", "exercise"),
        Intervention("BIOLOGICAL", "mesenchymal stem cells"),
        Intervention("DRUG", "cladribine"),
        Intervention("BIOLOGICAL", "ocrelizumab"),
    ]
    got = trial_approaches(ivs, MAPPINGS, cfg)
    assert got.approaches == ("targeted", "cell", "nondrug")
    assert got.kinds == ("exercise", "msc")
    assert got.mechanisms == ("DNA inhibitor", "anti-CD20")


def test_mapped_and_unmapped_drug_is_targeted_with_name_listed(cfg: ApproachConfig) -> None:
    ivs = [Intervention("BIOLOGICAL", "ocrelizumab"), Intervention("DRUG", "mystery-101")]
    got = trial_approaches(ivs, MAPPINGS, cfg)
    assert got.approaches == ("targeted",)
    assert got.kinds == ()
    assert got.unsorted == ("mystery-101",)


def test_unclassified_only_when_nothing_else(cfg: ApproachConfig) -> None:
    ivs = [Intervention("OTHER", "standard therapy"), Intervention("BEHAVIORAL", "exercise")]
    got = trial_approaches(ivs, MAPPINGS, cfg)
    assert got.approaches == ("nondrug",)
    assert got.kinds == ("exercise",)
    assert got.unsorted == ("standard therapy",)


def test_only_not_a_drug_is_not_a_treatment(cfg: ApproachConfig) -> None:
    got = trial_approaches([Intervention("BIOLOGICAL", "influenza vaccine")], MAPPINGS, cfg)
    assert got.approaches == ("unclassified",)
    assert got.kinds == ("not_a_treatment",)
    assert got.mechanisms == ()
    assert got.unsorted == ()


def test_only_unsorted_names_are_unclassified(cfg: ApproachConfig) -> None:
    ivs = [Intervention("OTHER", "standard therapy"), Intervention("OTHER", "arm a")]
    got = trial_approaches(ivs, MAPPINGS, cfg)
    assert got.approaches == ("unclassified",)
    assert got.kinds == ("type:OTHER",)
    assert got.unsorted == ("arm a", "standard therapy")


def test_no_interventions_is_unclassified(cfg: ApproachConfig) -> None:
    got = trial_approaches([], MAPPINGS, cfg)
    assert got.approaches == ("unclassified",)
    assert got.kinds == ()
