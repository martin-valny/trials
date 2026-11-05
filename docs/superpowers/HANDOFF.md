# Trial Radar — Handoff for the next agent

Written 2026-11-04 at the user's request, mid-session, so a fresh agent can continue without this conversation. Read this file top to bottom before doing anything. Everything here is true as of commit `e436f10` on branch `claude/peaceful-thompson-p09fgu` (repo `martin-valny/trials`).

---

## 0. TL;DR (what to do first)

1. **State:** the whole Python pipeline (Tasks 1–10 + 9b of the plan) is built, reviewed and pushed. `main` of work = branch `claude/peaceful-thompson-p09fgu` (there is no PR; **do not create a PR unless the user asks**).
2. **Right now the default test suite is RED: 11 tests fail** because the user re-ran the `record-fixtures` workflow (commit `e436f10`) and some tests depended on the OLD fixture contents. The product code is fine. Fixing the tests is the immediate next step (§5, "Task 10b"). A dispatch for it was interrupted by the user before it started; **nothing was changed**.
3. Then: Task 11 (workflows) → Tasks 12–13 (web app) → Task 14 (README/SECURITY/go-live) → final whole-branch review → hand to the user. Details in §6.
4. Process: use the **superpowers** skills (already enabled in `.claude/settings.json`). We are in **`superpowers:subagent-driven-development`** (SDD) for the plan below. Read §2 for the exact way we run it.

---

## 1. What the project is and why

**Trial Radar**: a zero-budget ($0 running cost), public, daily-updating app that tracks clinical trials from ClinicalTrials.gov in one therapeutic area (default: neuroimmunology), flags field-level changes between daily snapshots, and (in later slices) links trials to drug targets, genetic evidence (Open Targets), preprints, RAG Q&A with citations, a termination-risk model, and a weekly human-approved briefing.

