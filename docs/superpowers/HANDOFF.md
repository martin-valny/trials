# Trial Radar — Handoff for the next agent

Rewritten 2026-11-05 at the end of session 3; updated 2026-11-06 at the end of session 4 for the Explorer (branch `feat/explorer-figure-plate`, committed locally, not pushed — see section 00). Read this file top to bottom before doing anything. Everything here is true as of `main` at commit `97f223c` (plus this handoff PR). Repository: `martin-valny/trials`, **public**, default branch **`main`**.

---

## 00. Current state — end of session 4 (2026-11-06), read this first

- **The Explorer is finished but NOT pushed.** Everything is committed locally on branch **`feat/explorer-figure-plate`** in the user's Mac checkout (`~/Desktop/trials`), 40+ commits on top of `main` (`253c15b`). No PR exists. `main`, the live site and the daily workflow are unchanged.
- **Why not pushed:** `git push` from the agent's shell is blocked by the user's org policy (git network calls return nothing; `gh api` works). The user rejected bypassing the sandbox. **Do not retry pushes or disable the sandbox.** The user pushes themselves: `git push -u origin feat/explorer-figure-plate`, then `gh pr create --base main` (PR body: summarise section 6, end with the Claude Code attribution line). After CI is green, merge only when the user says so.
- **Verification at hand-off:** pipeline `pytest` 487 passed, ruff + mypy clean, `uv lock --check` clean; web vitest 140 passed, eslint + tsc clean; Playwright e2e 18/18 (desktop + 375px). Process: subagent-driven development with a spec + quality review per task, an Impeccable finish review, a final whole-branch review (opus) and a scoped re-review of its fix wave — all clean.
- **CI on Linux has never run this branch.** Expect the first run on the PR to be the real test (UMAP/numba install, Playwright browser install). Fixture checks deliberately ignore UMAP coordinates (R10).
- **Parked nits (R20, doc/copy only):** spec section 10 "my calls" item 9 still says the pool is "finished, Early Phase 1 – Phase 2/3" without R18's experimental-drug condition; the clustered-verdict sentence in `web/src/lib/explorer.ts` says "as often as the average finished trial" where the divisor is the pool rate ("finished trials that could succeed"). Neither shows on current data (verdict is "chance").
- **Local preview (may still be running):** real-data site served by `vite preview` on <http://localhost:4173/#/explore>. To recreate: `gh release download snapshots-2026-11 -R martin-valny/trials -D <tmp>/raw`; `cd pipeline && uv run trialradar rebuild --config ../config/area.yaml --raw-dir <tmp>/raw --data-dir <tmp>/store --site-dir <tmp>/site --force`; `cd web && npm run build && rm -rf dist/data && cp -r <tmp>/site/. dist/data/ && npx vite preview --port 4173`. Never commit real data.
- **Agent memory:** `~/.claude/projects/-Users-martin-valny-Desktop-trials/memory/` holds a note about the push block.
- **Sensible next steps (ask the user which):** (1) user pushes and opens the PR, then watch CI and fix Linux-only failures; (2) fix the two R20 nits; (3) restyle Changes/Trials/Trial detail/Methods to the Figure Plate system (`DESIGN.md`); (4) resume the paused "Ask" feature brainstorm (section 5.3); (5) the pathway-graph idea (needs drug → target → pathway enrichment, e.g. ChEMBL/Open Targets — "coming next" in README).

---

## 0. TL;DR

1. **Slice 1 is finished, deployed and running.** Live site: <https://martin-valny.github.io/trials/>. The `daily` workflow has run successfully twice (run #2 and #3, both manual dispatches on 2026-11-05). Scheduled runs start 2026-11-06 at 07:17 UTC. The 14-day unattended-run clock started 2026-11-05 (recorded in the README).
2. **Nothing is half-done in the code.** Gates were green on `main` at slice 1 (pipeline 365 tests, web 50, e2e 6). The Explorer branch adds many more; re-run the gates for current counts. The Explorer is described in section 6.
3. **Open items:**
   - **Design direction is resolved** (section 6): Figure Plate on Explore; `DESIGN.md` is the record. Restyling Changes, Trials, Trial detail and Methods to match is a follow-up, not started.
   - **The "Ask" feature spec.** The brainstorming process (architectural path) is partway through. Decisions made are in section 5. Next step is to propose 2–3 approaches, present the design in sections, write the spec, get approval, then `writing-plans`.
