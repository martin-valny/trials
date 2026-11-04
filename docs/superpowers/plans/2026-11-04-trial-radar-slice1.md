# Trial Radar Slice 1 (Core Pipeline + Changes Feed) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A daily GitHub Actions pipeline that pulls the tracked neuroimmunology trial set from ClinicalTrials.gov, detects field-level changes, and publishes a static Changes feed + Trial detail site on GitHub Pages.

**Architecture:** A Python package (`trialradar`) with small single-purpose modules; only `ctgov.client` touches the network and only `store`/`snapshot`/`export` touch disk. Canonical state is Parquet on a force-pushed `data` branch; raw daily snapshots go to monthly GitHub Releases; the site reads pre-built JSON bundled into the Pages deploy.

**Tech Stack:** Python 3.12, uv, polars, httpx, pydantic v2, PyYAML, pytest, ruff, mypy · Node 22, Vite, React 18, TypeScript, react-router-dom (HashRouter), Vitest, Testing Library, Playwright · GitHub Actions, GitHub Pages, GitHub Releases.

**Spec:** `docs/superpowers/specs/2026-11-04-trial-radar-slice1-design.md`

## Global Constraints

- $0 running cost: GitHub Actions, Pages, Releases only. No external services, no secrets beyond `GITHUB_TOKEN`.
- Public data only; no personal data.
- New therapeutic area = edit `config/area.yaml` only; no condition names hard-coded in code.
- Study type: interventional only. Phases: `EARLY_PHASE1, PHASE1, PHASE2, PHASE3, PHASE4, NA`. All overall statuses.
- API: `https://clinicaltrials.gov/api/v2`; `pageSize=1000`; paginate with `pageToken`/`nextPageToken`.
- Network: 5 retries, exponential backoff with jitter, on connection errors, 429 and 5xx; 30 s per-request timeout.
- Notable thresholds: enrollment |relative change| ≥ 0.20; date slip `delta_days` ≥ 90 on `primary_completion_date` or `completion_date`; any `overall_status` change; any `primary_outcomes` change.
- Row-count drop warning threshold: > 10% vs previous run. Freshness badge warns when last success > 36 h old.
- Daily cron: `17 7 * * *`. Weekly live check workflow.
- Dates with month precision are stored as the first of the month with `precision = "month"`.
- `delta_days` is signed: positive = slip (later), negative = pull-in.
- All AI text labelled (none in this slice); every row links to `https://clinicaltrials.gov/study/<NCT>`.
- Do not include any model identifier in commits, code or docs.

## Review Focus

1. **Enrollment from null/0 to a number** — must record a change, not crash on division, and not be marked notable by the 20% rule. Test in Task 6.
2. **Date precision refinement** (`2027-03` → `2027-03-15`) — a reasonable person reads this as a refinement, not a 14-day slip: record the change with `delta_days = 0`, not notable. Test in Task 6.
3. **Same study returned on two pages** (registry updates mid-crawl shift pagination) — must not fail the run as a duplicate; client de-duplicates keeping the last occurrence. Test in Task 3.
4. **Cosmetic text differences** (extra whitespace, case, reordered list items, NBSP) in outcomes/conditions/interventions — must produce no change rows. Test in Task 5.
5. **Empty and unknown states in the UI** — baseline day / empty window shows "No changes in the last N days"; unknown NCT in URL shows "Trial not found"; missing `meta.json` shows "Freshness unknown". Tests in Tasks 12–13.

---

## File Structure

```
pipeline/
  pyproject.toml                    # uv project, deps, ruff/mypy/pytest config, `trialradar` script
  src/trialradar/__init__.py
  src/trialradar/config.py          # AreaConfig (pydantic) + load_config
  src/trialradar/ctgov/__init__.py
  src/trialradar/ctgov/query.py     # build_params(cfg) -> dict  (pure)
  src/trialradar/ctgov/client.py    # CtGovClient: data_timestamp, iter_studies (retry, dedupe)
  src/trialradar/snapshot.py        # write/read raw/YYYY-MM-DD.jsonl.gz
  src/trialradar/textnorm.py        # norm_text, alias lookup (shared by normalize + tracked)
  src/trialradar/normalize.py       # raw studies -> Tables
  src/trialradar/tables.py          # Tables dataclass + polars schemas for every table
  src/trialradar/tracked.py         # tracked_state(tables) -> {nct: {field: value}}, tracked_hash
  src/trialradar/diff.py            # diff(prev, curr, cfg, date) -> trial_change DataFrame
  src/trialradar/quality.py         # check(raw, tables, prev, cfg) -> QualityReport
  src/trialradar/store.py           # Parquet state on data dir (current/, previous/, history/)
  src/trialradar/export.py          # view JSON for the site
  src/trialradar/pipeline.py        # run(...) orchestration, rebuild(...)
  src/trialradar/cli.py             # argparse entry: run / check / rebuild
  scripts/record_fixtures.py        # one-off: record real API fixtures (needs network)
  tests/conftest.py                 # make_study() builder, cfg fixture
  tests/unit/...                    # one test file per module
  tests/integration/test_pipeline.py
  tests/live/test_live_api.py
  tests/fixtures/{studies,http}/    # recorded real responses
config/area.yaml
config/aliases/sponsor.csv
config/aliases/intervention.csv
web/                                # Vite React TS app
  src/{main.tsx,App.tsx,types.ts,data.ts}
  src/components/{FreshnessBadge,ChangesFeed,ChangeRow,TrialDetail,Methods}.tsx
  src/lib/format.ts
  tests/*.test.tsx, tests/fixtures/data/...
  e2e/smoke.spec.ts, playwright.config.ts
.github/workflows/{ci.yml,daily.yml,live-check.yml,record-fixtures.yml}
.github/dependabot.yml
README.md, SECURITY.md, .gitignore
```

