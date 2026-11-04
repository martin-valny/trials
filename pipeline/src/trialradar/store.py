"""Parquet state store: current/previous state plus append-only history.

Layout under the store root::

    current/<table>.parquet   six Tables, plus current/state.json
    previous/                 same shape, the state before ``current``
    history/trial_change.parquet
    history/trial_snapshot.parquet
    history/run_log.parquet

Every file is written to a temp name, fsynced and renamed into place.  A new
state directory is built completely in a sibling temp directory and then
swapped in with directory renames, so a crash never exposes a ``current/``
whose tables and ``state.json`` disagree.  A directory missing any file (or
with an unreadable ``state.json``) is treated as absent.
"""

from __future__ import annotations

import contextlib
import json
import os
import shutil
import tempfile
from dataclasses import fields
from datetime import date
from pathlib import Path
from typing import Any

import polars as pl

from trialradar.diff import TRIAL_CHANGE_SCHEMA
from trialradar.snapshot import _fsync_dir
from trialradar.tables import SCHEMAS, Tables

SNAPSHOT_SCHEMA: dict[str, pl.DataType] = {
    "nct_id": pl.Utf8(),
    "snapshot_date": pl.Date(),
    "tracked_hash": pl.Utf8(),
}

# started_at is a naive datetime that is always UTC (no tz attached).
RUN_LOG_SCHEMA: dict[str, pl.DataType] = {
    "run_id": pl.Utf8(),
    "started_at": pl.Datetime("us"),
    "duration_s": pl.Float64(),
    "status": pl.Utf8(),
    "data_timestamp": pl.Utf8(),
    "rows_ingested": pl.Int64(),
    "changes_detected": pl.Int64(),
    "warnings": pl.Utf8(),  # JSON-encoded list
}

_TABLE_NAMES = [f.name for f in fields(Tables)]
_STATE_FILE = "state.json"
_OLD_DIR = ".state-old"


class StoreError(RuntimeError):
    """The on-disk state is corrupt and cannot be used."""


def _write_parquet(df: pl.DataFrame, path: Path) -> None:
    """Write ``path`` atomically (temp file in the same dir, fsync, rename)."""
    fd, tmp_name = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    tmp = Path(tmp_name)
    try:
        with os.fdopen(fd, "wb") as f:
            df.write_parquet(f, compression="zstd", statistics=True)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        with contextlib.suppress(FileNotFoundError):
            tmp.unlink()
        raise
    _fsync_dir(path.parent)


def _write_text(text: str, path: Path) -> None:
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


def _check_schema(df: pl.DataFrame, schema: dict[str, pl.DataType], what: str) -> None:
    if df.columns != list(schema) or dict(df.schema) != schema:
        raise ValueError(f"{what}: schema mismatch, expected {schema}, got {dict(df.schema)}")


def _read_state_dir(directory: Path) -> tuple[Tables, date, str] | None:
    """Read a complete state directory, or None if absent/incomplete/corrupt."""
    try:
        meta = json.loads((directory / _STATE_FILE).read_text(encoding="utf-8"))
        state_date = date.fromisoformat(meta["state_date"])
        timestamp = str(meta["data_timestamp"])
        frames = {name: pl.read_parquet(directory / f"{name}.parquet") for name in _TABLE_NAMES}
    except (OSError, ValueError, KeyError, TypeError, pl.exceptions.PolarsError):
        return None
    for name, df in frames.items():
        if df.columns != list(SCHEMAS[name]) or dict(df.schema) != SCHEMAS[name]:
            return None
    return Tables(**frames), state_date, timestamp