4. **The project is now also a showcase for a job application** (Forward Deployed Engineer, AI prototyping, a large pharma company in Prague). That changed the roadmap priorities (section 5).
5. **Process rules for this repo:** `main` is protected by rulesets (PR required, checks `pipeline` and `web` required, no force push, no deletion). Never merge a PR without the user saying so (their pattern: "merge it when green"). Never create a PR unless asked (they have asked each time so far). Use the superpowers skills. Read section 3 (environment limits) before trying any GitHub operation.

---

## 1. What the project is and why

**Trial Radar**: a zero-budget ($0), public, daily-updating app that tracks ClinicalTrials.gov trials in one therapeutic area (default: neuroimmunology), detects field-level changes between daily snapshots, flags notable ones, and publishes a static site. Later slices (not started) add enrichment (drug targets, Open Targets genetic evidence), preprints, retrieval Q&A with citations, a risk model and a weekly briefing.

- **User** (Martin, repository owner): wants it equally a real tool and a portfolio piece, and now specifically a showcase for the job posting in section 5. Honest, working, deployed vertical slices beat breadth.
- **Primary persona:** a clinical-operations or competitive-intelligence lead asking "what changed in competitor trials this week and why does it matter?"
- **Hard constraints:** $0 running cost (GitHub Actions, Pages, Releases only), no secrets beyond the automatic `GITHUB_TOKEN`, public data only, no user accounts, **a new therapeutic area is a config change only** (a test enforces that no source file names a condition).
- **Honesty about the pitch:** the README says "What's changing in clinical trials for a therapeutic area?" and states that targets, evidence and preprints are "coming next". Keep it that way; do not claim features that do not exist.
- **Default scope:** interventional studies, phases Early Phase 1–4 and N/A, all statuses; conditions: multiple sclerosis, NMOSD, MOGAD, myasthenia gravis, CIDP, autoimmune encephalitis (`config/area.yaml`). Bare "MS"/"MG"/"Devic" were removed on purpose (they pulled in mostly off-topic trials). Relevance uses conditions, keywords and MeSH terms, never titles.

---

## 2. State of the repository

### 2.1 Branches, PRs, settings
- **`main`**: default and protected (rulesets configured by the user by hand in Settings → Rules; the JSON definitions in `.github/rulesets/` are reference copies, plus tests that keep required check names in sync with `ci.yml`). Required checks: `pipeline`, `web`. PRs required, 0 approvals, conversations must be resolved, branch must be up to date.
- **`data`**: the Parquet store, force-pushed as a single orphan commit by `daily.yml`. Ruleset blocks deletion only (force push must stay allowed).
- **`claude/peaceful-ramanujan-sc52l1`**: the designated working branch for this session. Everything on it is already merged (squash), so it is stale. The user may delete it. See "branch handling" in section 3.
- **No PRs are open** except the handoff PR that carries this file (if still open).
- **Releases:** `snapshots-2026-11` holds the raw snapshot(s) uploaded by the workflow.
- Dependabot PRs #1–#4 were all merged (checkout v7, setup-uv v7, upload-artifact v7, uv-build bound).
- **GitHub Pages:** source "GitHub Actions", enabled by the user. The `github-pages` environment exists.

### 2.2 Data flow
```
CT.gov API ─ctgov.client(retry,dedupe,CtGovError)→ raw studies (ALL fetched)
 → snapshot.stage → check_raw (schema) → relevance.filter_relevant → normalize → Tables
 → quality.check → tracked_state(prev,curr, SAME current Aliases) → diff → trial_change rows
 → store.save_state + replace_day → snapshot.promote → explorer (build_explorer; previous coords from data/explorer/coords.parquet) → export (site JSON incl. explorer.json) → store.save_explorer_coords → store.append_run(success)
```
Module map (`pipeline/src/trialradar/`): `config, textnorm, tables, normalize, tracked, diff, quality, relevance, snapshot, store, export, pipeline, cli`, `explorer/{extras,drugs,outcomes,features,layout,stats,build}`, `ctgov/{query,client}`. Tests in `pipeline/tests/{unit,integration,live}`; fixtures in `pipeline/tests/fixtures/{studies,http}`. Config: `config/area.yaml`, `config/aliases/{sponsor,intervention}.csv`. Web: `web/` (Vite + React 19 + TypeScript, HashRouter). Docs: `README.md`, `SECURITY.md`, `docs/architecture.md` (Mermaid diagram).

