"""Daily run orchestration and rebuild from raw snapshots (spec sections 4.3, 6, 7).

Integrity rule: bad data never replaces good data. Until the quality gate has
passed, the only thing written is the raw snapshot, and that goes to a staging
directory (``raw/.incoming/``). After the gate it is promoted to
``raw/YYYY-MM-DD.jsonl.gz``; if the data itself is bad (schema, normalize or
quality errors) it is quarantined as ``raw/YYYY-MM-DD.failed.jsonl.gz`` instead,
which ``list_snapshots`` ignores, so it is never uploaded or replayed. Every
failure appends a ``failed`` run_log row and leaves state, history and site as
they were.
"""

from __future__ import annotations

import json
import os
import shutil
import sys
import time
import uuid
from collections.abc import Callable, Iterator, Sequence
from contextlib import contextmanager, suppress
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any, Literal

import polars as pl

from trialradar import quality
from trialradar.config import AreaConfig
from trialradar.ctgov.client import CtGovClient
from trialradar.diff import diff
from trialradar.export import export
from trialradar.normalize import normalize
from trialradar.relevance import filter_relevant
from trialradar.snapshot import write_snapshot
from trialradar.store import RUN_LOG_SCHEMA, Store, _write_text
from trialradar.tables import Tables
from trialradar.textnorm import Aliases, load_alias_set
from trialradar.tracked import registry_dates, snapshot_frame, tracked_state

Status = Literal["success", "skipped", "failed"]
_STAGING = ".incoming"
_ROW_DROP = "row_drop_error:"
# Entries ``Store`` owns under its root; rebuild removes only these, so a store
# root that is also a git working tree keeps its ``.git``.
_STORE_ENTRIES = ("current", "previous", "history", ".state-old")


@dataclass
class RunResult:
    status: Status
    changes: int
    warnings: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


class DataError(Exception):
    """The fetched data is bad: quarantine the snapshot and fail the run."""

    def __init__(self, errors: Sequence[str]) -> None:
        super().__init__("; ".join(errors))
        self.errors = list(errors)


def _utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _describe(exc: BaseException) -> str:
    return f"{type(exc).__name__}: {exc}"


@contextmanager
def _stage(name: str, **extra: Any) -> Iterator[dict[str, Any]]:
    """Time a stage and emit one JSON log line to stderr when it ends.

    The caller fills ``info["rows"]`` and ``info["warnings"]``; a stage that
    raises logs an ``error`` key and re-raises.
    """
    info: dict[str, Any] = {"rows": None, "warnings": []}
    started = time.monotonic()
    error: str | None = None
    try:
        yield info
    except BaseException as exc:
        error = exc.errors[0] if isinstance(exc, DataError) and exc.errors else _describe(exc)
        raise
    finally:
        line: dict[str, Any] = {
            "stage": name,
            **extra,
            "duration_s": round(time.monotonic() - started, 6),
            "rows": info["rows"],
            "warnings": list(info["warnings"]),
        }
        if error is not None:
            line["error"] = error
        print(json.dumps(line, ensure_ascii=False, default=str), file=sys.stderr, flush=True)


# ----- raw snapshot staging -----


def _paths(raw_dir: Path, day: date, suffix: str = "") -> tuple[Path, Path]:
    stem = day.isoformat() + suffix
    return raw_dir / f"{stem}.jsonl.gz", raw_dir / f"{stem}.meta.json"


def _stage_snapshot(
    raw_dir: Path, day: date, raw: list[dict[str, Any]], meta: dict[str, Any]
) -> None:
    staging = raw_dir / _STAGING
    shutil.rmtree(staging, ignore_errors=True)  # leftovers of an earlier failed/crashed run
    write_snapshot(staging, day, raw)
    _write_text(json.dumps(meta, sort_keys=True) + "\n", _paths(staging, day)[1])


def _move_staged(raw_dir: Path, day: date, suffix: str) -> None:
    """Move the staged snapshot to its final (``""``) or quarantine name.

    The sidecar moves first, so a crash in between never leaves a snapshot
    without its timestamp."""
    src_snap, src_meta = _paths(raw_dir / _STAGING, day)
    dst_snap, dst_meta = _paths(raw_dir, day, suffix)
    if src_meta.exists():
        os.replace(src_meta, dst_meta)
    if src_snap.exists():
        os.replace(src_snap, dst_snap)