### Shared data shapes (referenced by many tasks)

**`Tables`** (`tables.py`): frozen dataclass of polars DataFrames `trial, condition, intervention, sponsor, site, outcome`, with `Tables.empty()` and module-level `SCHEMAS: dict[str, dict[str, pl.DataType]]`. Columns exactly as spec §5. `phases` is `pl.List(pl.Utf8)` sorted. Dates are `pl.Date`; precision columns `pl.Utf8` in `{"day","month"}`; type columns `{"ACTUAL","ESTIMATED"}` or null.

**Tracked state** (`tracked.py`): `TrackedState = dict[str, dict[str, Any]]` keyed by NCT ID; values are JSON-serialisable. Date fields are `{"date": "YYYY-MM-DD", "precision": "day"|"month", "type": ...}` or `None`. List fields are sorted lists of normalised strings; outcomes are sorted lists of `[measure, time_frame]` pairs.

**`trial_change` columns:** `nct_id, field, old_value (Utf8 JSON), new_value (Utf8 JSON), detected_date (Date), registry_update_date (Date), delta_days (Int64, nullable), notable (Boolean), notable_reason (Utf8, nullable)`.

---

### Task 1: Repo scaffold, config loader, pipeline CI

**Files:**
- Create: `pipeline/pyproject.toml`, `pipeline/src/trialradar/__init__.py`, `pipeline/src/trialradar/config.py`, `config/area.yaml`, `config/aliases/sponsor.csv`, `config/aliases/intervention.csv`, `.gitignore`, `.github/workflows/ci.yml`, `.github/dependabot.yml`
- Test: `pipeline/tests/unit/test_config.py`, `pipeline/tests/conftest.py`

**Interfaces:**
- Produces:
  - `class AreaConfig(BaseModel)` with fields: `name: str`, `conditions: list[ConditionSpec]` (`ConditionSpec(label: str, synonyms: list[str])`, min 1 synonym), `study_type: Literal["INTERVENTIONAL"]`, `phases: list[Literal["EARLY_PHASE1","PHASE1","PHASE2","PHASE3","PHASE4","NA"]]` (min 1), `tracked_fields: list[str]`, `thresholds: Thresholds` (`enrollment_rel_change: float = 0.20`, `date_slip_days: int = 90`, `row_drop_warn: float = 0.10`, `max_null_rate: float = 0.0`), `aliases_dir: Path`.
  - `load_config(path: Path) -> AreaConfig` — resolves `aliases_dir` relative to the YAML file; raises `ConfigError(ValueError)` with the pydantic message on invalid input; rejects unknown keys (`extra="forbid"`) and unknown `tracked_fields` names (allowed set = spec §6 list, exported as `TRACKED_FIELDS: tuple[str, ...]`).
  - `conftest.py`: fixture `cfg` (loads repo `config/area.yaml`) and helper `make_study(nct_id="NCT00000001", **overrides) -> dict` returning a minimal valid v2 study dict (`protocolSection` with identification/status/design/sponsorCollaborators/conditions/armsInterventions/outcomes/contactsLocations modules) where overrides are dotted paths, e.g. `make_study(**{"statusModule.overallStatus": "TERMINATED"})`.

- [ ] **Step 1: Scaffold** — `uv init --package --name trialradar pipeline` (src layout); add deps `polars httpx pydantic pyyaml`; dev deps `pytest ruff mypy types-PyYAML pip-audit`; `[project.scripts] trialradar = "trialradar.cli:main"`; pytest marker `live` and `addopts = "-m 'not live'"`; ruff `line-length = 100`, mypy `strict = true`. `.gitignore`: `.venv/`, `__pycache__/`, `node_modules/`, `web/dist/`, `web/public/data/`, `/data/`, `/raw/`.

- [ ] **Step 2: Write `config/area.yaml`** with `name: neuroimmunology`, the six conditions from spec §3 each with synonyms (e.g. NMOSD: `["neuromyelitis optica", "NMOSD", "Devic"]`; MOGAD: `["MOG antibody disease", "MOGAD", "myelin oligodendrocyte glycoprotein"]`; CIDP: `["chronic inflammatory demyelinating polyneuropathy", "CIDP"]`), `study_type: INTERVENTIONAL`, all six phases, all spec §6 tracked fields, default thresholds, `aliases_dir: aliases`. Alias CSVs: header `raw,normalized` only.

- [ ] **Step 3: Write failing tests** in `test_config.py`:

