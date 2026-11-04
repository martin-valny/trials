# Trial Radar — Slice 1 Design: Core Pipeline + Changes Feed

**Date:** 2026-11-04
**Status:** Draft for review
**Parent spec:** "Trial Radar, a zero-budget AI trial-intelligence app (v2 scope)" (provided in brainstorming session)

---

## 1. Intent

### What Trial Radar is
A public, daily-updating, $0-running-cost app tracking clinical trials in one therapeutic
area (default: neuroimmunology), linking trials to drug targets, genetic evidence and
preprints, flagging changes, answering cited questions and scoring termination risk.

### Why it is being built
Equally a **real, useful tool** and a **portfolio piece**. Consequence: every slice must
ship as a working, deployed, honest vertical slice — depth and correctness over breadth.

### Primary user
A clinical-operations or competitive-intelligence lead asking *"what changed in competitor
trials this week, and why does it matter?"*

### Hard constraints
- $0 running cost: GitHub Actions, GitHub Pages, local compute, free tiers only.
- Public data only; no personal data; no user accounts.
- New therapeutic area = config change only.

### Assumptions (stated, not confirmed)
- Solo developer, part-time.
- Python for pipeline/ML; TypeScript for frontend.

---

## 2. Decomposition of the parent spec

The parent spec contains six independent subsystems. Each gets its own spec → plan →
implementation cycle:

| # | Subsystem | Parent milestones | Status |
|---|---|---|---|
| 1 | **Core pipeline + thin frontend (this spec)** | 1–2, part of 4 | This document |
| 2 | Enrichment: Open Targets + drug→target mapping | 3 | Later |
| 3 | Full frontend: Landscape (DuckDB-WASM), Target page | 4 | Later |
| 4 | Preprints + RAG Q&A + eval set | 5–6 | Later |
| 5 | Risk model (includes historical backfill) | 7 | Later |
| 6 | Weekly briefing agent | 8 | Later |
| — | CTIS (v1.5), single-cell (v2) | 10–11 | Later |

**Moved out of slice 1:** the historical backfill of completed/terminated trials moves to
subsystem 5, where it is consumed.

---

## 3. Slice 1 scope

**In:**
- Daily ClinicalTrials.gov API v2 ingest of the tracked set.
- Raw daily snapshots, normalized tables, field-level change detection with "notable" flags.
- Data-quality checks that block bad data.
- Scheduled GitHub Actions run, data publishing, Pages deploy.
- Frontend: Changes feed, Trial detail, freshness badge, Methods stub.
- CI with lint, types, tests; README v1; SECURITY.md.

**Out:** everything in subsystems 2–6; observational studies; authentication.

### Default scope config (`config/area.yaml`)
- **Conditions:** multiple sclerosis, neuromyelitis optica spectrum disorder (NMOSD),
  MOG antibody-associated disease (MOGAD), myasthenia gravis, chronic inflammatory
  demyelinating polyneuropathy (CIDP), autoimmune encephalitis. Each condition has a list
  of search synonyms in config.
- **Study type:** interventional only.
- **Phases:** Early Phase 1, Phase 1, 2, 3, 4, and N/A.
- **Overall status:** all statuses (so terminations and completions are seen as changes).

---

## 4. Architecture

### 4.1 Storage and publishing (Approach 1: Parquet canonical, JSON views)

