from pathlib import Path
from typing import Any

import pytest
import yaml

from trialradar.config import TRACKED_FIELDS, AreaConfig, ConfigError, Thresholds, load_config

REPO_YAML = Path(__file__).resolve().parents[3] / "config" / "area.yaml"


def test_repo_config_loads(cfg: AreaConfig) -> None:
    assert cfg.name == "neuroimmunology"
    assert len(cfg.conditions) == 6
    assert set(cfg.phases) == {"EARLY_PHASE1", "PHASE1", "PHASE2", "PHASE3", "PHASE4", "NA"}
    assert cfg.thresholds.enrollment_rel_change == 0.20
    assert cfg.thresholds.date_slip_days == 90
    assert cfg.thresholds.row_drop_warn == 0.10
    assert cfg.thresholds.row_drop_error == 0.25
    assert cfg.thresholds.min_relevant_share == 0.5
    assert cfg.aliases_dir.is_dir()
    assert tuple(cfg.tracked_fields) == TRACKED_FIELDS


@pytest.mark.parametrize(
    "patch",
    [
        {"phases": []},
        {"phases": ["PHASE5"]},
        {"study_type": "OBSERVATIONAL"},
        {"tracked_fields": ["not_a_field"]},
        {"surprise": 1},
    ],
)
def test_invalid_config_rejected(tmp_path: Path, patch: dict[str, Any]) -> None:
    data = yaml.safe_load(REPO_YAML.read_text())
    data.update(patch)
    path = tmp_path / "area.yaml"
    path.write_text(yaml.safe_dump(data))
    with pytest.raises(ConfigError):
        load_config(path)


def test_threshold_defaults() -> None:
    t = Thresholds()
    assert (t.row_drop_warn, t.row_drop_error, t.min_relevant_share) == (0.10, 0.25, 0.5)


def test_bare_abbreviations_removed(cfg: AreaConfig) -> None:
    synonyms = {s for spec in cfg.conditions for s in spec.synonyms}
    assert not synonyms & {"MS", "MG", "Devic"}
    assert {"NMOSD", "MOGAD", "CIDP", "multiple sclerosis"} <= synonyms


@pytest.mark.parametrize(
    "thresholds",
    [
        {"row_drop_warn": 0.30, "row_drop_error": 0.25},
        {"row_drop_warn": 0.0},
        {"row_drop_error": 1.5},
        {"row_drop_warn": 0.10, "row_drop_error": 0.10, "min_relevant_share": -0.1},
        {"min_relevant_share": 1.1},
    ],
)
def test_invalid_thresholds_rejected(tmp_path: Path, thresholds: dict[str, Any]) -> None:
    data = yaml.safe_load(REPO_YAML.read_text())
    data["thresholds"].update(thresholds)
    path = tmp_path / "area.yaml"
    path.write_text(yaml.safe_dump(data))
    with pytest.raises(ConfigError):
        load_config(path)


def test_equal_warn_and_error_allowed(tmp_path: Path) -> None:
    data = yaml.safe_load(REPO_YAML.read_text())
    data["thresholds"].update({"row_drop_warn": 0.2, "row_drop_error": 0.2})
    path = tmp_path / "area.yaml"
    path.write_text(yaml.safe_dump(data))
    assert load_config(path).thresholds.row_drop_error == 0.2


def test_condition_requires_synonym(tmp_path: Path) -> None:
    data = yaml.safe_load(REPO_YAML.read_text())
    data["conditions"][0]["synonyms"] = []
    path = tmp_path / "area.yaml"
    path.write_text(yaml.safe_dump(data))
    with pytest.raises(ConfigError):
        load_config(path)
