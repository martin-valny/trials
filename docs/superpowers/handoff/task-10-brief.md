### Task 10: Pipeline orchestration, CLI, rebuild, integration test

**Files:**
- Create: `pipeline/src/trialradar/pipeline.py`, `pipeline/src/trialradar/cli.py`
- Test: `pipeline/tests/integration/test_pipeline.py`, `pipeline/tests/unit/test_cli.py`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `@dataclass RunResult(status: Literal["success","skipped","failed"], changes: int, warnings: list[str], errors: list[str])`.
  - `run(cfg: AreaConfig, client: CtGovClient, store: Store, raw_dir: Path, site_dir: Path, day: date, force: bool = False) -> RunResult`. Order: `data_timestamp()` → if equals `store.last_success_timestamp()` and not `force`: append `skipped` run row, return. → `iter_studies` → `write_snapshot` → `normalize` → `state_before(day)` → `quality.check(raw, tables, prev_trial_count=prev.trial.height or None, cfg)` (errors: append `failed` row, return without touching state/history/site) → `tracked_state` both → `diff` → `save_state` → `replace_day` → `append_run(success)` → `export`. Each stage emits one JSON log line to stderr: `{"stage", "duration_s", "rows", "warnings"}`.
  - `rebuild(cfg, store_root: Path, raw_dir: Path, site_dir: Path) -> None` — wipes `store_root`, replays `list_snapshots(raw_dir)` in date order through normalize → diff → store, then exports for the last date.
  - CLI: `trialradar run [--config config/area.yaml] [--data-dir data] [--raw-dir raw] [--site-dir web/public/data] [--date YYYY-MM-DD] [--force]` (exit 0 on success/skipped, 1 on failed; when `$GITHUB_OUTPUT` is set, appends `status=<success|skipped|failed>` to it); `trialradar check` (loads config, prints OK); `trialradar rebuild` (same dir flags).

- [ ] **Step 1: Failing integration test** using a fake client (subclass with canned `data_timestamp` and `iter_studies` built from `sample20.jsonl`):
  - Day 1: status success, 0 changes, 20 trial JSON files, `meta.json` present.
  - Day 2: same timestamp → `skipped`; site unchanged.
  - Day 2 with new timestamp and edits (one status → TERMINATED, one primary completion +120 days, one study removed, one new study): 4+ change rows, both edits notable, `changes/1d.json` lists them.
  - Day 2 re-run (`force=True`): change count identical (idempotent).
  - Day 3 with a study missing `briefTitle`: `failed`, `data/current` and `changes/*.json` byte-identical to before.
  - `rebuild` over the three raw snapshots reproduces the same `history/trial_change.parquet` rows as the incremental runs.
- [ ] **Step 2:** Run `uv run pytest tests/integration -v` → FAIL.
- [ ] **Step 3: Implement `pipeline.py` and `cli.py`.**
- [ ] **Step 4:** Run full suite `uv run pytest -v` → PASS; ruff + mypy clean.
- [ ] **Step 5:** Add `tests/live/test_live_api.py` (`@pytest.mark.live`): `data_timestamp()` non-empty; first page of `iter_studies(cfg)` normalises and passes `quality.check` with no errors. Not run in CI.
- [ ] **Step 6: Commit** `feat: pipeline orchestration, CLI and rebuild`.

---

### Task 10 amendments (from the final review of Tasks 1–9; binding on Task 10)

- **Failure handling:** run the raw `schema:` check BEFORE `normalize` (normalize raises on a missing nctId / bad date); wrap every stage so any exception becomes a `failed` run_log row, `status=failed` in `$GITHUB_OUTPUT`, exit 1, with state/history/site untouched.
- **Order:** `export` runs BEFORE `append_run(success)`, so a failed export never marks the registry timestamp as done.
- **Snapshots:** write `raw/YYYY-MM-DD.meta.json` (`data_timestamp`, `fetched_at`) next to each snapshot. A day that fails `quality.check` renames its snapshot to `*.failed.jsonl.gz` (never uploaded, never replayed). `rebuild` replays snapshots in date order, runs `quality.check`, skips days with errors, and writes a synthetic `success` run_log row per replayed day using the sidecar timestamp.
- **Shared helpers:** add `registry_dates(tables) -> dict[str, date]` and `snapshot_frame(state, day) -> pl.DataFrame` (schema `SNAPSHOT_SCHEMA`) used by both `run` and `rebuild`.
- **Integration test additions:** an empty first-run raw dir; a failed day 3 followed by `rebuild` equals the incremental history; same-day `force` rerun leaves no duplicates.
- **Decisions still open (user):** relevance of the tracked set (production query returns many off-topic trials), alias-edit semantics, and treatment of a large one-day row drop. Do not start Task 10 until these are settled.


