from __future__ import annotations

import pytest
from conftest import make_study

from trialradar.config import AreaConfig
from trialradar.explorer.extras import extract_extras, parse_age_years


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("18 Years", 18.0),
        ("6 Months", 0.5),
        ("3 Weeks", 3 / 52),
        ("N/A", None),
        (None, None),
    ],
)
def test_parse_age_years(text: str | None, expected: float | None) -> None:
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
    assert extract_extras([study], cfg)["NCT00000001"].experimental_drugs == ("A",)


def test_fallback_to_interventions_when_no_arms(cfg: AreaConfig) -> None:
    study = make_study(
        **{
            "armsInterventionsModule.interventions": [
                {"type": "DRUG", "name": "A"},
                {"type": "DEVICE", "name": "D"},
            ]
        }
    )
    assert extract_extras([study], cfg)["NCT00000001"].experimental_drugs == ("A",)


def test_summary_sex_results(cfg: AreaConfig) -> None:
    study = make_study(
        has_results=True,
        mesh_terms=["Multiple Sclerosis"],
        **{
            "descriptionModule.briefSummary": "Sum.",
            "eligibilityModule": {"sex": "FEMALE", "minimumAge": "18 Years"},
        },
    )
    e = extract_extras([study], cfg)["NCT00000001"]
    assert (e.brief_summary, e.sex, e.min_age_years, e.max_age_years) == (
        "Sum.",
        "FEMALE",
        18.0,
        None,
    )
    assert e.has_results is True
    assert e.mesh_terms == ("Multiple Sclerosis",)
    bare = extract_extras([make_study("NCT00000002")], cfg)["NCT00000002"]
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
    assert extract_extras([study], cfg)["NCT00000001"].experimental_drugs == ()
