from pathlib import Path

import pytest
import yaml
from pydantic import ValidationError

from diligence.config import DEFAULT_PATH, load_config


def test_load_config_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    for var in ("DILIGENCE_CONFIG", "SITE_BASE_URL", "ALLOWED_ORIGIN"):
        monkeypatch.delenv(var, raising=False)
    cfg = load_config()
    assert cfg.region == "eu-central-1"
    assert cfg.limits.max_tool_calls == 12
    assert cfg.limits.max_input_tokens == 150000
    assert cfg.limits.max_output_tokens == 8000
    assert cfg.limits.max_seconds == 90
    assert cfg.daily.per_ip_runs_per_day == 3
    assert cfg.daily.global_runs_per_day == 30
    assert cfg.tables.runs == "diligence-runs"


def test_env_overrides_site_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SITE_BASE_URL", "http://localhost:9/data/")
    monkeypatch.setenv("ALLOWED_ORIGIN", "http://localhost:5173")
    cfg = load_config()
    assert cfg.site_base_url == "http://localhost:9/data/"
    assert cfg.allowed_origin == "http://localhost:5173"


def test_env_config_path(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    src = (Path(__file__).parent.parent / "config.yaml").read_text()
    p = tmp_path / "c.yaml"
    p.write_text(src.replace("0.1.0", "9.9.9"))
    monkeypatch.setenv("DILIGENCE_CONFIG", str(p))
    assert load_config().agent_version == "9.9.9"


def test_unknown_key_rejected(tmp_path: Path) -> None:
    src = (Path(__file__).parent.parent / "config.yaml").read_text()
    p = tmp_path / "c.yaml"
    p.write_text(src + "bogus: 1\n")
    with pytest.raises(ValueError):
        load_config(p)


def test_table_names_can_come_from_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RUNS_TABLE", "stack-runs")
    monkeypatch.setenv("LIMITS_TABLE", "stack-limits")
    monkeypatch.setenv("FLAGS_TABLE", "stack-flags")
    t = load_config().tables
    assert (t.runs, t.limits, t.flags) == ("stack-runs", "stack-limits", "stack-flags")


def test_every_model_id_needs_a_price(tmp_path: Path) -> None:
    """Minor 5: a missing price would silently show cost 0 on the page."""
    raw = yaml.safe_load(DEFAULT_PATH.read_text())
    raw["prices"].pop(raw["models"]["checker"])
    path = tmp_path / "c.yaml"
    path.write_text(yaml.safe_dump(raw))
    with pytest.raises(ValidationError, match="prices has no entry"):
        load_config(path)


def test_allowed_origins_is_a_comma_list(monkeypatch: pytest.MonkeyPatch) -> None:
    """R46: the function URL and the handler accept several origins."""
    monkeypatch.setenv("ALLOWED_ORIGIN", "https://martin-valny.github.io, http://localhost:4181")
    cfg = load_config()
    assert cfg.allowed_origins == {"https://martin-valny.github.io", "http://localhost:4181"}
