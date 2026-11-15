"""scripts/build_aact_panel.py: reuse of already-extracted raw tables."""

from __future__ import annotations

import importlib.util
from datetime import date
from pathlib import Path
from typing import Any

import httpx

from trialradar.aact.archive import Archive

_SPEC = importlib.util.spec_from_file_location(
    "build_aact_panel", Path(__file__).resolve().parents[2] / "scripts" / "build_aact_panel.py"
)
assert _SPEC and _SPEC.loader
script = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(script)

ARCH = Archive(1, date(2026, 1, 1), 1)


def _fake_extract(calls: list[str]) -> Any:
    def extract(arch: Archive, table: str, dest: Path, api_key: str, **_: Any) -> Path:
        calls.append(table)
        out = dest / f"{table}.txt"
        out.write_text("fresh")
        return out

    return extract


def test_complete_raw_table_is_reused(tmp_path: Path) -> None:
    (tmp_path / "studies.txt").write_text("old")
    calls: list[str] = []
    out = script.ensure_table(
        ARCH, "studies", tmp_path, "k", client=httpx.Client(), extract=_fake_extract(calls)
    )
    assert calls == [] and out == tmp_path / "studies.txt" and out.read_text() == "old"


def test_tmp_partial_is_not_reused(tmp_path: Path) -> None:
    (tmp_path / "studies.txt.tmp").write_text("partial")
    calls: list[str] = []
    out = script.ensure_table(
        ARCH, "studies", tmp_path, "k", client=httpx.Client(), extract=_fake_extract(calls)
    )
    assert calls == ["studies"] and out.read_text() == "fresh"


def test_missing_table_is_extracted(tmp_path: Path) -> None:
    calls: list[str] = []
    script.ensure_table(
        ARCH, "sponsors", tmp_path, "k", client=httpx.Client(), extract=_fake_extract(calls)
    )
    assert calls == ["sponsors"]
