"""Shared test fixtures and the make_study helper."""

from __future__ import annotations

import copy
from pathlib import Path
from typing import Any

import pytest

from trialradar.config import AreaConfig, load_config

REPO_ROOT = Path(__file__).resolve().parents[2]

DELETE: Any = object()
"""Sentinel: pass as an override value to remove that key from the study."""


def _base_study(nct_id: str) -> dict[str, Any]:
    return {
        "protocolSection": {
            "identificationModule": {"nctId": nct_id, "briefTitle": f"Study {nct_id}"},
            "statusModule": {
                "overallStatus": "RECRUITING",
                "startDateStruct": {"date": "2024-01", "type": "ACTUAL"},
                "primaryCompletionDateStruct": {"date": "2026-06", "type": "ESTIMATED"},
                "completionDateStruct": {"date": "2026-12", "type": "ESTIMATED"},
                "lastUpdatePostDateStruct": {"date": "2025-01-15"},
            },
            "designModule": {
                "studyType": "INTERVENTIONAL",
                "phases": ["PHASE2"],
                "enrollmentInfo": {"count": 100, "type": "ESTIMATED"},
                "designInfo": {"allocation": "RANDOMIZED", "maskingInfo": {"masking": "DOUBLE"}},
            },
            "sponsorCollaboratorsModule": {
                "leadSponsor": {"name": "Example Pharma", "class": "INDUSTRY"},
                "collaborators": [],
            },
            "conditionsModule": {"conditions": ["Multiple Sclerosis"]},
            "armsInterventionsModule": {
                "interventions": [{"type": "DRUG", "name": "Example Drug"}]
            },
            "outcomesModule": {
                "primaryOutcomes": [
                    {
                        "measure": "Annualized relapse rate",
                        "timeFrame": "48 weeks",
                        "description": "Number of relapses per year",
                    }
                ],
                "secondaryOutcomes": [
                    {
                        "measure": "Disability progression",
                        "timeFrame": "96 weeks",
                        "description": "EDSS change",
                    }
                ],
            },
            "contactsLocationsModule": {
                "locations": [
                    {
                        "facility": "Example Hospital",
                        "city": "Boston",
                        "country": "United States",
                        "status": "RECRUITING",
                    }
                ]
            },
        }
    }


def make_study(nct_id: str = "NCT00000001", **overrides: Any) -> dict[str, Any]:
    """Build a minimal valid API v2 study.

    Overrides are dotted paths relative to ``protocolSection``, e.g.
    ``make_study(**{"statusModule.overallStatus": "TERMINATED"})``. Pass ``DELETE``
    as the value to remove a key.
    """
    study = _base_study(nct_id)
    for path, value in overrides.items():
        *parents, leaf = path.split(".")
        node: Any = study["protocolSection"]
        for key in parents:
            node = node.setdefault(key, {})
        if value is DELETE:
            node.pop(leaf, None)
        else:
            node[leaf] = copy.deepcopy(value)
    return study


make_study.DELETE = DELETE  # type: ignore[attr-defined]


@pytest.fixture
def cfg() -> AreaConfig:
    return load_config(REPO_ROOT / "config" / "area.yaml")
