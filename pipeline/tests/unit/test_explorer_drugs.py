from __future__ import annotations

import pytest

from trialradar.explorer.drugs import clean_drug_name

EXCLUDE = ["placebo", "sham", "saline"]


@pytest.mark.parametrize(
    ("name", "aliases", "expected"),
    [
        ("Fingolimod hydrochloride 0.5 mg oral", {}, "fingolimod"),
        ("Placebo", {}, None),
        ("Ocrevus", {"ocrevus": "ocrelizumab"}, "ocrelizumab"),
        ("Rituximab (MabThera) 1000 mg IV", {}, "rituximab"),
        ("", {}, None),
    ],
)
def test_clean_drug_name(name: str, aliases: dict[str, str], expected: str | None) -> None:
    assert clean_drug_name(name, aliases, EXCLUDE) == expected
