from pathlib import Path

import pytest

from diligence.config import load_config


def test_load_config_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    for var in ("DILIGENCE_CONFIG", "SITE_BASE_URL", "ALLOWED_ORIGIN"):
        monkeypatch.delenv(var, raising=False)
    cfg = load_config()
    assert cfg.region == "eu-central-1"
    assert cfg.limits.max_tool_calls == 12
    assert cfg.limits.max_input_tokens == 60000
    assert cfg.limits.max_output_tokens == 4000
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
