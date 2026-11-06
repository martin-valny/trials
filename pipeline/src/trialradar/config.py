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

    @field_validator("label")
    @classmethod
    def _label_not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("condition label must not be blank")
        return value

    @field_validator("synonyms")
    @classmethod
    def _synonyms_not_blank(cls, value: list[str]) -> list[str]:
        if any(not s.strip() for s in value):
            raise ValueError("synonyms must not be empty or whitespace-only")
        return value


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
        if self.enrollment_rel_change <= 0:
            raise ValueError("enrollment_rel_change must be > 0")
        if self.date_slip_days < 1:
            raise ValueError("date_slip_days must be >= 1")
        if not 0 <= self.max_null_rate <= 1:
            raise ValueError("max_null_rate must be within [0, 1]")
        return self


class ExplorerConfig(_Strict):
    weights: dict[Literal["disease", "treatment_type", "molecule", "population"], float] = Field(
        default_factory=dict, validate_default=True
    )
    exclude_terms: list[str] = []
    n_neighbors: int = 15
    min_dist: float = 0.1
    seed: int = 42
    k: int = 10
    permutations: int = 10_000
    min_successes: int = 30
    min_group: int = 10

    @field_validator("min_group")
    @classmethod
    def _min_group_positive(cls, value: int) -> int:
        if value < 1:
            raise ValueError("min_group must be >= 1")
        return value

    @field_validator("weights")
    @classmethod
    def _fill_weights(
        cls, value: dict[Literal["disease", "treatment_type", "molecule", "population"], float]
    ) -> dict[Literal["disease", "treatment_type", "molecule", "population"], float]:
        if any(w < 0 for w in value.values()):
            raise ValueError("explorer weights must be >= 0")
        filled: dict[Literal["disease", "treatment_type", "molecule", "population"], float] = {
            "disease": 1.0,
            "treatment_type": 1.0,
            "molecule": 1.0,
            "population": 1.0,
        }
        filled.update(value)
        return filled


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
    mechanisms_dir: Path = Path("mechanisms")
    explorer: ExplorerConfig = ExplorerConfig()

    @field_validator("tracked_fields")
    @classmethod
    def _known_fields(cls, value: list[str]) -> list[str]:
        if not value:
            raise ValueError("tracked_fields must not be empty")
        if len(set(value)) != len(value):
            raise ValueError("tracked_fields must not contain duplicates")
        unknown = [f for f in value if f not in TRACKED_FIELDS]
        if unknown:
            raise ValueError(f"unknown tracked_fields: {unknown}")
        return value


def load_config(path: Path) -> AreaConfig:
    """Load and validate a config YAML; ``aliases_dir`` and ``mechanisms_dir`` resolve relative to the file."""
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
    return cfg.model_copy(
        update={
            "aliases_dir": (path.parent / cfg.aliases_dir).resolve(),
            "mechanisms_dir": (path.parent / cfg.mechanisms_dir).resolve(),
        }
    )