```python
def test_repo_config_loads(cfg):
    assert cfg.name == "neuroimmunology"
    assert len(cfg.conditions) == 6
    assert set(cfg.phases) == {"EARLY_PHASE1","PHASE1","PHASE2","PHASE3","PHASE4","NA"}
    assert cfg.thresholds.enrollment_rel_change == 0.20
    assert cfg.thresholds.date_slip_days == 90
    assert cfg.aliases_dir.is_dir()

@pytest.mark.parametrize("patch", [
    {"phases": []}, {"phases": ["PHASE5"]}, {"study_type": "OBSERVATIONAL"},
    {"tracked_fields": ["not_a_field"]}, {"surprise": 1},
])
def test_invalid_config_rejected(tmp_path, patch): ...  # write repo yaml merged with patch; expect ConfigError
```

- [ ] **Step 4:** Run `cd pipeline && uv run pytest tests/unit/test_config.py -v` → FAIL (import error).
- [ ] **Step 5: Implement `config.py`.**
- [ ] **Step 6:** Run tests → PASS. Run `uv run ruff check . && uv run mypy src` → clean.
- [ ] **Step 7: CI** — `ci.yml` job `pipeline` on push + pull_request: checkout, `astral-sh/setup-uv` (pinned major), `uv sync --locked`, ruff, mypy, pytest, `uv run pip-audit`. `dependabot.yml`: ecosystems `pip` (`/pipeline`), `npm` (`/web`), `github-actions` (`/`), weekly.
- [ ] **Step 8: Commit** `feat: scaffold pipeline package, area config, CI`.

---

### Task 2: Record real API fixtures (needs network to clinicaltrials.gov)

Run after Task 1 and before Task 10 (whose integration test consumes `sample20.jsonl`). Tasks 1 and 3–9 need no network. If the session cannot reach `clinicaltrials.gov`, run it via the `record-fixtures.yml` workflow and commit the downloaded artifact. **Do not hand-write these fixtures.**

**Files:**
- Create: `pipeline/scripts/record_fixtures.py`, `.github/workflows/record-fixtures.yml`, `pipeline/tests/fixtures/studies/*.json`, `pipeline/tests/fixtures/http/version.json`
- Test: `pipeline/tests/unit/test_fixtures_present.py`, `pipeline/tests/unit/test_record_predicates.py`

**Interfaces:**
- Produces: `tests/fixtures/studies/<label>.json` (single raw study each) for labels `month_date`, `multi_phase`, `no_sites`, `no_enrollment`, `terminated_with_reason`, `many_sites`, plus `tests/fixtures/studies/sample20.jsonl` (20 raw studies) and `tests/fixtures/http/version.json`.

- [ ] **Step 1: Write failing test** asserting each labelled file exists, parses, has `protocolSection.identificationModule.nctId`, and that each satisfies its predicate (e.g. `month_date`: `startDateStruct.date` matches `^\d{4}-\d{2}$`; `no_sites`: no `contactsLocationsModule.locations`; `multi_phase`: `len(phases) >= 2`; `terminated_with_reason`: status `TERMINATED` and `whyStopped` present). `sample20.jsonl` has 20 lines with distinct NCT IDs.
  Also `test_record_predicates.py`: each selection predicate in `record_fixtures.py` accepts a matching `make_study(...)` and rejects a non-matching one (no network). `test_fixtures_present.py` is committed together with the recorded fixtures, never before, so CI never goes red waiting on a recording.
- [ ] **Step 2:** Run → FAIL (missing files).
- [ ] **Step 3: Implement `record_fixtures.py`** — uses plain httpx with `build_params`-equivalent inline params from `config/area.yaml` (keep it standalone; it runs once), pages through up to 3,000 studies, picks the first study matching each predicate, writes files. `record-fixtures.yml`: `workflow_dispatch`, runs the script, uploads `pipeline/tests/fixtures/` as artifact.
- [ ] **Step 4:** Run the script (locally or via the workflow, then unpack the artifact) and re-run the test → PASS.
- [ ] **Step 5: Commit** `test: record real ClinicalTrials.gov fixtures`.

---

### Task 3: ClinicalTrials.gov client

**Files:**
- Create: `pipeline/src/trialradar/ctgov/__init__.py`, `ctgov/query.py`, `ctgov/client.py`
- Test: `pipeline/tests/unit/test_ctgov_query.py`, `pipeline/tests/unit/test_ctgov_client.py`

**Interfaces:**
- Consumes: `AreaConfig` (Task 1).
- Produces:
  - `build_params(cfg: AreaConfig) -> dict[str, str]` → `{"query.cond": "<all synonyms joined with ' OR ', each multi-word synonym in double quotes>", "filter.advanced": "AREA[StudyType]INTERVENTIONAL AND (AREA[Phase]EARLY_PHASE1 OR AREA[Phase]PHASE1 OR ...)", "pageSize": "1000", "format": "json"}`.
  - `class CtGovClient(http: httpx.Client | None = None, base_url: str = "https://clinicaltrials.gov/api/v2", sleep: Callable[[float], None] = time.sleep)`.
  - `CtGovClient.data_timestamp() -> str` — GET `/version`, returns `dataTimestamp`.
  - `CtGovClient.iter_studies(cfg: AreaConfig) -> Iterator[dict[str, Any]]` — paginates; yields each study once, de-duplicated by NCT ID keeping the **last** occurrence (buffer all, then yield in first-seen order).
  - `class CtGovError(RuntimeError)` raised after retries are exhausted or on non-retryable 4xx.