---

## CONTROLLER ADDENDUM (supersedes anything above that conflicts; the "decisions still open" bullet is RESOLVED: relevance filter, alias-stable comparison and >25% drop error all exist now)

### Existing APIs you must use (read the source; do not reinvent)
- `CtGovClient.data_timestamp() -> str`, `CtGovClient.iter_studies(cfg) -> Iterator[dict]` (raises `CtGovError`).
- `snapshot.write_snapshot(raw_dir, day, studies) -> Path`, `read_snapshot(path)`, `list_snapshots(raw_dir) -> list[tuple[date, Path]]` (returns [] for a missing dir; ignores names not matching `YYYY-MM-DD.jsonl.gz`, so `*.failed.jsonl.gz` is ignored).
- `relevance.filter_relevant(studies, cfg) -> list[dict]`.
- `normalize.normalize(studies, aliases_dir) -> Tables`; `textnorm.load_alias_set(aliases_dir) -> Aliases`.
- `tracked.tracked_state(tables, fields, aliases) -> TrackedState` (ALWAYS pass the current `Aliases` for BOTH prev and curr, computed fresh from stored tables — never compare stored `tracked_hash` values from earlier runs); `tracked.tracked_hash(state_for_one_trial)`.
- `diff.diff(prev_state | None, curr_state, registry_dates, cfg, day) -> DataFrame[TRIAL_CHANGE_SCHEMA]`.
- `quality.check(raw, tables, prev_trial_count, cfg, fetched_count=None) -> QualityReport(errors, warnings)`; the `schema:` check lives in a private `_check_schema` — expose a public `check_raw(raw) -> list[str]` (the schema errors only; `check` keeps calling the same code, no duplication).
- `store.Store`: `state_before(day) -> (Tables, date) | None`, `save_state(tables, day, data_timestamp)`, `replace_day(day, changes, snapshots)`, `append_run(row)` (row keys EXACTLY `RUN_LOG_SCHEMA` keys: run_id, started_at (naive UTC datetime), duration_s, status, data_timestamp, rows_ingested, changes_detected, warnings (JSON-encoded list string)), `run_log()`, `changes()`, `snapshots()`, `last_success_timestamp()`; `SNAPSHOT_SCHEMA`. `StoreError` for a corrupt `current/`.
- `export.export(tables, changes, run_log, cfg, day, out_dir)` (reads `meta.json` data from the LAST success row of the `run_log` frame you pass it).

### Binding design decisions
1. **Stage order in `run`** (each stage emits one JSON log line to stderr `{"stage","duration_s","rows","warnings"}`): `data_timestamp` → skip if equal to `store.last_success_timestamp()` and not `force` (append a `skipped` run row, return `RunResult("skipped", 0, [], [])`) → `iter_studies` (all fetched studies kept as `raw`) → `write_snapshot(raw_dir, day, raw)` + sidecar `raw_dir/YYYY-MM-DD.meta.json` `{"data_timestamp","fetched_at"}` (atomic write) → `check_raw(raw)` (errors → failed) → `filter_relevant` → `normalize` → `store.state_before(day)` → `quality.check(relevant, tables, prev_trial_count=(prev.trial.height or None), cfg, fetched_count=len(raw))` (errors → failed) → `tracked_state` for prev and curr (same `Aliases`) → `diff` → build `snapshot_frame` → `save_state` → `replace_day` → build the success run row → `export(tables, changes, run_log_frame_with_the_new_row_appended_in_memory, …)` → `append_run(success row)`. **Export happens BEFORE `append_run(success)`** (a failed export must not mark the timestamp done), but `meta.json` must still reflect THIS run — hence the in-memory run_log with the new row.
   *Known trade-off, document in a code comment:* if export fails after `save_state`/`replace_day`, the same-day rerun is idempotent; the next run with an unchanged timestamp is NOT skipped because no success row exists.
