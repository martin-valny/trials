"""Agent configuration: model IDs, limits, table names. Loaded from config.yaml."""

import os
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, ConfigDict, model_validator


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
    # Prompt-cache prices; unset means the input price is used for cached tokens too.
    cache_read_per_mtok: float | None = None
    cache_write_per_mtok: float | None = None
    # False for models whose Bedrock Converse API rejects cache points (e.g. Kimi, Qwen,
    # DeepSeek): requests to them are sent without any cachePoint block.
    prompt_cache: bool = True


# Model IDs in the committed config.yaml start with this until Martin enters real ones.
PLACEHOLDER = "REPLACE_WITH"


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

    @model_validator(mode="after")
    def _every_model_priced(self) -> "AgentConfig":
        missing = sorted({m for m in self.models.model_dump().values() if m not in self.prices})
        if missing:
            raise ValueError(f"prices has no entry for model id(s) {missing}")
        return self

    @property
    def allowed_origins(self) -> frozenset[str]:
        """`allowed_origin` may hold several origins, comma separated."""
        return frozenset(o.strip() for o in self.allowed_origin.split(",") if o.strip())

    def uncached_models(self) -> frozenset[str]:
        """Model IDs whose requests must carry no cache points."""
        return frozenset(m for m, p in self.prices.items() if not p.prompt_cache)

    def has_placeholder_models(self) -> bool:
        return any(PLACEHOLDER in m for m in self.models.model_dump().values())


DEFAULT_PATH = Path(__file__).resolve().parents[2] / "config.yaml"


def load_config(path: Path | None = None) -> AgentConfig:
    """Load config. Precedence for the file: argument, DILIGENCE_CONFIG, bundled config.yaml.

    SITE_BASE_URL, ALLOWED_ORIGIN and RUNS_TABLE/LIMITS_TABLE/FLAGS_TABLE override their fields.
    """
    if path is None:
        env_path = os.environ.get("DILIGENCE_CONFIG")
        path = Path(env_path) if env_path else DEFAULT_PATH
    raw: dict[str, Any] = yaml.safe_load(path.read_text())
    for env, key in (("SITE_BASE_URL", "site_base_url"), ("ALLOWED_ORIGIN", "allowed_origin")):
        if value := os.environ.get(env):
            raw[key] = value
    for env, key in (("RUNS_TABLE", "runs"), ("LIMITS_TABLE", "limits"), ("FLAGS_TABLE", "flags")):
        if value := os.environ.get(env):
            raw["tables"][key] = value
    return AgentConfig.model_validate(raw)