- [ ] **Step 1: Failing tests** (`httpx.MockTransport`, no real network; `sleep` stub records delays):

```python
def test_build_params_uses_config_only(cfg): ...      # every synonym appears; "INTERVENTIONAL"; each phase in filter.advanced; pageSize "1000"
def test_paginates_until_no_token(): ...              # 3 pages -> all studies yielded; pageToken sent on pages 2-3
def test_dedupes_study_seen_on_two_pages(): ...       # NCT1 on page1 and page2 (different lastUpdate) -> yielded once, page2 version
def test_retries_429_and_5xx_then_succeeds(): ...     # 429, 503, 200 -> success; 2 sleeps, second > first
def test_gives_up_after_5_retries(): ...              # always 503 -> CtGovError; exactly 6 requests
def test_non_retryable_400_raises_immediately(): ...  # 1 request, CtGovError
def test_data_timestamp(): ...                        # returns dataTimestamp from /version body
def test_timeout_is_30s(): ...                        # default client constructed with timeout 30
```

- [ ] **Step 2:** Run `uv run pytest tests/unit/test_ctgov_*.py -v` → FAIL.
- [ ] **Step 3: Implement.** Backoff delay for attempt *n* (0-based): `min(60, 2**n) * random.uniform(0.5, 1.5)`; honour `Retry-After` seconds on 429 if present.
- [ ] **Step 4:** Run → PASS; ruff + mypy clean.
- [ ] **Step 5: Commit** `feat: ClinicalTrials.gov v2 client with retry and dedupe`.

---

### Task 4: Raw snapshot files

**Files:**
- Create: `pipeline/src/trialradar/snapshot.py`
- Test: `pipeline/tests/unit/test_snapshot.py`

**Interfaces:**
- Produces: `write_snapshot(raw_dir: Path, day: date, studies: Iterable[dict]) -> Path` (writes `raw_dir/YYYY-MM-DD.jsonl.gz`, one study per line, overwrites atomically via temp file + rename); `read_snapshot(path: Path) -> list[dict]`; `list_snapshots(raw_dir: Path) -> list[tuple[date, Path]]` sorted ascending.

- [ ] **Step 1: Failing tests:** round-trip equality; overwrite same day replaces content; `list_snapshots` ignores non-matching filenames and sorts by date; file is gzip (magic bytes `1f 8b`).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: gzipped JSONL raw snapshots`.

---

### Task 5: Text normalisation, tables and normalize

**Files:**
- Create: `pipeline/src/trialradar/textnorm.py`, `tables.py`, `normalize.py`
- Test: `pipeline/tests/unit/test_textnorm.py`, `pipeline/tests/unit/test_normalize.py`

**Interfaces:**
- Consumes: `make_study` (Task 1). Uses only built studies; recorded-fixture tests live in Task 7.
- Produces:
  - `norm_text(s: str | None) -> str | None` — NFKC, replace NBSP, strip, collapse internal whitespace. Returns `None` for `None`/empty.
  - `norm_key(s: str) -> str` — `norm_text(s).casefold()`.
  - `load_aliases(path: Path) -> dict[str, str]` — keys via `norm_key(raw)`; `apply_alias(name: str, aliases) -> str` returns mapped value or `norm_text(name)`.
  - `parse_ct_date(s: str | None) -> tuple[date | None, str | None]` — `"2023-05"` → `(date(2023,5,1), "month")`; `"2023-05-14"` → `(…, "day")`; `None` → `(None, None)`; anything else raises `ValueError`.
  - `Tables`, `SCHEMAS` per "Shared data shapes".
  - `normalize(studies: Iterable[dict], aliases_dir: Path) -> Tables`. Sponsor rows: lead (`role="lead"`) + each collaborator. `intervention.name_normalized` and `sponsor.name_normalized` via `apply_alias` using `intervention.csv` / `sponsor.csv`. `trial.lead_sponsor` is the normalised lead name.

- [ ] **Step 1: Failing tests:**

```python
def test_norm_text_collapses_and_nfkc():
    assert norm_text("  Expanded Disability   Status ") == "Expanded Disability Status"
def test_parse_ct_date_month_and_day(): ...
def test_parse_ct_date_rejects_garbage(): ...
def test_alias_case_insensitive(tmp_path): ...       # "ROCHE " and "roche" both -> "Roche"
def test_normalize_month_date(): ...                 # startDateStruct.date "2023-05" -> 2023-05-01, precision "month"
def test_normalize_multi_phase_sorted(): ...          # phases ["PHASE3","PHASE2"] -> ["PHASE2","PHASE3"]
def test_normalize_no_sites_and_no_enrollment(): ...  # site table has 0 rows for it; enrollment null
def test_normalize_child_tables(): ...                # 2 conditions, 1 lead + 1 collaborator, 1 primary + 2 secondary outcomes
def test_normalize_schemas_match(): ...               # every table's schema == SCHEMAS[name], also for Tables.empty()
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS; ruff + mypy clean.
- [ ] **Step 5: Commit** `feat: normalize raw studies into typed tables`.

