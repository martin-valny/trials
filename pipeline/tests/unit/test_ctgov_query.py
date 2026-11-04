"""Tests for the ClinicalTrials.gov query builder."""

from __future__ import annotations

from trialradar.config import AreaConfig
from trialradar.ctgov.query import build_params


def test_build_params_uses_config_only(cfg: AreaConfig) -> None:
    params = build_params(cfg)
    for spec in cfg.conditions:
        for synonym in spec.synonyms:
            assert (f'"{synonym}"' if " " in synonym else synonym) in params["query.cond"]
    assert " OR " in params["query.cond"]
    assert "AREA[StudyType]INTERVENTIONAL" in params["filter.advanced"]
    for phase in cfg.phases:
        assert f"AREA[Phase]{phase}" in params["filter.advanced"]
    assert params["pageSize"] == "1000"
    assert params["format"] == "json"