class Store:
    def __init__(self, root: Path) -> None:
        self.root = Path(root)

    # ----- state -----

    def state_before(self, day: date) -> tuple[Tables, date] | None:
        """Newest fully valid state strictly before ``day``.

        Candidates are ``current/``, ``.state-old`` (the previous current,
        left behind if a same-day overwrite crashed mid-swap) and
        ``previous/``; ties prefer that order.  A present-but-corrupt
        ``current/`` raises StoreError; a missing one is not an error.
        """
        self._require_current_valid()
        best: tuple[Tables, date] | None = None
        for directory in (self.root / "current", self.root / _OLD_DIR, self.root / "previous"):
            found = _read_state_dir(directory)
            if found is not None and found[1] < day and (best is None or found[1] > best[1]):
                best = (found[0], found[1])
        return best

    def _require_current_valid(self) -> None:
        current = self.root / "current"
        if current.exists() and _read_state_dir(current) is None:
            raise StoreError(
                f"{current} is corrupt or incomplete; run `trialradar rebuild` "
                "from the raw snapshots to regenerate the state"
            )

    def save_state(self, tables: Tables, day: date, data_timestamp: str) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        current, previous = self.root / "current", self.root / "previous"
        old = self.root / _OLD_DIR
        # Self-heal a crashed same-day swap: the newest committed state is in .state-old.
        if not current.exists() and _read_state_dir(old) is not None:
            os.replace(old, current)
        self._require_current_valid()
        existing = _read_state_dir(current)
        existing_date = existing[1] if existing else None
        if existing_date is not None and existing_date > day:
            raise ValueError(f"refusing to rewind state from {existing_date} to {day}")

        for stray in self.root.glob(".state-new-*"):
            shutil.rmtree(stray, ignore_errors=True)

        new = Path(tempfile.mkdtemp(dir=self.root, prefix=".state-new-"))
        moved_aside = False
        try:
            for name in _TABLE_NAMES:
                _write_parquet(getattr(tables, name), new / f"{name}.parquet")
            meta = {"state_date": day.isoformat(), "data_timestamp": data_timestamp}
            _write_text(json.dumps(meta), new / _STATE_FILE)
            _fsync_dir(new)

            if existing_date is not None and existing_date < day:
                shutil.rmtree(previous, ignore_errors=True)
                os.replace(current, previous)
            elif existing_date is not None:
                # Same day: replace current only.  A leftover .state-old is older
                # than the valid current, so it is superseded and may go.
                shutil.rmtree(old, ignore_errors=True)
                os.replace(current, old)
                moved_aside = True
            try:
                os.replace(new, current)
            except BaseException:
                if moved_aside and not current.exists():
                    os.replace(old, current)
                raise
        except BaseException:
            shutil.rmtree(new, ignore_errors=True)
            raise
        _fsync_dir(self.root)
        if moved_aside:
            shutil.rmtree(old, ignore_errors=True)

    # ----- history -----

    def _history(self, name: str, schema: dict[str, pl.DataType]) -> pl.DataFrame:
        path = self.root / "history" / f"{name}.parquet"
        if not path.exists():
            return pl.DataFrame(schema=schema)
        df = pl.read_parquet(path)
        _check_schema(df, schema, name)
        return df

    def _write_history(self, name: str, df: pl.DataFrame) -> None:
        directory = self.root / "history"
        directory.mkdir(parents=True, exist_ok=True)
        _write_parquet(df, directory / f"{name}.parquet")

    def changes(self) -> pl.DataFrame:
        return self._history("trial_change", TRIAL_CHANGE_SCHEMA)

    def snapshots(self) -> pl.DataFrame:
        return self._history("trial_snapshot", SNAPSHOT_SCHEMA)

    def run_log(self) -> pl.DataFrame:
        return self._history("run_log", RUN_LOG_SCHEMA)

    def replace_day(self, day: date, changes: pl.DataFrame, snapshots: pl.DataFrame) -> None:
        """Replace the history rows of ``day`` (idempotent)."""
        _check_schema(changes, TRIAL_CHANGE_SCHEMA, "changes")
        _check_schema(snapshots, SNAPSHOT_SCHEMA, "snapshots")
        merged_changes = pl.concat(
            [self.changes().filter(pl.col("detected_date").ne_missing(day)), changes]
        ).sort(["nct_id", "field", "detected_date"], maintain_order=True)
        merged_snaps = pl.concat(
            [self.snapshots().filter(pl.col("snapshot_date").ne_missing(day)), snapshots]
        ).sort(["snapshot_date", "nct_id"], maintain_order=True)
        self._write_history("trial_change", merged_changes)
        self._write_history("trial_snapshot", merged_snaps)

    def append_run(self, row: dict[str, Any]) -> None:
        if set(row) != set(RUN_LOG_SCHEMA):
            raise ValueError(
                f"run_log row keys must be {sorted(RUN_LOG_SCHEMA)}, got {sorted(row)}"
            )
        if not isinstance(row["warnings"], str):
            raise ValueError("run_log 'warnings' must be a JSON-encoded string")  # noqa: TRY004
        new = pl.DataFrame([{k: row[k] for k in RUN_LOG_SCHEMA}], schema=RUN_LOG_SCHEMA)
        self._write_history("run_log", pl.concat([self.run_log(), new]))

    def last_success_timestamp(self) -> str | None:
        ok = self.run_log().filter(pl.col("status") == "success")
        if ok.height == 0:
            return None
        ok = ok.sort("started_at", maintain_order=True)
        value = ok["data_timestamp"][-1]
        return None if value is None else str(value)