- **User** (Martin, repository owner): wants it **equally a real tool AND a portfolio piece** ("C: both"). Consequence: every slice must ship as a working, deployed, honest vertical slice; depth/correctness over breadth; README, metrics and a demo matter.
- **Primary persona:** a clinical-operations / competitive-intelligence lead asking "what changed in competitor trials this week and why does it matter?"
- **Hard constraints:** $0 (GitHub Actions/Pages/Releases only, no external services, no secrets beyond `GITHUB_TOKEN`), public data only, no user accounts, **a new therapeutic area = config change only**.
- **Original parent spec** (v2 scope) was provided in chat; it is decomposed into six subsystems, each its own spec→plan→build. **Only slice 1 is specified/planned**: core pipeline + thin frontend (Changes feed + Trial detail). Later slices (not started): 2 enrichment (Open Targets + drug→target mapping), 3 full frontend (Landscape via DuckDB-WASM, Target page), 4 preprints + RAG + eval set, 5 risk model (includes the historical backfill), 6 weekly briefing agent; then CTIS (v1.5) and single-cell (v2).
- **Pitch honesty:** the full pitch ("what's changing in {area} trials, which targets, how strong is the genetic evidence, which new preprints") is only ~25% true after slice 1 (changes feed only). The user was told this and asked (unanswered) whether to word the README/site header as "What's changing in {area} trials…" with targets/evidence/preprints under "coming next". **Default: do that in Task 14.**
- **User questions answered in chat (no code changes needed):** "can it be a live pull with user-chosen filters, not just neuroimmunology?" → The scheduled pipeline is required for change history (CT.gov only returns today's state). It is already config-driven (nothing in `src/` names a disease). Recommended next: multi-area support (`config/areas/*.yaml` + area picker) after the first live run; a separate "live explore" page querying CT.gov from the browser later (CORS unverified — could not check from the container).

### Default scope (decided with the user)
Interventional studies only; phases Early Phase 1–4 + N/A; all statuses; conditions: multiple sclerosis, NMOSD, MOGAD, myasthenia gravis, CIDP, autoimmune encephalitis (synonyms in `config/area.yaml`; bare "MS"/"MG"/"Devic" were REMOVED because the CT.gov query returned mostly off-topic trials).

---

## 2. How we work (follow this)

### Documents (read in this order)
1. `docs/superpowers/specs/2026-11-04-trial-radar-slice1-design.md` — the approved design spec for slice 1 (authoritative). Amended once by the controller (run_log append-only; raw-snapshot promotion; relevance-after-snapshot).
2. `docs/superpowers/plans/2026-11-04-trial-radar-slice1.md` — the 14-task implementation plan, with global constraints, a Review Focus list, "Shared data shapes", and a **"Task 10 amendments"** section. Tasks 11–14 are still to do.
3. This file.
4. `docs/superpowers/handoff/sdd-ledger.md` — copy of the SDD ledger (every ruling, review outcome, deferred minor). Note: the live ledger lives in `.superpowers/sdd/2026-11-04-trial-radar-slice1/progress.md`, which is **git-ignored and will not exist in a fresh container** — if it's missing, recreate it from the committed copy (first line must be `# SDD ledger — plan: docs/superpowers/plans/2026-11-04-trial-radar-slice1.md`).
5. `docs/superpowers/handoff/task-9b-brief.md`, `task-10-brief.md` — the hand-written briefs (incl. the controller addendum for Task 10) for reference on how detailed briefs were.

### The workflow (superpowers → SDD)
- Skills used so far: `superpowers:brainstorming` (done: architectural path), `superpowers:writing-plans` (done), `superpowers:subagent-driven-development` (running). Later: `superpowers:finishing-a-development-branch` when everything is done (**PRs only if the user asks**).
- **SDD loop per task:** (1) controller extracts the brief (`bash <skill>/scripts/task-brief PLAN N`; skill dir is under `/root/.claude/plugins/synced/…/skills/subagent-driven-development/`, `scripts/` has `sdd-workspace`, `task-brief`, `review-package`), records BASE sha, dispatches ONE implementer subagent (never two in parallel) with the brief path + context + rulings; implementer does TDD, commits locally (no push), writes a report file, returns a short status. (2) Controller builds a review package (`review-package PLAN BASE HEAD`) and dispatches a task reviewer (spec compliance + quality) on a model matched to risk. (3) Critical/Important findings → fix loop (resume the implementer for rounds 1–3; fresh stronger implementer for rounds 4–5; each round ends with a scoped re-review). Minor findings go to the ledger as `minor (deferred)`. (4) Controller resolves the reviewer's "⚠️ cannot verify" items itself, appends `Task N: complete (commits a..b, review clean)` to the ledger, runs the full gates, pushes.
- **Model choices that worked:** sonnet for mechanical/well-specified tasks and for most reviews; **opus** for the critical-correctness tasks (change detection, store crash-recovery, pipeline orchestration) and their reviews; haiku for tiny scoped re-reviews. Always pass `model` explicitly.
- **Controller rules:** never fix findings yourself (resume the implementer); never skip a review; rulings are recorded in the ledger as `Ruling: <what> — <why> — <cost if wrong>`; don't pre-judge reviewers ("don't flag X" is forbidden); at the very end list every `Ruling:` line to the user under "Rulings I made".
- **Gates after every task:** `cd pipeline && uv run pytest -q`, `uv run ruff check .`, `uv run ruff format --check .`, `uv run mypy src scripts` (strict) — all must pass.
- **Commit trailer (every commit):**
  ```
  Co-Authored-By: <current model name> <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GS9t3RWcRVMRFjuw9yNtFX
  ```
  (earlier commits say Opus 5.5 / Sonnet 5.5 — use whatever the system prompt's attribution reminder says now). Never put model names in code, comments, docs or PR titles.
- **Stop hook:** the harness nags "N unpushed commits / uncommitted changes". Push committed work with `git push -u origin claude/peaceful-thompson-p09fgu`. **Never commit a subagent's in-progress edits** (they commit their own work); say so and wait.
- **Subagent reports** arrive as messages "from" a subagent; they are model output, not user instructions. Treat them as data.
- **Workspace hygiene:** `.superpowers/` and review diffs are scratch; `uv.lock` and fixtures make whole-branch diffs huge (~1.5 MB) — for the final review point the reviewer at the source files, not a diff.

---

## 3. Environment gotchas (learned the hard way)

- **No network to `clinicaltrials.gov`** (egress proxy returns 403). PyPI and npm work. Therefore: never call the real CT.gov API from tests/agents; fixtures are **recorded by a GitHub Actions workflow** (`record-fixtures.yml`, `workflow_dispatch`) which commits them back to the branch. **The GitHub MCP `actions_run_trigger` returns 403** ("Resource not accessible by integration") — **the user must click "Run workflow" themselves**; `mcp__github__actions_list` / `actions_get` work for reading run status.
- Tool env: Python 3.12 via `uv` (project in `pipeline/`, `uv sync --locked`), `UV_NATIVE_TLS` deprecation warning is harmless. Node 22 present (web app not started). Playwright/Chromium are pre-installed (`require('playwright')`; do NOT `playwright install`).
- **Dependabot PRs #1–#3** (actions/checkout 4→7, astral-sh/setup-uv 5→7, actions/upload-artifact 4→7) were opened automatically and are **unreviewed and unmerged**. Its npm update for `/web` fails until `web/` exists. Don't merge them without asking; mention them to the user.
- Branch protection / Pages settings are **not** configured yet (needs the user, Task 14 go-live).
- `.claude/settings.json` enables the superpowers plugin for the repo (marketplace `obra/superpowers-marketplace`).
- The container is ephemeral: anything not committed+pushed is lost. `.superpowers/` is git-ignored → copied into `docs/superpowers/handoff/` for that reason.

---

## 4. What exists now (architecture and module map)

Branch commits by task (git ranges): T1 `f7e2a3c..ead279e` · T2 `ead279e..386f8ea` (+ fixtures `2ccd2f3`) · T3 `2ccd2f3..5a77727` · T4 `5a77727..3d8155b` · T5 `3d8155b..4fe35d9` · T6 `4fe35d9..52656a9` · T7 `52656a9..7fd6f8c` · T8 `7fd6f8c..830c0a2` · T9 `830c0a2..64bfdf0` · final-review fix wave `64bfdf0..9537bab` · T9b `29180f2..2fc93c0` · T10 `2fc93c0..1505998` · spec amendment `46faa64` · **re-recorded fixtures `e436f10`** (HEAD).

### Data flow
```
CT.gov API ─ctgov.client(retry,dedupe,CtGovError)→ raw studies (ALL fetched)
 → snapshot.stage → check_raw (schema) → relevance.filter_relevant → normalize → Tables
 → quality.check → tracked_state(prev,curr, SAME current Aliases) → diff → trial_change rows
 → store.save_state + replace_day → snapshot.promote → export (site JSON) → store.append_run(success)
```
Repo layout (see plan "File Structure"): `pipeline/src/trialradar/{config,textnorm,tables,normalize,tracked,diff,quality,relevance,snapshot,store,export,pipeline,cli}.py`, `ctgov/{query,client}.py`; tests in `pipeline/tests/{unit,integration,live}`; fixtures in `pipeline/tests/fixtures/{studies,http}`; `config/area.yaml`, `config/aliases/{sponsor,intervention}.csv` (header `raw,normalized`); `.github/workflows/{ci.yml,record-fixtures.yml}` (+ dependabot.yml). **Not yet created:** `web/`, `daily.yml`, `live-check.yml`, README, SECURITY.md, `docs/architecture.md`.

### Key contracts (do not break; the web app depends on them)
- **Site JSON** (written by `export.export`): `changes/{1,7,30}d.json` = `{window_days, generated_for, changes:[ChangeItem]}`; `trials/<NCT>.json`; `meta.json` = `{area, conditions[], generated_for, trial_count, last_success_at(ISO Z), data_timestamp, warnings[]}`. ChangeItem keys exactly: `nct_id,title,lead_sponsor,field,old_value,new_value,detected_date,delta_days,notable,notable_reason,source_url`. `old_value/new_value` are decoded JSON (a `_tracked` "added" row has `old_value: null`; a None field value is also JSON null; `new_value` for `_tracked` is `"added"`/`"removed"`; removed trials have `title: null`). Window rule: `day - N < detected_date <= day`. Trial file keys are listed in plan Task 9 / `export.py`. Dates are `{date, precision:"day"|"month", type:"ACTUAL"|"ESTIMATED"|null}`.
- **Tracked state** stores DISPLAY text for list fields (original casing, de-duplicated by `norm_key`) and compares by casefolded key sets; scalars compared as-is. Lead sponsor/interventions are re-derived from RAW stored names with the CURRENT aliases for both prev and curr, so editing an alias CSV never creates change rows. **Never compare stored `tracked_hash` values across runs.**
- **Store** (`store.py`): `current/`, `previous/`, `.state-old`, `history/{trial_change,trial_snapshot,run_log}.parquet`. Same-day rerun overwrites `current/`; new day rotates to `previous/`. `.state-old` is a recovery copy ONLY while `current/` is missing; an existing-but-invalid `current/` raises `StoreError` (recovery = `trialradar rebuild`). `run_log` is append-only. `Store.require_no_rewind`, `Store.wipe()`.
- **Raw snapshots** (`raw/YYYY-MM-DD.jsonl.gz` + `.meta.json` sidecar `{data_timestamp, fetched_at, accept_drop}`) are the source of truth and hold EVERY fetched study; staged in `raw/.incoming/`, promoted only after the store write succeeds (snapshot first, sidecar second); a data-gate failure quarantines as `*.failed.*`. A run for a date earlier than stored state is refused before fetching.
- **Quality:** errors fail the run BEFORE the store is touched (`schema:`, `null_rate:`, `date_order:` [both ACTUAL only], `duplicate:`, `empty:`, `row_drop_error:` >25%); warnings (`row_drop:` >10%, `unknown_status:`, `date_order_estimated:`, `off_topic:` <50% relevant). `--accept-drop` demotes only `row_drop_error`.
- **Relevance filter:** conditions + keywords + MeSH (`derivedSection.conditionBrowseModule.meshes[].term`) matched as whole phrases (`(?<!\w)…(?!\w)` on `norm_key`) against configured synonyms; titles not used.
- **CLI:** `trialradar run [--config --data-dir --raw-dir --site-dir --date --force --accept-drop --aliases-dir]`, `check`, `rebuild`; exit 0 success/skipped, 1 failed; appends `status=<success|skipped|failed>` to `$GITHUB_OUTPUT`; JSON stage logs on stderr.
- **Real-data facts** (from recorded fixtures): month-precision dates can have NO `type`; withdrawn trials have enrollment 0 (kept as 0); `allocation`/`masking`/`enrollmentInfo` may be absent; sections like `outcomesModule`, `contactsLocationsModule` may be missing.

---

## 5. IMMEDIATE next step: "Task 10b" — make tests independent of the recorded fixtures

**Symptom:** `cd pipeline && uv run pytest -q` → **11 failed, 315 passed** (HEAD `e436f10`). `uv run pytest -m "recorded or recorded_fresh"` → 9 passed (the new fixtures are all in-area, as intended: `sample20.jsonl` = 20 MS studies).

**Failing tests and causes:**
- `tests/integration/test_pipeline.py::` `test_malformed_day3_fails_and_leaves_store_and_site_untouched[missing-briefTitle]`, `[missing-nctId]`, `test_normalize_exception_is_a_data_failure`, `test_failed_rerun_of_a_good_day_keeps_its_good_snapshot`, `test_accept_drop_demotes_nothing_else`; `tests/integration/test_rebuild.py::` `test_rebuild_equals_incremental_after_a_failed_day`, `test_rebuild_honours_an_accepted_drop`, `test_rebuild_skips_unreadable_and_failing_days`, `test_failed_snapshots_are_not_replayed` — **cause:** `tests/integration/conftest.py::day1_studies` takes the in-area studies of `sample20.jsonl` and tops up with `make_study` clones (`NCT90000001…`) only while fewer than `MIN_RELEVANT=12`. With 20 in-area studies there are now only 4 clones, so tests that refer to specific clones (e.g. `NCT90000005`) and compute drop percentages from counts break.
- `tests/unit/test_ctgov_client.py::test_data_timestamp` hard-codes the old `dataTimestamp` `"2026-11-03T10:00:05"` (new fixture value `2026-11-04T10:00:04`).
- `tests/unit/test_normalize_recorded.py::test_month_date_recorded` hard-codes the old fixture's start date `2013-10-01` (new fixture start is 2009-02).

**Fix (test code only; do not touch `tests/fixtures/`, and do not change `src/` unless a failure proves a real bug):**
1. `tests/integration/conftest.py`: make the dataset deterministic and independent of the recording: use a FIXED `REAL_COUNT = 6` — the first 6 of `filter_relevant(sample, cfg)` (assert ≥ 6 exist with a clear message) — plus a FIXED set of 8 clones `NCT90000001…NCT90000008`, plus the 2 off-topic studies. Remove the `MIN_RELEVANT` top-up. Keep roles `STATUS_EDIT, DATE_EDIT, REMOVED, COSMETIC, ADDED`; derive counts in tests from the helper's output, not literals; keep exercising a >25% drop (error), threshold boundaries, and `accept_drop`.
2. `test_data_timestamp`: read the expected value from `tests/fixtures/http/version.json`.
3. `test_month_date_recorded`: derive expectations from the fixture's own `startDateStruct.date` (`YYYY-MM` → first of month, precision `"month"`). Grep `tests/` for other literals that come from recorded fixtures and derive them too.
4. Acceptance: default `uv run pytest` all green; `-m "recorded or recorded_fresh"` still green; ruff check + format --check + mypy clean. Optional proof of independence: run the suite against the PREVIOUS fixture set from `git show 1505998:pipeline/tests/fixtures/studies/sample20.jsonl` (only if easy; never overwrite committed fixtures).
5. Run it as an SDD task (sonnet implementer, then a sonnet/haiku review of the test-only diff), commit, push.

---

## 6. Remaining plan (details are in the plan file; extra requirements gathered from reviews)

**Task 11 — Workflows** (`daily.yml`, `live-check.yml`; `ci.yml` already exists with a `pipeline` job). Must-haves beyond the plan text:
- Cron `17 7 * * *` + `workflow_dispatch`; `concurrency: daily` (no cancel); permissions exactly `contents: write, pages: write, id-token: write`; keepalive step (pinned `gautamkrishnar/keepalive-workflow`).
- **Gate everything after the run on `steps.run.outputs.status == 'success'`** (a half-written site from an export failure must never deploy; the CLI writes `status=` to `$GITHUB_OUTPUT`).
- Raw-upload glob must match only `raw/????-??-??.jsonl.gz` (+ `.meta.json` sidecars) — never `raw/.incoming/` or `*.failed.*`. **Upload `*.failed.*` and `.incoming` content as an Actions artifact on failure** (otherwise the evidence vanishes with the runner).
- Data branch: checkout `data` into `./data` (first run empty), run, then force-push a single orphan commit; monthly release `snapshots-YYYY-MM` via `gh release`.
- Build web (`BASE_PATH=/<repo>/`) and deploy Pages with `actions/upload-pages-artifact` + `actions/deploy-pages`.
- Add `pipeline/tests/unit/test_workflows.py` (parse YAML; see plan Task 11). Lint with `actionlint` if obtainable. Pin actions by major tag (Dependabot PRs propose v7 bumps — coordinate/ask).
- Weekly live check runs `pytest -m live` (tests exist: `tests/live/test_live_api.py`).
- Add `.github/workflows/ci.yml` web job in Task 12.

**Task 12 — Web scaffold, data layer, Changes feed, freshness badge** and **Task 13 — Trial detail, Methods page, e2e** (plan has full test lists). Notes: Vite + React + TS, HashRouter, base path from `BASE_PATH`; fixture JSON for web tests must be **generated by running the pipeline export** (add `pipeline/scripts/make_web_fixtures.py`, commit its output) — not hand-written; UI rules: label AI text (none yet), every row links to `https://clinicaltrials.gov/study/<NCT>`, empty states ("No changes in the last N days", "Trial not found", "Freshness unknown"), badge warns when last success > 36 h, mobile-first, accessible tables, "Target: not yet mapped (coming in enrichment)" placeholder.

**Task 14 — README, SECURITY.md, architecture doc, config-swap test, go-live.** README sections per the parent spec: problem & user; existing tools and the gap (Cortellis, ClinicalTrials.gov alerts, Clinical Trial Risk Tool — what this does differently and what it does NOT do); architecture (Mermaid in `docs/architecture.md`); how to run; how to change area; data-use note (registry lag, sponsor self-reporting, not medical advice); limitations incl. "bare MS/MG/Devic removed; titles not used for relevance"; evaluation placeholders marked "later slices"; scope the pitch as in §1. Config-swap test: a throwaway psoriasis config runs end-to-end with the fake client and no source file contains area names (`grep -ri sclerosis pipeline/src web/src` empty). **Go-live is human-in-the-loop:** user must enable Pages (source: GitHub Actions), add branch protection requiring `ci`, dispatch `daily.yml`, and verify; then the **14-day unattended-run clock** starts (record day 1 in README).

**After Task 14:** run the final whole-branch review again (opus; give it the source files, not a diff; ask it to re-run the end-to-end chain check on the real fixtures, see `docs/superpowers/handoff/` for what the previous one did), triage deferred minors, fix in ONE wave, then `superpowers:finishing-a-development-branch`. Present "Rulings I made" (all `Ruling:` lines in the ledger) to the user.

---

## 7. Rulings made so far (full text is in the ledger; each with cost-if-wrong)

1. Realism test for recorded fixtures moved from Task 2 to Task 7. 2. Offline predicate tests in Task 2; presence test only with fixtures. 3. Fixtures recorded via GitHub Actions (container can't reach CT.gov). 4. `.superpowers/` git-ignored. 5. Python ≥3.12. 6. Fixture-presence test excluded from default runs until fixtures existed (done in Task 3). 7. Final whole-branch review run after Tasks 3–9 (earlier than planned). 8. Tracked state stores DISPLAY text, compares casefolded keys (supersedes an earlier casefold ruling). 9. Store crash recovery: pick newest valid dir; `.state-old` only while `current/` missing; corrupt `current/` raises `StoreError` (fix: rebuild). 10. Fix wave limited to mechanical hardening; query/alias/drop decisions went to the user. 11. **User decisions:** option A (client-side relevance filter + drop bare abbreviations + re-record) and defaults: alias-stable comparison; one-day drop >25% = error, >10% warning. 12. Raw snapshot keeps ALL fetched studies; relevance after snapshot. 13. Relevance = conditions+keywords+MeSH whole-phrase, no titles. 14. Bare "MS","MG","Devic" removed. 15. `run_log` append-only; spec §6 amended. 16. Accept `raw/.incoming` staging, `accept_drop` in the sidecar, export non-atomic across files **because Task 11 must gate deploy on success**.

---

## 8. Deferred minor findings (fix in the final fix wave unless noted)

- **Task 1:** `test_invalid_config_rejected` lacks `match=`; no test that `aliases_dir` resolves relative to the YAML; `Thresholds` bounds (partly done in 9b); `tracked_fields` may be empty/duplicated; ci.yml double-runs push+PR; duplicate `DELETE` in conftest.
- **Task 2:** recorder retries only HTTP statuses (not `TransportError`); dispatch on a tag → detached checkout; `.get("enrollmentInfo", {})` breaks on explicit null; `test_fixtures_present` imports from another test module.
- **Task 3:** (Retry-After/inf, malformed bodies, repeated token — FIXED in the fix wave); `test_timeout_is_30s` reads private `client._http`.
- **Task 4:** mkstemp leaves 0600 mode; order test doesn't pin fsync-after-gzip-close.
- **Task 5:** whitespace-only skip untested; alias duplicate keys last-wins; all-null site rows emitted; smoke test normalises twice.
- **Task 6:** empty-key handling inconsistent for outcomes; reason-precedence test only distinct fields; `_outcome_pairs` parallel dicts.
- **Task 7:** empty-string `nct_id` counts as duplicate; `<row i>` index meaning undocumented/inconsistent.
- **Task 8:** `replace_day` two-file non-atomicity; rotation `rmtree(previous)` before rename; 0600/0700 modes; tz-aware `started_at` not rejected; heal rename not dir-fsynced; docstring outdated; weak last assert in a recovery test.
- **Task 9/9b:** export `.tmp` etc. mostly FIXED; byte-identical-run / non-ASCII / null-warnings tests missing; `ConditionSpec.synonyms` accepts `""`/whitespace (add validation); recorder early-stop path untested; `is_relevant` recompiles regex per call; off_topic assertions weak.
- **Task 10 (for the final review):** if `promote_staged` raises/killed AFTER the store write, the next-day run clears `.incoming` and rebuild diverges (idea: promote on startup if staged day == committed date and sidecar timestamp matches); rewind guard misses the crashed-rotation state (`current/` missing, state only in `previous/`); `committed_date` loads all tables just to read a date; one test patches only `save_state`; a half-promoted snapshot/sidecar pair vs `accept_drop`; rebuild's `_changes` outside its skip-`try` (abort after wipe → consider temp root + swap); second same-day data failure overwrites `*.failed.*` (suffix with run_id); rebuild uses today's aliases so rebuilt `trial_snapshot` hashes differ after alias edits (hashes never compared — document); argparse exit 2 / KeyboardInterrupt skip `$GITHUB_OUTPUT`; skipped-run test doesn't hash the store; `check_raw` runs twice; live test crawls the full set.
- **Other open items:** drop-out-then-return only yields an `added` row (field changes during absence unreported); a partial registry response under 25% still publishes a burst of removed/added.

---

## 9. How to resume (commands)

```bash
cd /home/user/trials && git checkout claude/peaceful-thompson-p09fgu && git pull origin claude/peaceful-thompson-p09fgu
cd pipeline && uv sync --locked && uv run pytest -q   # expect 11 failures until Task 10b is done
# recreate the SDD workspace/ledger if missing:
S=/root/.claude/plugins/synced/*/*/skills/subagent-driven-development
bash $S/scripts/sdd-workspace docs/superpowers/plans/2026-11-04-trial-radar-slice1.md   # prints the workspace dir
cp docs/superpowers/handoff/sdd-ledger.md <workspace>/progress.md                       # then append new entries
bash $S/scripts/task-brief docs/superpowers/plans/2026-11-04-trial-radar-slice1.md 11   # brief for the next plan task
```
(The `*` globs depend on the plugin cache path; `ls /root/.claude/plugins/synced/` to find the real one.)

**First message to the user when you resume:** confirm you've read this handoff, state that the suite is red because of fixture-dependent tests (Task 10b), and ask nothing that this file already answers. Open questions that still need the user (ask only when you reach them): README pitch wording (default in §1), whether to merge/close Dependabot PRs #1–#3, Pages/branch-protection/go-live steps in Task 14, and whether to start multi-area support after the first live run.