def _read_sidecar(snapshot: Path) -> dict[str, Any]:
    path = snapshot.with_name(snapshot.name.removesuffix(".jsonl.gz") + ".meta.json")
    try:
        meta = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return meta if isinstance(meta, dict) else {}


# ----- shared stage helpers -----


def _prepare(
    raw: list[dict[str, Any]], cfg: AreaConfig, aliases_dir: Path
) -> tuple[list[dict[str, Any]], Tables]:
    """Schema check, relevance filter and normalize; ``DataError`` for bad data."""
    with _stage("check_raw") as info:
        info["rows"] = len(raw)
        errors = quality.check_raw(raw)
        if errors:
            raise DataError(errors)
    with _stage("filter_relevant") as info:
        relevant = filter_relevant(raw, cfg)
        info["rows"] = len(relevant)
    with _stage("normalize") as info:
        try:
            tables = normalize(relevant, aliases_dir)
        except Exception as exc:  # malformed data inside a study
            raise DataError([f"normalize: {_describe(exc)}"]) from exc
        info["rows"] = tables.trial.height
    return relevant, tables


def _gate(
    raw: list[dict[str, Any]],
    relevant: list[dict[str, Any]],
    tables: Tables,
    prev_trial_count: int | None,
    cfg: AreaConfig,
    accept_drop: bool,
) -> list[str]:
    """The quality gate: returns its warnings, raises ``DataError`` on errors."""
    with _stage("quality") as info:
        report = quality.check(relevant, tables, prev_trial_count, cfg, fetched_count=len(raw))
        errors, warnings = list(report.errors), list(report.warnings)
        if accept_drop:
            # A deliberate, operator-accepted shrink (e.g. a config edit); nothing else demotes.
            warnings += [e for e in errors if e.startswith(_ROW_DROP)]
            errors = [e for e in errors if not e.startswith(_ROW_DROP)]
        info["rows"], info["warnings"] = tables.trial.height, warnings
        if errors:
            raise DataError(errors)
    return warnings


def _changes(
    prev: Tables | None, tables: Tables, cfg: AreaConfig, aliases: Aliases, day: date
) -> tuple[pl.DataFrame, pl.DataFrame]:
    """Change rows and snapshot rows for ``day``.

    Both states are derived freshly from tables with the *current* aliases, so
    an alias edit never registers as a change (stored hashes are not compared)."""
    with _stage("diff") as info:
        curr_state = tracked_state(tables, cfg.tracked_fields, aliases)
        prev_state = tracked_state(prev, cfg.tracked_fields, aliases) if prev else None
        changes = diff(prev_state, curr_state, registry_dates(tables), cfg, day)
        info["rows"] = changes.height
    return changes, snapshot_frame(curr_state, day)


def _persist(
    store: Store,
    tables: Tables,
    day: date,
    data_timestamp: str,
    changes: pl.DataFrame,
    snaps: pl.DataFrame,
) -> None:
    with _stage("store") as info:
        store.save_state(tables, day, data_timestamp)
        store.replace_day(day, changes, snaps)
        info["rows"] = tables.trial.height


def _run_row(
    run_id: str,
    started_at: datetime,
    t0: float,
    status: Status,
    data_timestamp: str | None,
    rows_ingested: int,
    changes_detected: int,
    warnings: Sequence[str],
) -> dict[str, Any]:
    return {
        "run_id": run_id,
        "started_at": started_at,
        "duration_s": round(time.monotonic() - t0, 6),
        "status": status,
        "data_timestamp": data_timestamp,
        "rows_ingested": rows_ingested,
        "changes_detected": changes_detected,
        "warnings": json.dumps(list(warnings), ensure_ascii=False),
    }


# ----- run -----