---

### Task 6: Tracked state and change detection

**Files:**
- Create: `pipeline/src/trialradar/tracked.py`, `pipeline/src/trialradar/diff.py`
- Test: `pipeline/tests/unit/test_tracked.py`, `pipeline/tests/unit/test_diff.py`

**Interfaces:**
- Consumes: `Tables`, `normalize`, `norm_key` (Task 5); `AreaConfig` (Task 1).
- Produces:
  - `tracked_state(tables: Tables, fields: Sequence[str]) -> TrackedState`. Field sources: `overall_status, why_stopped, phases, enrollment, enrollment_type, lead_sponsor` from `trial`; the three dates as date dicts; `primary_outcomes`/`secondary_outcomes` as sorted unique `[norm_key(measure), norm_key(time_frame)]`; `interventions` sorted unique `norm_key(name_normalized)`; `conditions` sorted unique `norm_key`; `site_countries` sorted unique; `site_count` int.
  - `tracked_hash(fields: dict[str, Any]) -> str` — SHA-256 hex of `json.dumps(fields, sort_keys=True, separators=(",", ":"))`.
  - `diff(prev: TrackedState | None, curr: TrackedState, registry_dates: dict[str, date], cfg: AreaConfig, day: date) -> pl.DataFrame` (`trial_change` schema). `prev is None` → empty frame (baseline).

**Algorithm decisions (not determined by signature):**
- For NCT in both: skip if hashes equal; else one row per tracked field whose value differs.
- NCT only in `curr`: one row `field="_tracked", old=null, new="added"`. Only in `prev`: `old="present", new="removed"`, `registry_update_date` null.
- Values serialised with the same `json.dumps` as `tracked_hash`.
- Date fields: `delta_days = (new.date - old.date).days` when both non-null; **if `old.precision == "month"` and new date is in the same calendar month, `delta_days = 0`.**
- Notable reasons (first match wins, order): `"status_change"`, `"primary_endpoint_change"`, `"enrollment_change_ge_20pct"` (only when old is a positive int and new is an int), `"date_slip_ge_90d"` (only `primary_completion_date`/`completion_date`, `delta_days >= cfg.thresholds.date_slip_days`).

- [ ] **Step 1: Failing tests** (build states with `make_study` → `normalize` → `tracked_state`):

```python
def test_baseline_emits_nothing(): assert diff(None, curr, ...).height == 0
def test_identical_states_emit_nothing(): ...
def test_cosmetic_text_changes_emit_nothing(): ...   # outcome measure whitespace/case/NBSP + reordered conditions
def test_status_change_is_notable(): ...             # RECRUITING -> TERMINATED: notable, reason "status_change", values JSON '"RECRUITING"'
def test_primary_outcome_change_is_notable(): ...
def test_enrollment_threshold(): ...                 # 100->119 not notable; 100->120 notable; 100->80 notable
def test_enrollment_from_null_or_zero_not_notable(): # None->50 and 0->50: row present, notable False, no exception
def test_primary_completion_slip(): ...              # +89 days not notable; +90 notable, delta_days 90; -120 delta -120 not notable
def test_start_date_slip_never_notable(): ...        # +200 days on start_date: notable False
def test_month_precision_refinement(): ...           # "2027-03" -> "2027-03-15": delta_days 0, not notable
def test_added_and_removed(): ...
def test_registry_update_date_populated(): ...
def test_tracked_hash_stable_under_key_order(): ...
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS; ruff + mypy clean.
- [ ] **Step 5: Commit** `feat: field-level change detection with notable rules`.

---

### Task 7: Data quality checks

**Files:**
- Create: `pipeline/src/trialradar/quality.py`
- Test: `pipeline/tests/unit/test_quality.py`

**Interfaces:**
- Consumes: `Tables` (Task 5), `AreaConfig` (Task 1).
- Produces: `@dataclass QualityReport(errors: list[str], warnings: list[str])` with property `ok: bool`; `check(raw: Sequence[dict], tables: Tables, prev_trial_count: int | None, cfg: AreaConfig) -> QualityReport`; `KNOWN_STATUSES: frozenset[str]` = the 14 v2 `overallStatus` values (`ACTIVE_NOT_RECRUITING, COMPLETED, ENROLLING_BY_INVITATION, NOT_YET_RECRUITING, RECRUITING, SUSPENDED, TERMINATED, WITHDRAWN, AVAILABLE, NO_LONGER_AVAILABLE, TEMPORARILY_NOT_AVAILABLE, APPROVED_FOR_MARKETING, WITHHELD, UNKNOWN`).

Errors (exact message prefixes, used by tests): `"schema:"` — a raw study lacks `protocolSection.identificationModule.nctId`, `...briefTitle`, or `...statusModule.overallStatus`; `"null_rate:"` — null share of `nct_id`, `title`, `overall_status` exceeds `max_null_rate`; `"date_order:"` — completion < start with both `ACTUAL`; `"duplicate:"` — repeated `nct_id` in `trial`; `"empty:"` — zero trials. Warnings: `"row_drop:"` (drop > `row_drop_warn`), `"unknown_status:"`, `"date_order_estimated:"`.

- [ ] **Step 1: Failing tests:** add `test_normalize_recorded.py`: `month_date.json` normalises to precision `"month"`, first of month; every line of `sample20.jsonl` normalises (20 trial rows, schemas match `SCHEMAS`) and passes `quality.check` with no errors. In `test_quality.py`: one passing and one failing case per error and warning above; a clean `sample20` run → `ok` and no warnings; first run (`prev_trial_count=None`) emits no `row_drop`; drop of exactly 10% is not a warning, 10.1% is.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: data quality checks`.

