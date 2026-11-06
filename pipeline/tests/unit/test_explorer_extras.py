from __future__ import annotations

import pytest
from conftest import make_study

from trialradar.config import AreaConfig
from trialradar.explorer.extras import StudyExtras, extract_extras, parse_age_years


def _extras(studies: list[dict], cfg: AreaConfig) -> dict[str, StudyExtras]:  # type: ignore[type-arg]
    extras, warnings = extract_extras(studies, cfg)
    assert warnings == []
    return extras


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("18 Years", 18.0),
        ("6 Months", 0.5),
        ("3 Weeks", 3 / 52),
        ("N/A", None),
        (None, None),
        (18, None),
        (["18 Years"], None),
        ({"value": 18}, None),
    ],
)
def test_parse_age_years(text: object, expected: float | None) -> None:
    assert parse_age_years(text) == (None if expected is None else pytest.approx(expected))


def test_experimental_arm_drugs_only(cfg: AreaConfig) -> None:
    study = make_study(
        **{
            "armsInterventionsModule.armGroups": [
                {"label": "a", "type": "EXPERIMENTAL", "interventionNames": ["Drug: A"]},
                {"label": "b", "type": "ACTIVE_COMPARATOR", "interventionNames": ["Drug: B"]},
            ]
        }
    )
    assert _extras([study], cfg)["NCT00000001"].experimental_drugs == ("A",)


def test_fallback_to_interventions_when_no_arms(cfg: AreaConfig) -> None:
    study = make_study(
        **{
            "armsInterventionsModule.interventions": [
                {"type": "DRUG", "name": "A"},
                {"type": "DEVICE", "name": "D"},
            ]
        }
    )
    assert _extras([study], cfg)["NCT00000001"].experimental_drugs == ("A",)


def test_summary_sex_results(cfg: AreaConfig) -> None:
    study = make_study(
        has_results=True,
        mesh_terms=["Multiple Sclerosis"],
        **{
            "descriptionModule.briefSummary": "Sum.",
            "eligibilityModule": {"sex": "FEMALE", "minimumAge": "18 Years"},
        },
    )
    e = _extras([study], cfg)["NCT00000001"]
    assert (e.brief_summary, e.sex, e.min_age_years, e.max_age_years) == (
        "Sum.",
        "FEMALE",
        18.0,
        None,
    )
    assert e.has_results is True
    assert e.mesh_terms == ("Multiple Sclerosis",)
    bare = _extras([make_study("NCT00000002")], cfg)["NCT00000002"]
    assert bare.sex is None
    assert bare.has_results is False


def test_experimental_arm_without_drug_does_not_fall_back(cfg: AreaConfig) -> None:
    study = make_study(
        **{
            "armsInterventionsModule.armGroups": [
                {"label": "a", "type": "EXPERIMENTAL", "interventionNames": ["Device: D"]},
                {"label": "b", "type": "ACTIVE_COMPARATOR", "interventionNames": ["Drug: B"]},
            ],
            "armsInterventionsModule.interventions": [
                {"type": "DRUG", "name": "B"},
                {"type": "DEVICE", "name": "D"},
            ],
        }
    )
    assert _extras([study], cfg)["NCT00000001"].experimental_drugs == ()


def test_non_dict_arm_intervention_and_mesh_entries_are_skipped(cfg: AreaConfig) -> None:
    study = make_study(
        **{
            "armsInterventionsModule.armGroups": [
                "junk",
                None,
                {"label": "a", "type": "EXPERIMENTAL", "interventionNames": ["Drug: A"]},
            ],
        }
    )
    study["derivedSection"] = {
        "conditionBrowseModule": {"meshes": ["junk", 7, {"term": "Multiple Sclerosis"}]}
    }
    e = _extras([study], cfg)["NCT00000001"]
    assert e.experimental_drugs == ("A",)
    assert e.mesh_terms == ("Multiple Sclerosis",)
    fallback = make_study(
        "NCT00000002",
        **{"armsInterventionsModule.interventions": [None, "x", {"type": "DRUG", "name": "B"}]},
    )
    assert _extras([fallback], cfg)["NCT00000002"].experimental_drugs == ("B",)


def test_non_string_ages_are_none(cfg: AreaConfig) -> None:
    study = make_study(eligibilityModule={"minimumAge": 18, "maximumAge": ["65 Years"]})
    e = _extras([study], cfg)["NCT00000001"]
    assert (e.min_age_years, e.max_age_years) == (None, None)


@pytest.mark.parametrize(
    "override",
    [
        {"eligibilityModule": ["not", "a", "dict"]},
        {"descriptionModule": "text"},
        {"armsInterventionsModule": 5},
        {"armsInterventionsModule.armGroups": [{"type": "EXPERIMENTAL", "interventionNames": 3}]},
    ],
)
def test_malformed_study_falls_back_with_a_warning(
    cfg: AreaConfig, override: dict[str, object]
) -> None:
    bad = make_study("NCT00000001", **override)
    good = make_study("NCT00000002", **{"descriptionModule.briefSummary": "Fine."})
    extras, warnings = extract_extras([bad, good], cfg)
    assert extras["NCT00000001"] == StudyExtras(
        "NCT00000001", None, None, None, None, False, (), (), ()
    )
    assert extras["NCT00000002"].brief_summary == "Fine."
    assert len(warnings) == 1 and warnings[0].startswith("extras_fallback: NCT00000001: ")


def test_malformed_derived_section_falls_back(cfg: AreaConfig) -> None:
    bad = make_study()
    bad["derivedSection"] = {"conditionBrowseModule": "oops"}
    extras, warnings = extract_extras([bad], cfg)
    assert extras["NCT00000001"].mesh_terms == ()
    assert len(warnings) == 1
