"""Agent configuration: model IDs, limits, table names. Loaded from config.yaml."""

import os
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, ConfigDict


class _Strict(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid", frozen=True)


class Models(_Strict):
    writer: str
    planner: str
    checker: str


class Limits(_Strict):
    max_tool_calls: int
    max_input_tokens: int
    max_output_tokens: int
    max_seconds: int


class Daily(_Strict):
    per_ip_runs_per_day: int
    global_runs_per_day: int


class Tables(_Strict):
    runs: str
    limits: str
    flags: str


class Price(_Strict):
    input_per_mtok: float
    output_per_mtok: float


class AgentConfig(_Strict):
    region: str
    models: Models
    limits: Limits
    daily: Daily
    site_base_url: str
    tables: Tables
    agent_version: str
    allowed_origin: str
    prices: dict[str, Price]


DEFAULT_PATH = Path(__file__).resolve().parents[2] / "config.yaml"


def load_config(path: Path | None = None) -> AgentConfig:
    """Load config. Precedence for the file: argument, DILIGENCE_CONFIG, bundled config.yaml.

    SITE_BASE_URL and ALLOWED_ORIGIN environment variables override their fields.
    """
    if path is None:
        env_path = os.environ.get("DILIGENCE_CONFIG")
        path = Path(env_path) if env_path else DEFAULT_PATH
    raw: dict[str, Any] = yaml.safe_load(path.read_text())
    for env, key in (("SITE_BASE_URL", "site_base_url"), ("ALLOWED_ORIGIN", "allowed_origin")):
        if value := os.environ.get(env):
            raw[key] = value
    return AgentConfig.model_validate(raw)
