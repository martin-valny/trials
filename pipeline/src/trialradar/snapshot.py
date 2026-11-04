"""Raw snapshot files: one gzipped JSONL file per day, one study per line."""

from __future__ import annotations

import contextlib
import gzip
import io
import json
import os
import re
import shutil
import tempfile
from collections.abc import Iterable
from datetime import date
from pathlib import Path
from typing import Any

_NAME_RE = re.compile(r"([0-9]{4})-([0-9]{2})-([0-9]{2})\.jsonl\.gz")
STAGING_DIR = ".incoming"
"""Subdirectory of the raw dir holding a snapshot until its run has stored it."""


def write_snapshot(raw_dir: Path, day: date, studies: Iterable[dict[str, Any]]) -> Path:
    """Write ``raw_dir/YYYY-MM-DD.jsonl.gz`` atomically and deterministically."""
    raw_dir.mkdir(parents=True, exist_ok=True)
    target = raw_dir / f"{day.isoformat()}.jsonl.gz"
    fd, tmp_name = tempfile.mkstemp(dir=raw_dir, prefix=f".{target.name}.", suffix=".tmp")
    tmp = Path(tmp_name)
    try:
        with os.fdopen(fd, "wb") as raw:
            with (
                gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as gz,
                io.TextIOWrapper(gz, encoding="utf-8", newline="\n") as text,
            ):
                for study in studies:
                    text.write(json.dumps(study, ensure_ascii=False, separators=(",", ":")))
                    text.write("\n")
            raw.flush()
            os.fsync(raw.fileno())
        os.replace(tmp, target)
    except BaseException:
        with contextlib.suppress(FileNotFoundError):
            tmp.unlink()
        raise
    _fsync_dir(raw_dir)
    return target


def _fsync_dir(directory: Path) -> None:
    """Best-effort fsync of a directory so the rename is durable."""
    try:
        dir_fd = os.open(directory, os.O_RDONLY)
    except OSError:
        return
    try:
        os.fsync(dir_fd)
    except OSError:
        pass
    finally:
        os.close(dir_fd)


def read_snapshot(path: Path) -> list[dict[str, Any]]:
    with gzip.open(path, "rt", encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def list_snapshots(raw_dir: Path) -> list[tuple[date, Path]]:
    """Snapshots sorted by date; non-matching names ignored; missing dir yields ``[]``."""
    found: list[tuple[date, Path]] = []
    if not raw_dir.is_dir():
        return found
    for path in raw_dir.iterdir():
        m = _NAME_RE.fullmatch(path.name)
        if not m or not path.is_file():
            continue
        try:
            day = date(int(m[1]), int(m[2]), int(m[3]))
        except ValueError:
            continue
        found.append((day, path))
    found.sort(key=lambda item: item[0])
    return found


def write_text_atomic(text: str, path: Path) -> None:
    """Write ``path`` atomically (temp file in the same dir, fsync, rename)."""
    fd, tmp_name = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    tmp = Path(tmp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        with contextlib.suppress(FileNotFoundError):
            tmp.unlink()
        raise


# ----- staging: a day's snapshot and its ``.meta.json`` sidecar -----


def _pair(directory: Path, day: date, suffix: str = "") -> tuple[Path, Path]:
    stem = day.isoformat() + suffix
    return directory / f"{stem}.jsonl.gz", directory / f"{stem}.meta.json"


def stage_snapshot(
    raw_dir: Path, day: date, studies: Iterable[dict[str, Any]], meta: dict[str, Any]
) -> Path:
    """Write the snapshot and sidecar into ``raw_dir/.incoming/`` (cleared first).

    Staged files are invisible to ``list_snapshots`` until promoted."""
    staging = raw_dir / STAGING_DIR
    shutil.rmtree(staging, ignore_errors=True)  # leftovers of an earlier failed/crashed run
    path = write_snapshot(staging, day, studies)
    write_text_atomic(json.dumps(meta, sort_keys=True) + "\n", _pair(staging, day)[1])
    return path


def _move_staged(raw_dir: Path, day: date, suffix: str) -> None:
    # Snapshot first, sidecar second: a crash in between leaves at worst a new
    # snapshot beside the previous sidecar, never a new sidecar describing an old
    # snapshot, and a sidecar alone is ignored by ``list_snapshots``.
    src_snap, src_meta = _pair(raw_dir / STAGING_DIR, day)
    dst_snap, dst_meta = _pair(raw_dir, day, suffix)
    if src_snap.exists():
        os.replace(src_snap, dst_snap)
    if src_meta.exists():
        os.replace(src_meta, dst_meta)
    _fsync_dir(raw_dir)


def promote_staged(raw_dir: Path, day: date) -> None:
    """Move the staged pair to ``raw_dir/YYYY-MM-DD.{jsonl.gz,meta.json}``."""
    _move_staged(raw_dir, day, "")


def quarantine_staged(raw_dir: Path, day: date) -> None:
    """Move the staged pair to ``YYYY-MM-DD.failed.*`` (never listed or replayed)."""
    _move_staged(raw_dir, day, ".failed")


def read_sidecar(snapshot: Path) -> dict[str, Any]:
    """The ``.meta.json`` next to ``snapshot``; ``{}`` if missing or unreadable."""
    path = snapshot.with_name(snapshot.name.removesuffix(".jsonl.gz") + ".meta.json")
    try:
        meta = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return meta if isinstance(meta, dict) else {}
