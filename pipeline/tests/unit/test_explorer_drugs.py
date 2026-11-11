from __future__ import annotations

import pytest

from trialradar.explorer.drugs import clean_drug_name

EXCLUDE = ["placebo", "sham", "saline", "sodium chloride", "normal saline"]


@pytest.mark.parametrize(
    ("name", "aliases", "expected"),
    [
        ("Fingolimod hydrochloride 0.5 mg oral", {}, "fingolimod"),
        ("Placebo", {}, None),
        ("Ocrevus", {"ocrevus": "ocrelizumab"}, "ocrelizumab"),
        ("Rituximab (MabThera) 1000 mg IV", {}, "rituximab"),
        ("", {}, None),
        ("Glatiramer Acetate 20 mg/ml", {}, "glatiramer"),
        ("Immunoglobulin 2 g/kg", {}, "immunoglobulin"),
        ("Cyclophosphamide 750 mg/m2", {}, "cyclophosphamide"),
        ("Dimethyl fumarate 240 mg", {}, "dimethyl fumarate"),
        ("Diroximel fumarate", {}, "diroximel fumarate"),
        ("Dimethyl sulfate", {}, "dimethyl"),
        ("BG-12", {"bg-12": "dimethyl fumarate"}, "dimethyl fumarate"),
        ("0.9% Sodium Chloride", {}, None),
    ],
)
def test_clean_drug_name(name: str, aliases: dict[str, str], expected: str | None) -> None:
    assert clean_drug_name(name, aliases, EXCLUDE) == expected