2. **Any exception** after the run starts (network `CtGovError`, malformed data, `ValueError`, `StoreError`, export failure) → best-effort: rename the day's snapshot (and sidecar) to `*.failed.jsonl.gz` / `*.failed.meta.json` ONLY IF the failure happened at/after the quality gate or later stages caused by bad data (quality errors, normalize/schema errors) — for a pure network failure no snapshot exists; for an export/store failure keep the snapshot (data was fine) — then append a `failed` run row (warnings = JSON list of the error messages), return `RunResult("failed", …)`. State/history/site must be untouched for quality/normalize/schema failures (assert byte-identical dirs in tests). The failure-recording itself must never raise (wrap it).
3. **`--accept-drop` / `accept_drop: bool = False` parameter** on `run` (and CLI flag): demote a `row_drop_error:` error to a warning (legitimate big change, e.g. config edit). Nothing else is demoted.
4. **`registry_dates(tables) -> dict[str, date]`** and **`snapshot_frame(state, day) -> pl.DataFrame`** (schema `SNAPSHOT_SCHEMA`: `nct_id`, `snapshot_date`, `tracked_hash` = hash of that trial's tracked fields) live in `tracked.py` and are used by both `run` and `rebuild`.
5. **`rebuild(cfg, store_root, raw_dir, site_dir, aliases_dir)`**: wipe `store_root`; for each `list_snapshots` day in date order: read → `filter_relevant` → `check_raw` and `normalize` guarded (a day that raises or whose `quality.check` has errors is SKIPPED with a warning log line) → diff against the previous replayed state (baseline for the first) → `save_state`/`replace_day` → synthetic `success` run row (`started_at` = that day at 00:00 naive UTC, `data_timestamp` from the sidecar (empty string if missing), `rows_ingested` = fetched, `changes_detected`, `warnings` `[]`) ; after the loop `export` for the last replayed day (no days → no export, no error). Result must equal the incremental history (`Store.changes()` and `Store.snapshots()` equal).
6. **`RunResult`** dataclass as specified; `run(..., now: Callable[[], datetime] | None = None, run_id: str | None = None)` — injectable clock/id for deterministic tests (default: UTC now, `uuid4().hex`).
7. **CLI** (`trialradar run|check|rebuild`, flags per the brief plus `--accept-drop` and `--aliases-dir` defaulting to `cfg.aliases_dir`): `--date` default = today UTC; when `$GITHUB_OUTPUT` is set append `status=<success|skipped|failed>`; exit 0 for success/skipped, 1 for failed; unexpected exceptions anywhere → print a one-line error, exit 1 (and still write `status=failed`). `check` loads the config and prints `OK`.

### Test data (must work BEFORE and AFTER the user re-records fixtures)
Build the integration fixtures in `tests/integration/conftest.py`: take the in-area studies from `tests/fixtures/studies/sample20.jsonl` via `filter_relevant` (today only ~6 pass; after re-recording ~20) and top up to at least 12 total with deterministic clones made from `make_study` using condition "Multiple Sclerosis" and distinct NCT ids (`NCT9000000x`), then ALSO include 2 off-topic studies (conditions ["Healthy"]) to prove the filter: they must appear in the raw snapshot but never in `Tables` or the exported files.

### Required tests (in addition to the plan's list)
Day 1 baseline success, 0 changes, N trial files, off-topic excluded from site but present in snapshot; day 2 same timestamp → `skipped`, site unchanged; day 2 new timestamp with edits (status → TERMINATED, primary completion +120 days, one study removed, one added, one cosmetic-only edit) → expected rows incl. notable flags, cosmetic emits nothing; `force` rerun identical and no duplicates; day 3 malformed study (missing briefTitle; and separately missing nctId) → `failed`, store dir + site dir byte-identical to before, snapshot renamed to `.failed`, run_log has a failed row; day 3 with >25% fewer studies → failed with `row_drop_error`, and the same input with `accept_drop=True` → success; export failure (monkeypatch `export` to raise) → failed, no success row, and a rerun with the same timestamp is NOT skipped; rebuild equals incremental history including after a failed day; rebuild on an empty/missing raw dir → no error, no export; sidecar meta written; alias CSV edited between day 1 and day 2 → NO change rows (alias-stable); CLI exit codes and `$GITHUB_OUTPUT` for success/skipped/failed/unexpected exception; JSON stage log lines on stderr parse. `tests/live/test_live_api.py` (`@pytest.mark.live`) per the plan.