def run(
    cfg: AreaConfig,
    client: CtGovClient,
    store: Store,
    raw_dir: Path,
    site_dir: Path,
    day: date,
    force: bool = False,
    accept_drop: bool = False,
    aliases_dir: Path | None = None,
    now: Callable[[], datetime] | None = None,
    run_id: str | None = None,
) -> RunResult:
    """One daily run; never raises for a failed run (see the module docstring).

    Stage order: version check (skip if unchanged) -> fetch -> staged snapshot ->
    schema check -> relevance filter -> normalize -> previous state -> quality
    gate -> promote snapshot -> diff -> store -> export -> success run_log row.
    """
    clock = now or _utcnow
    started_at, t0 = clock(), time.monotonic()
    rid = run_id or uuid.uuid4().hex
    aliases_dir = aliases_dir if aliases_dir is not None else cfg.aliases_dir
    ts: str | None = None
    fetched = 0
    staged = False
    try:
        with _stage("data_timestamp") as info:
            ts = client.data_timestamp()
            last = store.last_success_timestamp()
            info["rows"] = 1
        if not force and ts == last:
            with _stage("run_log", status="skipped") as info:
                store.append_run(_run_row(rid, started_at, t0, "skipped", ts, 0, 0, []))
                info["rows"] = 1
            return RunResult("skipped", 0, [], [])

        with _stage("fetch") as info:
            raw = list(client.iter_studies(cfg))
            fetched = info["rows"] = len(raw)
        with _stage("snapshot") as info:
            fetched_at = clock().isoformat(timespec="seconds") + "Z"
            meta = {"data_timestamp": ts, "fetched_at": fetched_at, "accept_drop": accept_drop}
            _stage_snapshot(raw_dir, day, raw, meta)
            staged = True
            info["rows"] = len(raw)

        relevant, tables = _prepare(raw, cfg, aliases_dir)
        with _stage("state_before") as info:
            # A StoreError here is not the data's fault: the snapshot is not quarantined.
            found = store.state_before(day)
            prev = found[0] if found else None
            info["rows"] = prev.trial.height if prev else 0
        prev_count = (prev.trial.height or None) if prev else None
        warnings = _gate(raw, relevant, tables, prev_count, cfg, accept_drop)

        _move_staged(raw_dir, day, "")  # the data passed the gate: keep it for rebuild
        staged = False
        changes, snaps = _changes(prev, tables, cfg, load_alias_set(aliases_dir), day)
        _persist(store, tables, day, ts, changes, snaps)

        row = _run_row(rid, started_at, t0, "success", ts, fetched, changes.height, warnings)
        with _stage("export") as info:
            # Export runs before the success row is stored, so a failed export never
            # marks this registry timestamp as done; meta.json still describes this
            # run because the row is appended in memory. Trade-off: if export fails
            # after save_state/replace_day, a same-day rerun is idempotent, and the
            # next run with an unchanged timestamp is NOT skipped (no success row).
            log = pl.concat([store.run_log(), pl.DataFrame([row], schema=RUN_LOG_SCHEMA)])
            export(tables, store.changes(), log, cfg, day, site_dir)
            info["rows"] = tables.trial.height
        with _stage("run_log", status="success") as info:
            store.append_run(row)
            info["rows"] = 1
        return RunResult("success", changes.height, warnings, [])
    except Exception as exc:  # noqa: BLE001 - every failure becomes a failed run row
        errors = exc.errors if isinstance(exc, DataError) else [_describe(exc)]
        quarantine = staged and isinstance(exc, DataError)
        failed = _run_row(rid, started_at, t0, "failed", ts, fetched, 0, errors)
        _record_failure(store, raw_dir, day, quarantine, failed)
        return RunResult("failed", 0, [], errors)


def _record_failure(
    store: Store,
    raw_dir: Path,
    day: date,
    quarantine: bool,
    row: dict[str, Any],
) -> None:
    """Best effort: quarantine bad data and append a ``failed`` row; never raises.

    A snapshot that failed for a non-data reason (store) stays in staging and is
    overwritten by the next run of that day."""
    if quarantine:
        with suppress(Exception):
            _move_staged(raw_dir, day, ".failed")
    with suppress(Exception), _stage("run_log", status="failed") as info:
        store.append_run(row)
        info["rows"], info["warnings"] = 1, json.loads(row["warnings"])