| Location | Contents | Lifecycle |
|---|---|---|
| `main` branch | Code, `config/area.yaml`, `config/aliases/*.csv`, docs | Normal git history |
| `data` branch | `current/*.parquet` (today's normalized tables); `history/trial_change.parquet`, `history/trial_snapshot.parquet`, `history/run_log.parquet` | Single commit, force-pushed each run (no history growth) |
| Release `snapshots-YYYY-MM` | `raw/YYYY-MM-DD.jsonl.gz` for each day of the month | Created on first run of month; assets appended daily |
| GitHub Pages | Built site + view JSON (`changes/1d.json`, `changes/7d.json`, `changes/30d.json`, `trials/<NCT>.json`, `meta.json`) | Redeployed each run |

**Constraint driving this:** GitHub Release asset downloads do not send CORS headers,
so the browser must read only from Pages. Releases are archival only.

**Rebuild path:** raw snapshots are kept indefinitely; every table can be rebuilt from raw
by replaying snapshots in date order (`trialradar rebuild`).

**Evolution path:** subsystem 3 adds DuckDB-WASM reading Parquet copied to Pages; no
pipeline redesign required.

### 4.2 Pipeline units

Python 3.12 package `trialradar` managed with `uv`. Only `ctgov.client` and `store`
perform I/O against the network or persistent storage; `snapshot` and `export` write
files; all other units are pure functions over dataframes.

| Unit | Responsibility | Interface |
|---|---|---|
| `config` | Load and validate `area.yaml` | `load_config(path) -> AreaConfig` |
| `ctgov.client` | Version check; paginated `/studies` search (pageSize 1000, `pageToken`); retry with backoff + jitter; timeouts | `data_timestamp() -> str`; `iter_studies(cfg) -> Iterator[dict]` |
| `snapshot` | Write/read raw daily snapshot | `write(date, studies)`; `read(date) -> list[dict]` |
| `normalize` | Raw → `trial`, `condition`, `intervention`, `sponsor`, `site`, `outcome` tables; apply alias CSVs | `normalize(studies, aliases) -> Tables` |
| `diff` | Field-level comparison of two normalized states; notable rules | `diff(prev, curr, cfg, date) -> DataFrame[trial_change]` |
| `quality` | Error and warning checks | `check(tables, prev_tables, cfg) -> QualityReport` |
| `store` | Read/write Parquet on the data branch working tree | `load_current()`, `save(tables, changes, snapshots, run_log)` |
| `export` | Write view JSON for the site | `export(tables, changes, meta, out_dir)` |
| `cli` | Entry points | `trialradar run`, `trialradar check`, `trialradar rebuild` |

### 4.3 Run model
- Full re-pull of the tracked set daily (expected low thousands of trials; a few pages).
- Before ingest, call the ClinicalTrials.gov `/version` endpoint; if `dataTimestamp`
  equals the last successful run's recorded timestamp, exit 0 with a `skipped` run_log row.

---

## 5. Data model (slice 1)

All tables keyed by `nct_id` unless noted.

- **`trial`**: `nct_id`, `title`, `phases` (list), `overall_status`, `why_stopped`,
  `start_date`, `start_date_precision` (`day`|`month`), `start_date_type`
  (`ACTUAL`|`ESTIMATED`), same three columns for `primary_completion_date` and
  `completion_date`, `enrollment`, `enrollment_type`, `lead_sponsor`, `sponsor_class`,
  `masking`, `allocation`, `last_update_post_date`.
  Month-precision dates are stored as the first of the month with precision `month`.
- **`condition`**: `nct_id`, `condition`.
- **`intervention`**: `nct_id`, `type`, `name`, `name_normalized`.
- **`sponsor`**: `nct_id`, `name`, `name_normalized`, `role` (`lead`|`collaborator`), `class`.
- **`site`**: `nct_id`, `facility`, `city`, `country`, `status`.
- **`outcome`**: `nct_id`, `kind` (`primary`|`secondary`), `measure`, `time_frame`, `description`.
- **`trial_snapshot`**: `nct_id`, `snapshot_date`, `tracked_hash` (SHA-256 of canonical
  JSON of tracked fields).
- **`trial_change`**: `nct_id`, `field`, `old_value` (JSON), `new_value` (JSON),
  `detected_date`, `registry_update_date`, `delta_days` (dates only, signed; positive = slip),
  `notable` (bool), `notable_reason` (nullable string).
- **`run_log`**: `run_id`, `started_at`, `duration_s`, `status`
  (`success`|`skipped`|`failed`), `data_timestamp`, `rows_ingested`, `changes_detected`,
  `warnings` (JSON list).

Alias CSVs (`config/aliases/sponsor.csv`, `config/aliases/intervention.csv`) have
columns `raw,normalized`. Matching is case-insensitive on whitespace-collapsed text.
Unmatched values pass through with whitespace collapsed.

---

## 6. Change detection

- **Tracked fields** (config-defined): `overall_status`, `why_stopped`, `phases`,
  `enrollment`, `enrollment_type`, `start_date`, `primary_completion_date`,
  `completion_date`, `primary_outcomes`, `secondary_outcomes`, `lead_sponsor`,
  `interventions`, `conditions`, `site_countries`, `site_count`.
- **Fast path:** if `tracked_hash` is unchanged for an NCT ID, skip field comparison.
- **List fields** compared as sets after normalization (trim, collapse whitespace,
  case-fold). Outcomes compared on `(measure, time_frame)`.
- **Dates:** a change emits `delta_days`; positive = slip, negative = pull-in.
- **Set membership:** trials entering the tracked set emit `field = "_tracked"`,
  `old = null`, `new = "added"`; trials leaving emit `old = "present"`, `new = "removed"`.
- **Notable rules** (thresholds in config):
  - any `overall_status` change
  - any `primary_outcomes` change
  - `enrollment` change with |relative change| ≥ 20%
  - date slip with `delta_days` ≥ 90 on `primary_completion_date` or `completion_date`
- **Baseline:** when no previous state exists, record state and emit zero changes.
- **Idempotency:** re-running for a date already processed deletes that date's
  `trial_change` and `trial_snapshot` rows before writing, and diffs against the
  last state strictly before that date. `run_log` is an append-only audit log (every
  attempt, including `failed` and `skipped`, adds a row); the latest `success` row defines
  the freshness shown in `meta.json`.
- **Raw snapshots are the source of truth.** A fetched snapshot is staged and promoted to
  `raw/YYYY-MM-DD.jsonl.gz` (with a `.meta.json` sidecar) only after the store write
  succeeds; a snapshot from a run that fails the data gate is quarantined as
  `*.failed.*`. A run for a date earlier than the stored state is refused before fetching.
  Snapshots hold every study fetched; the relevance filter (conditions, keywords and MeSH
  terms matched as whole phrases against the configured synonyms) is applied afterwards, so
  `rebuild` can replay history under a changed rule.

---

## 7. Scheduling and operations

### Workflows
- **`daily.yml`**: cron `17 7 * * *` + `workflow_dispatch`; `concurrency: daily` with
  no cancel-in-progress. Steps: version check → ingest → snapshot → normalize → quality →
  diff → store → export → push `data` branch → upload raw to monthly release → build and
  deploy Pages. Includes a keepalive step to prevent cron auto-disable after 60 days of
  repo inactivity.
- **`ci.yml`**: on push and PR. Pipeline: ruff, mypy, pytest (excluding `live`).
  Web: eslint, tsc, vitest, Playwright e2e. Dependency audit (pip-audit, npm audit).
- **`live-check.yml`**: weekly; runs `pytest -m live` against the real API to catch
  shape changes early.
- Dependabot enabled for pip, npm and GitHub Actions. Branch protection requires `ci.yml`.

### Error handling
- **Network:** 5 retries, exponential backoff with jitter, on connection errors, 429 and
  5xx; per-request timeout 30 s. Exhaustion fails the run; nothing is written.
- **Quality errors** (fail before `store`; live data unchanged):
  - schema mismatch on required raw paths
  - null rate above threshold on required fields (`nct_id`, `title`, `overall_status`)
  - completion date before start date when both are `ACTUAL`
  - duplicate `nct_id`
- **Quality warnings** (logged in `run_log` and `meta.json`; non-blocking):
  - row count drop > 10% vs previous run
  - unknown enum values
  - completion before start where either date is `ESTIMATED`
- **Notification:** GitHub's default failed-workflow email.
- **Logging:** one structured JSON line per stage (`stage`, `duration_s`, `rows`, `warnings`).

### Security
- No secrets needed for slice 1 beyond the default `GITHUB_TOKEN` (scoped
  `contents: write`, `pages: write`, `id-token: write` in `daily.yml` only).
- `SECURITY.md` and a data-use note in the README.

---

## 8. Frontend slice

Vite + React + TypeScript, deployed to GitHub Pages. Hash-based routing.

- **Changes feed** (`#/changes`, default route): tabs 1 / 7 / 30 days; filters for
  sponsor and field; "notable only" toggle, on by default. Row: NCT ID + title, field,
  old → new, `delta_days` for dates, notable reason, link to ClinicalTrials.gov.
- **Trial detail** (`#/trial/<NCT>`): key facts, timeline of status and date changes,
  full change history, ClinicalTrials.gov link, and a labelled placeholder
  "Target: not yet mapped (coming in enrichment)".
- **Freshness badge** in the header, from `meta.json`: last successful run time and
  registry data timestamp; shows a warning state if last success is > 36 h old.
- **Methods** (`#/methods`): data source, scope config, change-detection rules,
  known limitations (registry lag behind reality, sponsor self-reporting).
- Mobile-first, semantic HTML, accessible tables, keyboard navigable.

---

## 9. Testing

TDD throughout.

- **Unit (no network):**
  - `normalize`: real-study fixtures covering month-only dates, missing enrollment,
    multi-phase, no sites, aliases applied.
  - `diff`: set semantics, slip/pull-in, each notable rule at and around thresholds,
    added/removed, baseline, same-day re-run idempotency.
  - `quality`: a passing and a failing fixture per check.
  - `config`: valid and invalid YAML.
- **Client:** recorded HTTP responses covering pagination, retry on 429/5xx, version skip.
- **Live (`@pytest.mark.live`):** one real-API smoke test, weekly workflow only.
- **Integration:** ~20-study fixture across 3 simulated days, end to end; asserts Parquet
  tables, change rows and exported JSON.
- **Frontend:** Vitest + Testing Library for feed filters and trial detail; one Playwright
  e2e against a built site with fixture JSON.

---

## 10. Repository layout

```
pipeline/
  pyproject.toml
  src/trialradar/{config,snapshot,normalize,diff,quality,store,export,cli}.py
  src/trialradar/ctgov/client.py
  tests/{unit,integration,live}/ + tests/fixtures/
web/
  package.json, vite.config.ts, src/, tests/, e2e/
config/
  area.yaml
  aliases/sponsor.csv, aliases/intervention.csv
.github/
  workflows/ci.yml, daily.yml, live-check.yml
  dependabot.yml
docs/superpowers/{specs,plans}/
README.md
SECURITY.md
```

---

## 11. Definition of done (slice 1)

1. `daily.yml` runs green on schedule; Pages shows the Changes feed and Trial detail with
   real data.
2. Swapping `area.yaml` for a different condition list works with no code change,
   verified once with a throwaway config.
3. `ci.yml` is green and required on PRs.
4. README v1: problem and user, architecture sketch, how to run, limitations; plus
   `SECURITY.md`.
5. The 14-day unattended-run clock starts (tracking it does not block slice 2).

---

## 12. Risks (slice 1)

| Risk | Mitigation |
|---|---|
| API shape change | Schema check fails the run before writing; weekly live test |
| Cron auto-disabled after inactivity | Keepalive step |
| Noisy feed from cosmetic edits | Set comparison, normalization, notable-only default |
| Repo growth | Data branch force-pushed; raw in Releases |
| Bad data published | Quality errors block `store`; previous data stays live |
| Logic bug in diff discovered later | `trialradar rebuild` from raw snapshots |
