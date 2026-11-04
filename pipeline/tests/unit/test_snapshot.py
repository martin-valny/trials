"""Tests for raw gzipped JSONL snapshots."""

from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest
from conftest import make_study

from trialradar.snapshot import list_snapshots, read_snapshot, write_snapshot

DAY = date(2026, 11, 4)


def test_round_trip(tmp_path: Path) -> None:
    studies = [
        make_study("NCT00000001"),
        make_study("NCT00000002", **{"conditionsModule.conditions": ["Sclérose"]}),
    ]
    path = write_snapshot(tmp_path, DAY, studies)
    assert path == tmp_path / "2026-11-04.jsonl.gz"
    assert read_snapshot(path) == studies


def test_overwrite_replaces_content(tmp_path: Path) -> None:
    write_snapshot(tmp_path, DAY, [make_study("NCT00000001")])
    path = write_snapshot(tmp_path, DAY, [make_study("NCT00000002")])
    assert [s["protocolSection"]["identificationModule"]["nctId"] for s in read_snapshot(path)] == [
        "NCT00000002"
    ]
    assert [p.name for p in tmp_path.iterdir()] == ["2026-11-04.jsonl.gz"]


def test_file_is_gzip(tmp_path: Path) -> None:
    path = write_snapshot(tmp_path, DAY, [make_study()])
    assert path.read_bytes()[:2] == b"\x1f\x8b"


def test_deterministic_bytes(tmp_path: Path) -> None:
    a = write_snapshot(tmp_path / "a", DAY, [make_study()])
    b = write_snapshot(tmp_path / "b", DAY, [make_study()])
    assert a.read_bytes() == b.read_bytes()


def test_creates_missing_dir_and_empty_snapshot(tmp_path: Path) -> None:
    path = write_snapshot(tmp_path / "new" / "raw", DAY, [])
    assert read_snapshot(path) == []


def test_failed_write_leaves_no_partial_and_keeps_existing(tmp_path: Path) -> None:
    path = write_snapshot(tmp_path, DAY, [make_study("NCT00000001")])
    before = path.read_bytes()
    with pytest.raises(TypeError):
        write_snapshot(tmp_path, DAY, [make_study("NCT00000002"), {"bad": object()}])
    assert path.read_bytes() == before
    assert [p.name for p in tmp_path.iterdir()] == ["2026-11-04.jsonl.gz"]


def test_failed_first_write_leaves_nothing(tmp_path: Path) -> None:
    with pytest.raises(TypeError):
        write_snapshot(tmp_path, DAY, [{"bad": object()}])
    assert list(tmp_path.iterdir()) == []


def test_list_snapshots_filters_and_sorts(tmp_path: Path) -> None:
    for d in (date(2026, 11, 4), date(2026, 1, 2), date(2026, 3, 9)):
        write_snapshot(tmp_path, d, [])
    for junk in (
        "notes.txt",
        "2026-11-04.jsonl",
        "2026-11-04.jsonl.gz.tmp",
        "x2026-11-04.jsonl.gz",
        "2026-13-40.jsonl.gz",
        "2026-1-2.jsonl.gz",
    ):
        (tmp_path / junk).write_bytes(b"")
    (tmp_path / "2026-05-05.jsonl.gz").mkdir()
    result = list_snapshots(tmp_path)
    assert [d for d, _ in result] == [date(2026, 1, 2), date(2026, 3, 9), date(2026, 11, 4)]
    assert result[0][1] == tmp_path / "2026-01-02.jsonl.gz"