---

### Task 8: Parquet store

**Files:**
- Create: `pipeline/src/trialradar/store.py`
- Test: `pipeline/tests/unit/test_store.py`

**Interfaces:**
- Consumes: `Tables`, `SCHEMAS` (Task 5); `trial_change` schema (Task 6).
- Produces (data dir layout `current/<table>.parquet`, `current/state.json` = `{"state_date": "YYYY-MM-DD", "data_timestamp": "..."}`, `previous/` same shape, `history/{trial_change,trial_snapshot,run_log}.parquet`):
  - `class Store(root: Path)`
  - `Store.state_before(day: date) -> tuple[Tables, date] | None` — returns `current/` if its `state_date < day`, else `previous/` if present and `< day`, else `None`.
  - `Store.save_state(tables: Tables, day: date, data_timestamp: str) -> None` — if `current/state_date < day`, move `current/` → `previous/` (replacing it) first; then write `current/`. Same day → overwrite `current/` only.
  - `Store.replace_day(day: date, changes: pl.DataFrame, snapshots: pl.DataFrame) -> None` — deletes history rows for `day` (`detected_date` / `snapshot_date`), appends new.
  - `Store.append_run(row: dict[str, Any]) -> None`; `Store.run_log() -> pl.DataFrame`; `Store.changes() -> pl.DataFrame`; `Store.last_success_timestamp() -> str | None`.
  - `RUN_LOG_SCHEMA`, `SNAPSHOT_SCHEMA` constants (spec §5).

