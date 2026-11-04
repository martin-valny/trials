"""Tracked-area configuration: loading and validation."""

from __future__ import annotations

from pathlib import Path
from typing import Literal

import yaml
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    ValidationError,
    field_validator,
    model_validator,
)

TRACKED_FIELDS: tuple[str, ...] = (
    "overall_status",
    "why_stopped",
    "phases",
    "enrollment",
    "enrollment_type",
    "start_date",
    "primary_completion_date",
    "completion_date",
    "primary_outcomes",
    "secondary_outcomes",
    "lead_sponsor",
    "interventions",
    "conditions",
    "site_countries",
    "site_count",
)


class ConfigError(ValueError):
    """Raised when the area configuration is missing or invalid."""


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ConditionSpec(_Strict):
    label: str
    synonyms: list[str] = Field(min_length=1)


class Thresholds(_Strict):
    enrollment_rel_change: float = 0.20
    date_slip_days: int = 90
    row_drop_warn: float = 0.10
    row_drop_error: float = 0.25
    min_relevant_share: float = 0.5
    max_null_rate: float = 0.0

    @model_validator(mode="after")
    def _ordered(self) -> Thresholds:
        if not 0 < self.row_drop_warn <= self.row_drop_error <= 1:
            raise ValueError("require 0 < row_drop_warn <= row_drop_error <= 1")
        if not 0 <= self.min_relevant_share <= 1:
            raise ValueError("min_relevant_share must be within [0, 1]")
        return self


class AreaConfig(_Strict):
    name: str
    conditions: list[ConditionSpec] = Field(min_length=1)
    study_type: Literal["INTERVENTIONAL"]
    phases: list[Literal["EARLY_PHASE1", "PHASE1", "PHASE2", "PHASE3", "PHASE4", "NA"]] = Field(
        min_length=1
    )
    tracked_fields: list[str]
    thresholds: Thresholds = Thresholds()
    aliases_dir: Path

    @field_validator("tracked_fields")
    @classmethod
    def _known_fields(cls, value: list[str]) -> list[str]:
        unknown = [f for f in value if f not in TRACKED_FIELDS]
        if unknown:
            raise ValueError(f"unknown tracked_fields: {unknown}")
        return value


def load_config(path: Path) -> AreaConfig:
    """Load and validate a config YAML; ``aliases_dir`` resolves relative to the file."""
    try:
        raw = yaml.safe_load(path.read_text())
    except (OSError, yaml.YAMLError) as exc:
        raise ConfigError(str(exc)) from exc
    if not isinstance(raw, dict):
        raise ConfigError(f"{path}: expected a mapping at top level")
    try:
        cfg = AreaConfig.model_validate(raw)
    except ValidationError as exc:
        raise ConfigError(str(exc)) from exc
    return cfg.model_copy(update={"aliases_dir": (path.parent / cfg.aliases_dir).resolve()})
