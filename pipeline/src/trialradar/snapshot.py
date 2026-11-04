"""Raw snapshot files: one gzipped JSONL file per day, one study per line."""

from __future__ import annotations

import contextlib
import gzip
import io
import json
import os
import re
import tempfile
from collections.abc import Iterable
from datetime import date
from pathlib import Path
from typing import Any

_NAME_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})\.jsonl\.gz$")


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
    """Snapshots in ``raw_dir`` sorted by date; non-matching names are ignored."""
    found: list[tuple[date, Path]] = []
    for path in raw_dir.iterdir():
        m = _NAME_RE.match(path.name)
        if not m or not path.is_file():
            continue
        try:
            day = date(int(m[1]), int(m[2]), int(m[3]))
        except ValueError:
            continue
        found.append((day, path))
    found.sort(key=lambda item: item[0])
    return found