- [ ] **Step 1: Failing tests:** empty dir → `state_before` None, `changes()` empty with schema; save D1 then `state_before(D2)` is D1; save D1, save D2, `state_before(D2)` is D1 (re-run same day diffs against yesterday); `replace_day` twice for same day leaves one copy; `last_success_timestamp` ignores `failed`/`skipped` rows; all writes go through temp file + rename.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: Parquet state store with same-day idempotency`.

---

### Task 9: Site JSON export

**Files:**
- Create: `pipeline/src/trialradar/export.py`
- Test: `pipeline/tests/unit/test_export.py`

**Interfaces:**
- Consumes: `Tables` (Task 5), `Store.changes()`, `Store.run_log()` (Task 8).
- Produces: `export(tables: Tables, changes: pl.DataFrame, run_log: pl.DataFrame, cfg: AreaConfig, day: date, out_dir: Path) -> None` writing (UTF-8, sorted keys):
  - `changes/{1,7,30}d.json`: `{"window_days": N, "generated_for": "YYYY-MM-DD", "changes": [ChangeItem]}` with `detected_date > day - N days`, newest first, then NCT ID. `ChangeItem = {nct_id, title, lead_sponsor, field, old_value, new_value, detected_date, delta_days, notable, notable_reason, source_url}` where `old_value`/`new_value` are decoded JSON and `source_url = "https://clinicaltrials.gov/study/<NCT>"`. Title/sponsor null for removed trials.
  - `trials/<NCT>.json` for every current trial: `{nct_id, title, phases, overall_status, why_stopped, start_date, primary_completion_date, completion_date (each {date, precision, type} or null), enrollment, enrollment_type, lead_sponsor, sponsor_class, conditions, interventions [{type,name}], countries, site_count, primary_outcomes [{measure,time_frame}], changes [ChangeItem, all-time, newest first], source_url}`.
  - `meta.json`: `{area: cfg.name, conditions: [labels], last_success_at, data_timestamp, generated_for, trial_count, warnings}` from the latest `success` run_log row.
  - Removes stale `trials/*.json` not in current tables.

- [ ] **Step 1: Failing tests:** window boundaries (change exactly N days old excluded, N-1 included); ordering; decoded values; trial file written per trial and stale one removed; `meta.json` warnings come from latest success row; removed-trial change has `title: null`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: export site JSON views`.

---

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

### Task 11: Scheduled workflows

**Files:**
- Create: `.github/workflows/daily.yml`, `.github/workflows/live-check.yml`
- Test: `pipeline/tests/unit/test_workflows.py` (parses YAML and asserts structure)

**Interfaces:**
- Consumes: CLI (Task 10); `web` build script `npm run build` (Task 12).

- [ ] **Step 1: Failing test** asserting `daily.yml`: `on.schedule[0].cron == "17 7 * * *"`, has `workflow_dispatch`; `concurrency.group == "daily"` and `cancel-in-progress` false; permissions exactly `{contents: write, pages: write, id-token: write}`; contains steps named `Run pipeline`, `Push data branch`, `Upload raw snapshot`, `Build site`, `Deploy Pages`, `Keepalive`. `live-check.yml`: weekly schedule, runs `pytest -m live`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Write workflows.** `daily.yml` job outline:
  1. checkout `main`; checkout `data` branch into `./data` with `continue-on-error` (first run: empty dir).
  2. setup-uv, `uv sync --locked`; `uv run trialradar run --data-dir ../data --raw-dir ../raw --site-dir ../web/public/data` (working dir `pipeline`). Step `id: run`; steps 3–6 run only `if: steps.run.outputs.status == 'success'`; step 7 always runs.
  3. `Push data branch`: in `./data`: `git checkout --orphan data-tmp && git add -A && git commit -m "data: <date>" && git push -f origin HEAD:data`.
  4. `Upload raw snapshot`: `gh release view snapshots-YYYY-MM || gh release create snapshots-YYYY-MM --title ... --notes "Raw ClinicalTrials.gov snapshots"`; `gh release upload snapshots-YYYY-MM raw/*.jsonl.gz --clobber`.
  5. `Build site`: setup-node 22, `npm ci && npm run build` in `web` with `BASE_PATH=/<repo>/`.
  6. `Deploy Pages`: `actions/upload-pages-artifact` (path `web/dist`) + `actions/deploy-pages`.
  7. `Keepalive`: `gautamkrishnar/keepalive-workflow` pinned to a release tag (API mode, no commits).
- [ ] **Step 4:** Run test → PASS. Lint workflows with `actionlint` if available (`go run github.com/rhysd/actionlint/cmd/actionlint@latest` or the docker image); fix findings.
- [ ] **Step 5: Commit** `ci: daily pipeline, Pages deploy, weekly live check`.

---

### Task 12: Web app scaffold, data layer, Changes feed, freshness badge

**Files:**
- Create: `web/` via `npm create vite@latest web -- --template react-ts`; `web/src/types.ts`, `web/src/data.ts`, `web/src/lib/format.ts`, `web/src/App.tsx`, `web/src/components/{FreshnessBadge,ChangesFeed,ChangeRow}.tsx`, `web/tests/fixtures/data/{meta.json,changes/1d.json,changes/7d.json,changes/30d.json,trials/NCT00000001.json}`, `web/tests/setup.ts`
- Modify: `web/vite.config.ts` (`base: process.env.BASE_PATH ?? "/"`, Vitest config jsdom), `.github/workflows/ci.yml` (add `web` job: `npm ci`, `npm run lint`, `npx tsc --noEmit`, `npx vitest run`, `npm audit --audit-level=high`)
- Test: `web/tests/ChangesFeed.test.tsx`, `web/tests/FreshnessBadge.test.tsx`, `web/tests/format.test.ts`

**Interfaces:**
- Consumes: JSON shapes from Task 9 (`ChangeItem`, trial file, `meta.json`). Fixture JSON in `web/tests/fixtures/data/` must be produced by running the Task 10 integration fixture through `export`, not hand-written — add `pipeline/scripts/make_web_fixtures.py` that does this and commit its output.
- Produces:
  - `types.ts`: `ChangeItem`, `ChangesFile`, `TrialFile`, `Meta`, `DateInfo` mirroring Task 9 exactly.
  - `data.ts`: `fetchJson<T>(path: string): Promise<T | null>` (null on 404), `loadChanges(window: 1|7|30)`, `loadTrial(nct: string)`, `loadMeta()`; base = `import.meta.env.BASE_URL + "data/"`.
  - `format.ts`: `formatValue(field: string, v: unknown): string` (dates → `"Mar 2027"` for month precision, `"15 Mar 2027"` for day; lists joined with `", "`; null → `"—"`), `formatDelta(days: number | null): string` (`"slipped 120 days"`, `"pulled in 30 days"`, `""` for 0/null), `isStale(lastSuccessIso: string, now: Date): boolean` (> 36 h).
  - `<App>`: `HashRouter`; routes `/changes` (default redirect), `/trial/:nct`, `/methods`; header with `<FreshnessBadge>`.
  - `<ChangesFeed>`: tabs "1 day / 7 days / 30 days" (default 7), sponsor `<select>`, field `<select>` (options derived from data), "Notable only" checkbox (default checked). Table columns: Trial (link `#/trial/NCT…` + title), Field, Change (old → new + delta), Why notable, Source (external link).

- [ ] **Step 1: Failing tests:**

```tsx
test("defaults to 7 days, notable only", ...)          // fixture: 3 notable + 2 non-notable -> 3 rows
test("unchecking notable shows all", ...)
test("sponsor filter narrows rows", ...)
test("empty window shows message", ...)                // empty 1d.json -> "No changes in the last 1 day"
test("rows link to trial page and source", ...)        // href "#/trial/NCT..." and "https://clinicaltrials.gov/study/NCT..."
test("badge shows last update and data timestamp", ...)
test("badge warns when stale", ...)                    // last_success_at 37h before now -> text "Data may be stale"
test("badge handles missing meta", ...)                // 404 -> "Freshness unknown"
test("formatValue month vs day precision", ...)
test("formatDelta signs", ...)
```

- [ ] **Step 2:** Run `cd web && npx vitest run` → FAIL.
- [ ] **Step 3: Implement.** Semantic `<table>` with `<caption>` and `<th scope="col">`; filters are labelled form controls; mobile: table collapses to stacked cards under 640 px via CSS (no JS).
- [ ] **Step 4:** Run → PASS; `npm run lint`, `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** `feat(web): changes feed, freshness badge, data layer`.

---

### Task 13: Trial detail, Methods page, e2e

**Files:**
- Create: `web/src/components/TrialDetail.tsx`, `web/src/components/Methods.tsx`, `web/e2e/smoke.spec.ts`, `web/playwright.config.ts`
- Modify: `web/src/App.tsx` (wire routes), `.github/workflows/ci.yml` (web job: `npm run build`, copy `tests/fixtures/data` → `dist/data`, `npx playwright install --with-deps chromium`, `npx playwright test`)
- Test: `web/tests/TrialDetail.test.tsx`, `web/tests/Methods.test.tsx`

**Interfaces:**
- Consumes: `loadTrial`, `loadMeta`, `formatValue`, `formatDelta` (Task 12).
- Produces: `<TrialDetail>` reading `:nct`; `<Methods>`.

- [ ] **Step 1: Failing tests:**

```tsx
test("shows key facts", ...)                 // title, status, phases, sponsor, enrollment, three dates with precision formatting
test("timeline lists status and date changes newest first", ...)
test("full change history table", ...)
test("target placeholder is labelled", ...)  // text "Target: not yet mapped (coming in enrichment)"
test("unknown trial shows not found", ...)   // 404 -> "Trial not found" + link back to feed
test("source link", ...)                     // https://clinicaltrials.gov/study/<NCT>
test("methods lists conditions from meta and limitations", ...)  // each meta.conditions label; text mentions "registry" lag and "self-reported"
```

e2e `smoke.spec.ts`: open `/` → redirected to `#/changes`, at least one row visible → click first trial link → trial title visible → click "Methods" → heading "Methods" visible. Run at 375×812 viewport as a second project and assert no horizontal scroll (`document.documentElement.scrollWidth <= innerWidth`).

- [ ] **Step 2:** Run vitest → FAIL. **Step 3:** Implement. **Step 4:** `npx vitest run` and `npx playwright test` → PASS.
- [ ] **Step 5: Commit** `feat(web): trial detail, methods page, e2e smoke`.

---

### Task 14: README, SECURITY, config-swap check, go-live

**Files:**
- Create: `README.md`, `SECURITY.md`, `docs/architecture.md` (Mermaid diagram of spec §4.1 flow)
- Test: `pipeline/tests/integration/test_config_swap.py`

- [ ] **Step 1: Failing test** `test_config_swap`: copy `config/area.yaml` to tmp with conditions replaced by a single `{label: "Psoriasis", synonyms: ["psoriasis"]}`; `build_params` contains `psoriasis` and none of the neuroimmunology synonyms; `run` with the fake client over `sample20` succeeds (proves no code depends on area names). `grep -ri "sclerosis" pipeline/src web/src` returns nothing — assert via test walking source files.
- [ ] **Step 2:** Run → FAIL if any area names are hard-coded; fix until PASS.
- [ ] **Step 3: README** sections (parent spec's structure, slice-1 content): problem and user; existing tools and the gap — Cortellis (commercial, broad, paid), ClinicalTrials.gov saved-search alerts (free, per-search email, no field-level diff or notability), Clinical Trial Risk Tool (protocol-document risk scoring, not registry change tracking) — and what Trial Radar does not do; architecture (link `docs/architecture.md`); how to run locally (`uv run trialradar run --date ...`, `npm run dev`); how to change therapeutic area; data-use note (public CT.gov data, registry lag, sponsor self-reporting, not medical advice); evaluation/limitations placeholders explicitly marked "added in later slices"; status of the 14-day unattended-run clock.
- [ ] **Step 4: SECURITY.md**: how to report, no secrets in repo, `GITHUB_TOKEN` permissions used, dependency scanning (Dependabot, pip-audit, npm audit).
- [ ] **Step 5: Commit** `docs: README, SECURITY, architecture; config-swap test`.
- [ ] **Step 6: Go-live (human-in-the-loop):** push; in repo settings enable Pages source "GitHub Actions"; add branch protection on `main` requiring `ci` checks; trigger `daily.yml` via `workflow_dispatch`; verify run green, `data` branch exists, release `snapshots-YYYY-MM` has today's file, Pages URL shows the feed. Record day 1 of the 14-day clock in README.

---

## Spec coverage check

| Spec section | Tasks |
|---|---|
| §3 scope, default config | 1 |
| §4.1 storage/publishing, rebuild path | 8, 10, 11 |
| §4.2 units | 1, 3–10 |
| §4.3 run model, version skip | 3, 10 |
| §5 data model, aliases | 5, 6, 8 |
| §6 change detection | 6 |
| §7 workflows, errors, logging, security | 1, 3, 7, 10, 11, 14 |
| §8 frontend | 12, 13 |
| §9 testing | every task; live 10; e2e 13 |
| §10 layout | File Structure |
| §11 definition of done | 14 (config swap, README, go-live) |
| §12 risks | 3 (dedupe), 7, 8, 10 (failed run leaves data), 11 (keepalive) |
