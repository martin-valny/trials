"""A new therapeutic area is a config change only (spec section 11)."""

from __future__ import annotations

import json
import shutil
from datetime import date
from pathlib import Path

import yaml
from conftest import REPO_ROOT, make_study

from trialradar.config import load_config
from trialradar.ctgov.query import build_params

from .conftest import Env, FakeClient

AREA_WORDS = ("sclerosis", "neuroimmun", "myasthenia", "neuromyelitis", "encephalitis", "cidp")
SOURCE_ROOTS = (REPO_ROOT / "pipeline" / "src", REPO_ROOT / "web" / "src")
SOURCE_SUFFIXES = {".py", ".ts", ".tsx", ".css", ".html"}


def psoriasis_config(tmp: Path) -> Path:
    raw = yaml.safe_load((REPO_ROOT / "config" / "area.yaml").read_text(encoding="utf-8"))
    raw["name"] = "dermatology"
    raw["conditions"] = [{"label": "Psoriasis", "synonyms": ["psoriasis"]}]
    cfg_dir = tmp / "config"
    cfg_dir.mkdir()
    shutil.copytree(REPO_ROOT / "config" / "aliases", cfg_dir / "aliases")
    path = cfg_dir / "area.yaml"
    path.write_text(yaml.safe_dump(raw), encoding="utf-8")
    return path


def test_query_uses_only_the_configured_conditions(tmp_path: Path) -> None:
    cfg = load_config(psoriasis_config(tmp_path))
    params = " ".join(build_params(cfg).values()).lower()
    assert "psoriasis" in params
    assert not any(w in params for w in AREA_WORDS)


def test_full_run_for_another_area(tmp_path: Path) -> None:
    cfg = load_config(psoriasis_config(tmp_path))
    (tmp_path / "env").mkdir()
    env = Env(tmp_path / "env", cfg)
    studies = [
        make_study(f"NCT9100000{i}", **{"conditionsModule.conditions": ["Plaque Psoriasis"]})
        for i in range(1, 4)
    ] + [make_study("NCT91000099", **{"conditionsModule.conditions": ["Multiple Sclerosis"]})]

    result = env.run(FakeClient("2026-11-01T10:00:00", studies), date(2026, 11, 1))

    assert result.status == "success", result
    trials = sorted(p.stem for p in (env.site_dir / "trials").glob("*.json"))
    assert trials == ["NCT91000001", "NCT91000002", "NCT91000003"]  # the MS study is off-topic
    meta = json.loads((env.site_dir / "meta.json").read_text(encoding="utf-8"))
    assert meta["area"] == "dermatology"
    assert meta["conditions"] == ["Psoriasis"]


def test_no_source_file_names_an_area() -> None:
    offenders: list[str] = []
    for root in SOURCE_ROOTS:
        for path in sorted(root.rglob("*")):
            if path.is_file() and path.suffix in SOURCE_SUFFIXES:
                text = path.read_text(encoding="utf-8").lower()
                offenders += [
                    f"{path.relative_to(REPO_ROOT)}: {w}" for w in AREA_WORDS if w in text
                ]
    assert offenders == []
