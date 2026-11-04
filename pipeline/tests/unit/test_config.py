from pathlib import Path
from typing import Any

import pytest
import yaml

from trialradar.config import TRACKED_FIELDS, AreaConfig, ConfigError, load_config

REPO_YAML = Path(__file__).resolve().parents[3] / "config" / "area.yaml"


def test_repo_config_loads(cfg: AreaConfig) -> None:
    assert cfg.name == "neuroimmunology"
    assert len(cfg.conditions) == 6
    assert set(cfg.phases) == {"EARLY_PHASE1", "PHASE1", "PHASE2", "PHASE3", "PHASE4", "NA"}
    assert cfg.thresholds.enrollment_rel_change == 0.20
    assert cfg.thresholds.date_slip_days == 90
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


def test_condition_requires_synonym(tmp_path: Path) -> None:
    data = yaml.safe_load(REPO_YAML.read_text())
    data["conditions"][0]["synonyms"] = []
    path = tmp_path / "area.yaml"
    path.write_text(yaml.safe_dump(data))
    with pytest.raises(ConfigError):
        load_config(path)
