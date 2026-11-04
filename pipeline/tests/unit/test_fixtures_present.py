"""Validate the recorded ClinicalTrials.gov fixtures (needs `record-fixtures` to have run)."""

from __future__ import annotations

import json

import pytest
from conftest import REPO_ROOT
from test_record_predicates import rf

from trialradar.config import AreaConfig
from trialradar.relevance import is_relevant

pytestmark = pytest.mark.recorded

FIXTURES = REPO_ROOT / "pipeline" / "tests" / "fixtures"
STUDIES = FIXTURES / "studies"


@pytest.mark.parametrize("label", sorted(rf.PREDICATES))
def test_labelled_study(label: str) -> None:
    study = json.loads((STUDIES / f"{label}.json").read_text())
    assert study["protocolSection"]["identificationModule"]["nctId"]
    assert rf.PREDICATES[label](study)


def test_sample20() -> None:
    lines = [ln for ln in (STUDIES / "sample20.jsonl").read_text().splitlines() if ln.strip()]
    assert len(lines) == 20
    ids = {json.loads(ln)["protocolSection"]["identificationModule"]["nctId"] for ln in lines}
    assert len(ids) == 20


def test_version() -> None:
    assert json.loads((FIXTURES / "http" / "version.json").read_text())["dataTimestamp"]


@pytest.mark.recorded_fresh
def test_recorded_studies_are_in_area(cfg: AreaConfig) -> None:
    """Only valid once re-recorded with the relevance filter."""
    paths = [STUDIES / f"{label}.json" for label in sorted(rf.PREDICATES)]
    studies = [json.loads(p.read_text()) for p in paths]
    studies += [
        json.loads(ln) for ln in (STUDIES / "sample20.jsonl").read_text().splitlines() if ln.strip()
    ]
    off = [s for s in studies if not is_relevant(s, cfg)]
    assert off == []