### 2.3 Workflows (`.github/workflows/`)
- **`ci.yml`**: jobs `pipeline` (ruff, mypy, pytest, pip-audit) and `web` (npm ci, lint, tsc, vitest, npm audit --audit-level=high, build, copy fixtures into dist/data, Playwright install + test). Runs on push and pull_request. The `web` job sometimes takes ~10 minutes (Playwright browser install is slow); it passed anyway.
- **`daily.yml`**: cron `17 7 * * *` plus `workflow_dispatch` (inputs `force`, `accept_drop`). Steps: detect `data` branch (only "missing" counts as first run; other errors stop the job) → checkout data → run pipeline (`continue-on-error`, output `status`) → upload failure evidence artifact (on failure) → **everything below only if `status == success`**: upload raw snapshot to the monthly release `snapshots-YYYY-MM` (month taken from the snapshot's file date) → setup node and build site (`BASE_PATH=/<repo>/`) → upload Pages artifact → deploy Pages → **push the `data` branch LAST (it is the commit point)** → fail step if the run failed. A separate `keepalive` job (permissions `actions: write` only) runs `gh workflow enable daily.yml` to reset the 60-day inactivity timer.
- **`live-check.yml`**: weekly (Mondays), runs `pytest -m live` against the real API.
- **`record-fixtures.yml`**: manual; records real API fixtures and commits them. Only the user can dispatch it.

### 2.4 Site JSON contract (written by `export.export`, read by the web app)
- `changes/{1,7,30}d.json` = `{window_days, generated_for, changes:[ChangeItem]}`. ChangeItem keys exactly: `nct_id, title, lead_sponsor, field, old_value, new_value, detected_date, delta_days, notable, notable_reason, source_url`. `old_value`/`new_value` are decoded JSON. A `_tracked` row means presence: `new_value` is `"added"`/`"removed"`; removed trials have `title: null`. Outcome fields are `[[measure, time_frame|null], ...]`. Window rule: `day - N < detected_date <= day`.
- `trials/<NCT>.json` = full trial file (see `export._trial_docs`, mirrored by `web/src/types.ts`).
- **`trials.json`** (added this session) = `{generated_for, trials:[{nct_id,title,overall_status,phases,lead_sponsor,start_date,primary_completion_date,enrollment,last_change}]}`, sorted by NCT id.
- `meta.json` = `{area, conditions[], generated_for, trial_count, last_success_at (ISO Z or null), tracking_since (YYYY-MM-DD or null, added this session), data_timestamp, warnings[]}`.
- Dates are `{date, precision:"day"|"month", type:"ACTUAL"|"ESTIMATED"|null}`.
- Notable reasons: `status_change`, `primary_endpoint_change`, `enrollment_change_ge_20pct`, `date_slip_ge_90d`.
- **Web fixtures** in `web/tests/fixtures/data/` are generated by `pipeline/scripts/make_web_fixtures.py` (runs the real pipeline over two simulated days) and a pipeline test fails if they go stale. After changing `export.py`, run `cd pipeline && uv run python scripts/make_web_fixtures.py` and commit the output.

### 2.5 Web app (what exists)
Routes: `/` redirects to `/explore` (the Explore map, section 6), `/changes` (1/7/30-day tabs, sponsor and field filters, "Notable only" default on, empty state that explains the day-1 situation and links to Trials), `/trials` (search by NCT/title/sponsor, status filter, newest change first), `/trial/:nct` (key facts, timeline, change history, "Target: not yet mapped" placeholder, link to ClinicalTrials.gov), `/methods` (conditions from meta, how detection works, limitations). Header has a freshness badge (warns after 36 hours; "Freshness unknown" when meta is missing). Outside Explore, styling is **plain default CSS** (`web/src/styles.css`), mobile stacks tables into cards under 640px, light/dark via `prefers-color-scheme`.

### 2.6 Key behavioural contracts (do not break)
- Tracked state stores display text and compares by casefolded key sets; sponsors and interventions are re-derived from stored RAW names with the CURRENT aliases for both sides, so editing an alias CSV never creates change rows. Never compare stored `tracked_hash` values across runs.
- Raw snapshots hold every fetched study and are the source of truth; staged in `raw/.incoming/`, promoted only after the store write succeeds; data failures are quarantined as `*.failed.*`.
- Quality errors fail the run before the store is touched (`schema`, `null_rate`, `date_order`, `duplicate`, `empty`, `row_drop_error` > 25%); warnings include `row_drop` > 10%, `off_topic`. `--accept-drop` demotes only `row_drop_error`.
- `rebuild` builds into a temp store and swaps it in only on success; it refuses to run with no raw snapshots or when they start later than stored history (`--force` overrides). It needs the raw snapshots downloaded from the monthly release first (`gh release download <tag> --dir raw`).
- `run_log` is append-only; failed and skipped run rows are NOT on the `data` branch (publishing happens only on success), they survive only in the 30-day failure artifact.
- The first run for a day with an unchanged registry `dataTimestamp` is reported `skipped`, unless `force`.

---

## 3. Environment limits learned the hard way (cloud container)

- **No network** to `clinicaltrials.gov` or to `*.github.io` from the container (proxy returns 403). Never call the real API from tests; the live check runs in GitHub Actions. You cannot look at the deployed site; ask the user.
- **The GitHub token cannot dispatch workflows** (`actions_run_trigger` returns 403 "Resource not accessible by integration"). The user must click "Run workflow" (and tick `force` to avoid "skipped"). Read access to runs, jobs and logs works (`actions_list`, `actions_get`, `get_job_logs`).
- **Repository settings and rulesets cannot be written** from here (proxy blocks those API paths). The user does settings by hand.
- **Force push is denied** by the auto-mode classifier. After a squash merge, the remote working branch has pre-squash commits, so a plain push from a branch reset to `main` is rejected. **Branch handling that works:** `git fetch`, `git checkout -B claude/peaceful-ramanujan-sc52l1 origin/claude/peaceful-ramanujan-sc52l1`, `git merge origin/main`, add commits, push normally; the PR's net diff against `main` is still just the new work. Never reset the local branch to `main` while a PR from that branch is still open (that dropped commits locally once; nothing was lost because the remote had them).
- `actionlint` via `go run ...@latest` was denied (external code). Workflows are validated by `pipeline/tests/unit/test_workflows.py` (parsed structure) and by actually running them.
- Third-party actions can be blocked by GitHub (`gautamkrishnar/keepalive-workflow` was). Prefer first-party actions and the `gh` CLI.
- Playwright/Chromium are preinstalled. Run the web e2e locally with `cd web && PW_CHROMIUM=/opt/pw-browsers/chromium npm run e2e`. In CI the job installs its own browser.
- Tool env: Python 3.12 via `uv` (`cd pipeline && uv sync --locked`), Node 22. `UV_NATIVE_TLS` warnings are harmless.
- The container is ephemeral: commit and push everything.
- GitHub MCP tools that were useful: `pull_request_read` (`get`, `get_check_runs`, `get_files`), `merge_pull_request` (pass `expectedHeadSha`), `subscribe_pr_activity` (wakes the session when CI finishes; never poll or sleep), `actions_*`, `add_issue_comment`, `update_pull_request`. The `search_*` tools are unavailable.
- **Commit trailer** (every commit):
  ```
  Co-Authored-By: <current model name> <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GS9t3NSJdewH4TJBubJThv
  ```
  PR bodies end with the "Generated with Claude Code" line and the session URL. GitHub comments end with the `_Generated by [Claude Code](https://claude.ai/code)_` footer. Never put model names in code, docs or PR titles.

---

## 4. How we work

- **Skills:** superpowers is enabled for the repo. Use `superpowers:brainstorming` before new features (architectural path = questions, approaches, sectioned design, written spec in `docs/superpowers/specs/`, user review, then `superpowers:writing-plans`). Bounded changes get a short in-chat design and approval before coding. No implementation before the relevant approval.
- **Gates before any push:** `cd pipeline && uv run pytest -q && uv run ruff check . && uv run ruff format --check . && uv run mypy src scripts`; `cd web && npx vitest run && npm run lint && npx tsc --noEmit` (and `npm run e2e` when UI flows change).
- **Merging:** open a PR, subscribe to it, wait for green checks, merge only when the user has said to ("merge it when green"), squash with `expectedHeadSha`, then unsubscribe. Report what you did and what you could not verify.
- **Reviews:** this session ran the final whole-branch review with two subagents (sonnet for web/workflows/docs, opus for the pipeline); reports are summarised in the ledger. Tasks 10b–14 and the later PRs were otherwise implemented inline without per-task review (the user chose speed). For any large new subsystem (the Ask feature) go back to the SDD loop with independent reviews.
- **Ledger:** `docs/superpowers/handoff/sdd-ledger.md` holds every ruling, review outcome and deferred minor from sessions 1–2, plus a session-2 summary. Session-3 notes are in section 7 below and have been appended to the ledger.
- **Be honest:** report test failures with output, say what was not verified (this session: the live site's appearance, action tags, Pages behaviour were verified only through workflow logs).

---

## 5. Roadmap and the "Ask" feature (in progress)

### 5.1 Why the roadmap changed
The user will use this project to apply for a Forward Deployed Engineer role (AI prototyping and product engineering, life sciences, Prague). The posting asks for: Python, TypeScript/React, end-to-end AI apps, RAG and agentic workflows, enterprise integration, secure deployment, **automated testing, evaluation and observability**, CI/CD, privacy/traceability/human oversight, measured adoption, regulated-domain experience. Slice 1 covers the engineering foundation and the domain well but contains **no AI**. So the AI-facing part of the roadmap was pulled forward and the rest trimmed.

### 5.2 Decisions the user made
- **No Bedrock, no AWS, no cloud deployment.** Show capability, "doesn't need everything".
- **Keep (in order):** (1) finish go-live of slice 1 (done); (2) a design pass; (3) the **"Ask" feature**: retrieval over the trial records and their change history, answers with citations, abstains when evidence does not support an answer, labelled question set and an evaluation that runs in CI and fails on regressions, AI-written text always labelled as AI-generated; (4) a small **FastAPI service in Docker** with token auth, tests, built in CI (no cloud hosting).
- **Cut (still on the roadmap, deferred):** weekly briefing agent, termination-risk model, document intelligence, multi-area support, any cloud deployment. If the user wants more later, these can come back.
- **Hosting choice (user chose option 1):** the Ask feature runs **in the browser with no server**. Retrieval is client-side over the same static JSON the site already uses. Model calls go straight from the page to **Gemini** using a key the visitor pastes in (kept only in their browser, never in the repo or a server). With no key, an **extractive fallback** assembles an answer from the retrieved records with the same citations, so the public demo works at $0 and cannot leak a key or be abused. The FastAPI service stays a runnable local/Docker component built and tested in CI.
- **Provider:** Gemini first, behind a small provider adapter so another provider can be swapped in. Free-tier limits for Gemini/Groq/Mistral are small, reported inconsistently, and free-tier prompts may be used for training; acceptable because the data is public registry data. Do not make CI depend on any provider: **the evaluation runs on recorded model responses** (deterministic and free).

### 5.3 Where the brainstorming stopped
Classified **architectural**. Done: context exploration, intent write-back, the key architecture question (answered: browser-only). **Still to do:** (a) propose 2–3 approaches with trade-offs (retrieval method, e.g. lexical + embeddings vs lexical only; how embeddings are produced without a server; chunking/citation unit; evaluation design and metrics; the adapter interface; the shape of the FastAPI service); (b) present the design in short sections and get approval after each; (c) write the spec to `docs/superpowers/specs/YYYY-MM-DD-ask-feature-design.md`; (d) self-review it; (e) get the user's approval of the written spec; (f) invoke `superpowers:writing-plans`; (g) execute via subagent-driven development with independent reviews. Do not write code before steps (c)–(f) are approved.

Open design questions to settle in the spec: what is retrievable (trial records, change rows, both?); how the labelled question set is built honestly (questions with known answers derived from the fixtures, plus "unanswerable" cases to test abstention); metrics (citation precision/recall, abstention accuracy, answer faithfulness checked against cited records); how recorded responses are stored and refreshed; how the "AI-generated" label and the BYOK key UI look; where the key is stored (memory only vs localStorage with consent); CSP and privacy notes.

### 5.4 Later slices (original decomposition)
2 enrichment (Open Targets, drug→target mapping), 3 fuller frontend (landscape via DuckDB-WASM, target pages), 4 preprints + RAG + eval set (now partly pulled forward as the Ask feature), 5 risk model (includes historical backfill), 6 weekly briefing agent; then CTIS (v1.5) and single-cell (v2). Multi-area support (`config/areas/*.yaml` plus an area picker) is the recommended follow-up after a few days of live data; a "live explore" page querying CT.gov from the browser would need a CORS check that could not be done from the container.

---

## 6. Explorer and design direction (resolved)

**Design direction:** the user chose a "Figure Plate" look (a scientific figure on a plate) for the new Explore page. `DESIGN.md` (with `.impeccable/design.json`) at the repo root is the record: tokens, rules and rationale. Restyling Changes, Trials, Trial detail and Methods to match is a follow-up and has not been started. The old A/B/C options are obsolete.

### What was built
`/explore` (also the default route) is Figure 1: all tracked trials as dots on a rotatable UMAP layout, with phase, disease and outcome colouring, search, filters, a selected-trial panel (summary, eligibility, registry link), a panel on phase and a panel on the success proxy with the neighbourhood statistic. Pipeline: a new explorer stage after the store and before export writes `explorer.json` and persists coordinates at `data/explorer/coords.parquet` so the map stays stable day to day. Trial docs gain `summary`, `eligibility`, `has_results`. Spec: `docs/superpowers/specs/2026-11-05-explorer-figure-plate-design.md`; plan: `docs/superpowers/plans/2026-11-05-explorer-figure-plate.md`.

### Where the code lives
- Pipeline: `pipeline/src/trialradar/explorer/` (`extras, drugs, outcomes, features, layout, stats, build`); wiring in `pipeline.py` (`_explorer`, `_save_coords`); `store.py` coords methods; `export.py` writes `explorer.json`. Settings live under an `explorer` block in `config/area.yaml`. Tests: `pipeline/tests/unit/test_explorer_*.py`; `pipeline/scripts/top_drugs.py` lists top drug names from a real snapshot.
- Web: `web/src/components/explore/` (`Explore, PlateCanvas, LegendBar, PanelPhase, PanelSuccess, SelectedTrial, explore.css`), `web/src/lib/explorer.ts`. Tests: `web/tests/Explore*.test.tsx, PlateCanvas.test.tsx, explorer.test.ts`; e2e in `web/e2e/smoke.spec.ts`.

### Rulings that matter
- **R4:** drugs come only from EXPERIMENTAL arms when arm groups exist; fall back to all DRUG/BIOLOGICAL interventions only when a trial has no arm groups. Comparators must not count.
- **R5/R6:** drug cleaning. "fumarate" is not a stripped salt (fumarate esters are distinct); exclusion terms also match the casefolded original name ("0.9% sodium chloride" is excluded); config exclude terms include sodium chloride and normal saline.
- **R7:** pool eligibility is "phases that can succeed": phases include Early Phase 1, 1 or 2 and top phase is at most 3 (so Phase 2/3 is in, pure 3/4/NA is not). `in_pool(phases, outcome, has_drug)` (R18 adds the drug condition).
- **R8 (superseded by R18 for the verdict):** no usable neighbours is `insufficient`. Fewer than 4 trials gives an empty trials list with `insufficient` (R1).
- **R9:** `explorer.json` stats include `n_averaged` and `n_short` (coverage of the headline number) beyond the spec's key list; web types mirror them.
- **R10/R11:** the fixture staleness test does not byte-compare UMAP coordinates (macOS and Linux CI differ); it compares `explorer.json` with x/y/z excluded. e2e must not depend on exact positions. The day-2 alignment test uses the 14-trial integration set.
- **R18:** pool = phases that can succeed AND at least one cleaned experimental drug AND a finished outcome; the same pool for `success_rate`, `by_condition` and panel b. Verdict by a one-sided permutation p-value over 10,000 shuffles: `clustered` only when p < 0.025, else `chance`; `p_value` is exported. Rows are L2-normalised inside `neighbourhood_lift`.
- **R19:** explorer-only work never fails the daily run: `extract_extras` falls back per study (`extras_fallback:` warning); a failed explorer build is an `explorer: <Exc>: <msg>` run warning, the site is exported without `explorer.json` (a stale one is removed, so the page shows "the map appears after the next daily update"), and coordinates are not saved. The UMAP zero-layout fallback is an `explorer_layout_fallback:` warning.
- **R12 to R17 (visual):** selection ring is ink (R12); dot radius uses enrollment clamped at the 98th percentile with a count scale, isotropic cloud fit (R13); filter pills and Colour group styling as amended (R14); red is only for succeeded trials (R15); e2e pixel check counts non-transparent canvas pixels (R16); cluster labels sit at each condition's densest point and are skipped when too diffuse (R17).

### First real-data result (a dated observation, not a standing claim)
2026-11-05 snapshot, after R18: 2,986 trials, pool 478 (finished, could succeed, with an experimental drug), 66 succeeded (rate 0.138), lift 1.31 against shuffled 0.64 to 1.39, p = 0.058 over 10,000 shuffles, so **no more than chance** (also under seeds 1, 2 and 3: p 0.058 to 0.062). Before R18 the pool held 144 more drug-free finished trials (622 vs 478) and read "clustered, barely" (lift 1.44, range 0.59 to 1.41). The explorer stage took about 12 s, nearly all UMAP; the statistic itself takes about 0.15 s. Numbers change daily; re-measure before quoting.

### Local dev notes
- `uv` is installed via Homebrew on the user's Mac (`brew install uv`); this work was done in the local checkout, not the cloud container, so section 3's network limits do not apply to it.
- e2e: `cd web && PW_CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run e2e`. Kill any leftover `vite preview`.
- Scratch is git-ignored: `.superpowers/` (SDD ledger, reports, screenshots), `.impeccable/{mocks,review,questions,build}/`, `web/.shoot.cjs`. `DESIGN.md`, `PRODUCT.md`, `.impeccable/design.json` and `.impeccable/surfaces/` are tracked.

### Deferred minors (copied from the git-ignored ledger)
- Config: pattern-building duplicated between `relevance._pattern` and `condition_labels`; `condition_labels` recompiles per call; other `ExplorerConfig` ints unvalidated.
- Extras/drugs: exclusion is substring not word-boundary; inconsistent salt forms fragment names.
- Outcomes: O(k^2) per-drug scans; month-precision start dates compared as days (also noted in Methods).
- Features/layout/stats: `_OLDER` duplicates `_ADULT_HI`; literal 5 for population width; per-row exclusion loop is Python (fine to about 5k).
- Build: same-day rerun byte idempotence relies on rounding.
- Web: disease colour uses first label only; `nearestIndex` ties go to the later index; `.badge.ok` green is a second accent on /explore; canvas keyboard selection relies on search and the panel; dark disease colours idx1 and idx3 close in hue; light disease palette brown (#7a5c2e) still warm next to the success red; 375px cloud leaves vertical whitespace; panel b bars on a 0-100% scale sit left; sub-year age rounding edge; light running (#8592a0) and completed-unknown (#7d8a95) greys are now close.

---

## 7. Session 3 log (what happened, in order)

- Task 10b (tests independent of recorded fixtures), Task 11 (workflows), Task 12 (web scaffold, changes feed, badge), Task 13 (trial detail, methods, e2e), Task 14 (README, SECURITY, architecture, config-swap test).
- Final whole-branch review (sonnet web/workflows/docs, opus pipeline): no Critical findings; the fix wave covered workflow ordering and data-branch safety, a safe `rebuild`, config validation, outcome display, null-safe badge, filter reset, removed-trial links, docs.
- PRs: #5 (everything above) and #6 (rulesets definitions, removed the owner's email from the old handoff) merged; Dependabot #1–#4 rebased and merged one at a time after CI; #7 replaced the blocked keepalive action; #8 go-live note plus Trials page plus empty-state explanation merged as `97f223c`.
- User actions completed: repo made public, rulesets created by hand, default branch renamed to `main`, Pages enabled, `daily` dispatched (runs #2, #3 green; #1 failed on the blocked keepalive action and a Pages timeout).
- Secret scan (local; nothing sent anywhere): clean across all history. The owner's personal email appeared in the old handoff (removed in #6) and in one web-UI commit's author field; suggested the user enable "Keep my email addresses private".

### Rulings made this session (each with cost if wrong)
1. The data branch push is the commit point and goes last in `daily.yml` (cost: the site may briefly be one day ahead of the data branch; self-heals on the next run).
2. `rebuild` refuses empty/partial raw sets unless `--force` (cost: one extra flag in a rare recovery path).
3. Keepalive lives in its own job with `actions: write` and uses `gh workflow enable` (cost: none; the third-party action was blocked).
4. The ruleset on `data` blocks deletion only (cost: the branch can be force-pushed, which the workflow requires).
5. Dependabot PRs were merged one at a time after CI, with release notes read for `upload-artifact` v7 since CI does not exercise it (cost: the failure-evidence upload could break and would only show on a failed run).
6. Ask feature runs browser-only with a bring-your-own Gemini key and an extractive fallback (user-approved; cost: no server-side AI endpoint on the public site).
7. Tests for Tasks 10b–14 and later PRs were written together with the code and not reviewed per task (user-chosen speed; cost: the independent review caught things the author missed, so use reviews for the Ask feature).

---

## 8. How to resume (commands)

```bash
cd /home/user/trials
git fetch origin && git checkout -B claude/peaceful-ramanujan-sc52l1 origin/claude/peaceful-ramanujan-sc52l1 && git merge origin/main   # see section 3 for why
cd pipeline && uv sync --locked && uv run pytest -q        # expect all green (365)
cd ../web && npm ci && npx vitest run                      # expect 50 passed
PW_CHROMIUM=/opt/pw-browsers/chromium npm run e2e          # expect 6 passed

# Regenerate web fixtures after changing export.py
cd ../pipeline && uv run python scripts/make_web_fixtures.py

# Explorer e2e on the user's Mac: PW_CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run e2e

# Screenshots (preview server + Playwright from the global install)
cd ../web && npm run build && (npx vite preview --port 4173 --strictPort &) ; sleep 2
# write a small script that does:  const { chromium } = require('playwright');  then
# page.goto('http://localhost:4173/#/changes') etc., screenshot, and run it with:
# NODE_PATH=$(npm root -g) node script.cjs <outdir>     (kill preview afterwards: pkill -f "vite preview")
# Note: build output has no data/; for screenshots copy fixtures:  cp -r tests/fixtures/data dist/data
```

**First message to the user when you resume:** say you have read this handoff, that slice 1 and the Explorer are built, and ask whether to restyle the other pages to Figure Plate or continue the Ask-feature design first. Do not re-ask anything this file already answers.

---

## 9. Open items and risks

- **User to do:** delete the stale branch `claude/peaceful-ramanujan-sc52l1` when convenient; consider the "Keep my email addresses private" setting; tomorrow's scheduled run (2026-11-06 07:17 UTC) is the first run with a previous day to diff, so the Changes feed may fill in (or stay empty if the registry did not change tracked fields).
- **Watch the first scheduled runs:** if one fails, read the `Run pipeline` logs and the failure artifact (`failed-run-<id>`) before changing anything.
- **Action deprecations:** run logs warn that `actions/deploy-pages@v4`, `actions/setup-node@v4` and `actions/upload-artifact@v4` target Node 20 and are forced onto Node 24; plan a bump of `setup-node`, `upload-pages-artifact`, `deploy-pages` to current majors via a PR (Dependabot may propose them).
- **`web` CI job speed:** occasionally ~10 minutes because of the Playwright browser install; consider caching `~/.cache/ms-playwright`.
- **Pages deploy** timed out once at `updating_pages` (a Pages-side hang); a re-run fixed it. If it recurs, check Settings → Pages and GitHub status.
- **Deferred minor findings** (all in the ledger and previous handoff text): Task 1–9b items (config bounds are now fixed), Task 8 crash-window and file-mode items (never pushed on a crashed run), `check_raw` runs twice, live test crawls the whole set, drop-out-then-return only yields an `added` row, a partial registry response under 25% can still publish a burst of removed/added rows, `vite preview` serves index.html with 200 for missing files (Pages returns a real 404; only affects local preview states).
- **Unverified:** how the live site looks (the container cannot reach it); the real registry `dataTimestamp` cadence relative to 07:17 UTC (if the registry updates later, the daily run may report `skipped` and pick the change up a day later).
- **Docs to keep current:** `DESIGN.md`, README go-live status and clock, `docs/architecture.md`, `SECURITY.md` (permissions claims are backed by tests only for `daily.yml` and `live-check.yml`).
