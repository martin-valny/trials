"""Daily run orchestration and rebuild from raw snapshots (spec sections 4.3, 6, 7).

Integrity rule: bad data never replaces good data. A run for a day before the
committed state fails before fetching. Until the store has saved the run's data,
the only thing written is the raw snapshot, and that goes to a staging directory
(``raw/.incoming/``). Once state and history are written it is promoted to
``raw/YYYY-MM-DD.jsonl.gz``, so every raw snapshot matches what was stored. If
the data itself is bad (schema, normalize or quality errors) it is quarantined as
``raw/YYYY-MM-DD.failed.jsonl.gz`` instead, which ``list_snapshots`` ignores, so
it is never uploaded or replayed. Every failure appends a ``failed`` run_log row;
failures before the store write leave state, history, site and the promoted raw
snapshots as they were.
"""

from __future__ import annotations

import json
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
from trialradar.snapshot import (
    list_snapshots,
    promote_staged,
    quarantine_staged,
    read_sidecar,
    read_snapshot,
    stage_snapshot,
)
from trialradar.store import RUN_LOG_SCHEMA, Store
from trialradar.tables import Tables
from trialradar.textnorm import Aliases, load_alias_set
from trialradar.tracked import registry_dates, snapshot_frame, tracked_state

Status = Literal["success", "skipped", "failed"]
_ROW_DROP = "row_drop_error:"


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
        error = str(exc) if isinstance(exc, DataError) else _describe(exc)
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

    Stage order: rewind check -> version check (skip if unchanged) -> fetch ->
    staged snapshot -> schema check -> relevance filter -> normalize -> previous
    state -> quality gate -> diff -> store -> promote snapshot -> export ->
    success run_log row.
    """
    clock = now or _utcnow
    started_at, t0 = clock(), time.monotonic()
    rid = run_id or uuid.uuid4().hex
    aliases_dir = aliases_dir if aliases_dir is not None else cfg.aliases_dir
    ts: str | None = None
    fetched = 0
    staged = False
    try:
        with _stage("rewind_check") as info:
            # A run for a day before the committed state would overwrite that
            # day's good snapshot and then be refused by save_state: fail first.
            store.require_no_rewind(day)
            info["rows"] = 0
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
            stage_snapshot(raw_dir, day, raw, meta)
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

        staged = False  # past the gate: a later failure is not the data's fault
        changes, snaps = _changes(prev, tables, cfg, load_alias_set(aliases_dir), day)
        _persist(store, tables, day, ts, changes, snaps)
        # Promote only once the store holds this data, so a raw snapshot always
        # matches what was stored (rebuild replays it); before export, so a failed
        # export (the data was fine) keeps it. A diff/store failure leaves it in
        # staging, which the next run clears.
        promote_staged(raw_dir, day)

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
    cleared by the next run."""
    if quarantine:
        with suppress(Exception):
            quarantine_staged(raw_dir, day)
    with suppress(Exception), _stage("run_log", status="failed") as info:
        store.append_run(row)
        info["rows"], info["warnings"] = 1, json.loads(row["warnings"])


# ----- rebuild -----


def rebuild(
    cfg: AreaConfig,
    store_root: Path,
    raw_dir: Path,
    site_dir: Path,
    aliases_dir: Path | None = None,
) -> None:
    """Regenerate the store from the raw snapshots, then export the last replayed day.

    Days replay in date order through the same gate as ``run`` (honouring an
    ``accept_drop`` recorded in the sidecar); a day that fails it is skipped with
    a ``rebuild_skip`` log line. Each replayed day gets a synthetic ``success``
    run_log row. Only store-owned entries under ``store_root`` are removed
    (``Store.wipe``).
    Errors writing the store or site propagate."""
    aliases_dir = aliases_dir if aliases_dir is not None else cfg.aliases_dir
    aliases = load_alias_set(aliases_dir)
    store = Store(store_root)
    store.wipe()
    prev: Tables | None = None
    last: tuple[Tables, date] | None = None
    for day, path in list_snapshots(raw_dir):
        t0 = time.monotonic()
        meta = read_sidecar(path)
        try:
            with _stage("read_snapshot", day=day.isoformat()) as info:
                raw = read_snapshot(path)
                info["rows"] = len(raw)
            relevant, tables = _prepare(raw, cfg, aliases_dir)
            prev_count = (prev.trial.height or None) if prev else None
            accepted = meta.get("accept_drop") is True
            _gate(raw, relevant, tables, prev_count, cfg, accepted)
        except Exception as exc:  # noqa: BLE001 - an unusable day is skipped, not fatal
            errors = exc.errors if isinstance(exc, DataError) else [_describe(exc)]
            with _stage("rebuild_skip", day=day.isoformat()) as info:
                info["rows"], info["warnings"] = 0, errors
            continue
        changes, snaps = _changes(prev, tables, cfg, aliases, day)
        timestamp = str(meta.get("data_timestamp") or "")
        _persist(store, tables, day, timestamp, changes, snaps)
        started = datetime(day.year, day.month, day.day)
        row = _run_row(
            f"rebuild-{day.isoformat()}",
            started,
            t0,
            "success",
            timestamp,
            len(raw),
            changes.height,
            [],
        )
        store.append_run(row)
        prev, last = tables, (tables, day)
    if last is not None:
        tables, day = last
        with _stage("export", day=day.isoformat()) as info:
            export(tables, store.changes(), store.run_log(), cfg, day, site_dir)
            info["rows"] = tables.trial.height
