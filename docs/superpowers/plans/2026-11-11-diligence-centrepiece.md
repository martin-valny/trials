# Diligence Centrepiece Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the diligence agent a first-class part of Trial Radar (front-door band, a Diligence page in the nav, diligence as panel a on target pages), switched on only once recorded memos or a backend exist.

**Architecture:** A new static file `web/public/diligence/index.json` (written by an offline step in `agent/scripts/`) lists the recorded pairs. One web hook reads it plus the build-time backend URL and returns a release state (`pending | closed | recorded | live`). Every surface branches on that state; `closed` renders exactly today's site.

**Tech Stack:** React 19 + TypeScript + Vite (HashRouter), vitest + Testing Library, Playwright; Python 3.12 + pytest (uv) in `agent/`.

**Spec:** `docs/superpowers/specs/2026-11-10-diligence-centrepiece-design.md` (approved by Martin 2026-11-10).

## Global Constraints

- Release states (spec §4): no `diligence/index.json` with ≥1 run and no backend URL → **closed**: exactly today's site (panel g at the bottom, header strip as today, front-door example line, no band, no nav item). Index with ≥1 run, no backend → **recorded**. Backend URL set at build time (`diligenceEndpoint() !== null`) → **live**.
- Public site after Task 11 runs in the recorded state; recorded carries the main design, test and screenshot effort. Live is built and unit-tested; its picker is a basic native `<select>` list.
- No paid run starts from a link, a page load or the front door. A run starts only from the Run button on a target page.
- Nothing synthetic in `web/public/diligence/`. Test fixtures live in `web/tests/fixtures/` and are served in e2e by route interception.
- Labels on every diligence surface: "AI-written" where memo text shows; "AI judgement from public data, not investment advice" on the band, the page head and the strip; a withheld judgement shown as "withheld".
- Header strip, recorded state, pair with no memo: `AI diligence: no memo recorded for this target yet · See recorded memos →` (link to `/diligence`). Contents-strip word for that panel: `not recorded`.
- Panel a content, recorded state, no memo for the pair: `No recorded memo for this target yet.` plus `See recorded memos →` to `/diligence`. Never "The diligence agent is offline." while the gate is open.
- Nav order when open: Pipeline · Diligence · Watchlist · Approaches · Changes · Trials · Methods. Closed: today's nav.
- Front-door band button text `Open memo →` (to the target page at the diligence panel); second link `Read how it works →` (to `/diligence`).
- Figure Plate design system (DESIGN.md): tokens on `:root` in `web/src/plate.css`, type scale `--fs-meta 12 / --fs-ui 13 / --fs-body 14 / --fs-read 15 / --fs-lede 19`, 12px floor; red only for "advanced"; 375px phones with no horizontal page scroll; light and dark. `web/tests/css-scale.test.ts` must stay green.
- Never port 4173 (use ≥4180); never call AWS; never push; never start diligence plan Task 11.

## Review Focus

1. `index.json` present but empty, malformed, or listing only unknown targets → the site behaves as **closed**, never half-open (Task 2 test `parseIndex rejects…`, Task 2 test `release is closed for an empty index`).
2. The index lists a pair whose memo file 404s or fails to parse → the Diligence page leaves that row out and the page still renders; the target page shows the "no memo recorded" line (Task 4 test `skips a pair whose memo is missing`).
3. The header strip's action and `exampleHref` must reach the diligence panel in both layouts (g when closed, a when open) (Task 3 test `strip action targets the diligence panel id`).
4. A pair with disease `all` → link carries no `?disease=` and reads "All diseases" in the picker and table (Task 2 test `pairHref for all`, Task 5 test `all-diseases option`).
5. The front door never starts a run, even in live state with a mocked endpoint (Task 5 test `band never POSTs /runs`).

---

### Task 1: Recorded-runs index writer (agent)

**Files:**
- Create: `agent/scripts/site_index.py`
- Modify: `agent/scripts/record_eval.py` (`record_all`, end), `agent/scripts/eval_report.py` (`main`)
- Test: `agent/tests/test_site_index.py`

**Interfaces:**
- Produces: `web/public/diligence/index.json` with shape `{"runs": [{"target": str, "disease": str}]}`, sorted by (target, disease), no duplicates.
- Produces: `site_index.write_index(web_dir: Path) -> int` (returns the number of runs written) and `site_index.main(argv: list[str] | None = None) -> int` with `--web-dir` (default `web/public/diligence` under the repo root).

Ruling recorded here: the index carries only the pairs; the site computes stance and claim counts from each memo with the existing TS helpers (`claimCounts`, `stripView`), so the counting rule lives in one language. This narrows spec §6.1's field list; the page shows the same fields.

- [ ] **Step 1: Write failing tests** in `agent/tests/test_site_index.py`:
  - `test_lists_done_memos_sorted`: a tmp dir with `cd20__MS.json` and `btk__MS.json` (status `done`), plus `eval-report.json` and an old `index.json` → `write_index` returns 2 and the file equals `{"runs": [{"target": "btk", "disease": "MS"}, {"target": "cd20", "disease": "MS"}]}`.
  - `test_skips_failed_and_unreadable`: a `status: "failed"` record and a file with invalid JSON are left out.
  - `test_empty_dir_writes_empty_runs`: no memos → `{"runs": []}`, returns 0.
  - `test_record_all_rebuilds_index_even_when_gates_fail`: reuse `make_synthetic_recording.fixture_http` / `scripted_model` as `test_eval_replay.py` does; run `record_all` for one pair into tmp dirs with labels that fail the gates → `index.json` exists and lists that pair; `eval-report.json` absent.
  - `test_eval_report_web_dir_copies_and_indexes`: `eval_report.main([... , "--web-dir", tmp])` with passing gates → `tmp/eval-report.json` and `tmp/index.json` written; with failing gates → index written, report not copied.
- [ ] **Step 2: Run** `cd agent && uv run pytest tests/test_site_index.py -q` → FAIL (module missing).
- [ ] **Step 3: Implement** `site_index.py` (glob `*__*.json`, skip `eval-report.json`/`index.json`, keep records whose `status == "done"`, take `target`/`disease` from the record, not the file name). In `record_all`, call `site_index.write_index(web_dir)` after the report step whatever its result. In `eval_report.main`, add optional `--web-dir`: when given, copy the report there if gates pass, and always call `write_index`.
- [ ] **Step 4: Run** `uv run pytest -q` (whole agent suite) → PASS; `uv run ruff check . && uv run mypy` if the repo's agent CI runs them (see `.github/workflows/ci.yml`).
- [ ] **Step 5: Commit** `feat(agent): recorded-runs index for the site`.

### Task 2: Release state, index loader and panel letters (web lib)

**Files:**
- Create: `web/src/lib/diligenceRelease.ts`
- Modify: `web/src/lib/diligence.ts` (`exampleHref`, `StripView`, `stripView`, `contentsWord`)
- Test: `web/tests/diligenceRelease.test.ts`, `web/tests/diligence.test.ts`

**Interfaces:**
- Produces in `diligenceRelease.ts`:
  - `export type DiligenceRelease = "pending" | "closed" | "recorded" | "live";`
  - `export interface RecordedPair { target: string; disease: string }`
  - `export function parseIndex(raw: unknown): RecordedPair[] | null` — null unless `{runs: [...]}` with every entry two non-empty strings; dedupes.
  - `export async function loadIndex(): Promise<RecordedPair[] | null>` — fetches `${BASE_URL}diligence/index.json` once per page load (module cache); never throws.
  - `export function useDiligenceRelease(): { release: DiligenceRelease; pairs: RecordedPair[] }` — `live` synchronously when `diligenceEndpoint() !== null` (pairs still loaded for the page); otherwise `pending` until `loadIndex` settles, then `recorded` if ≥1 pair else `closed`.
  - `export const isOpen = (r: DiligenceRelease): boolean` — true for `recorded` and `live`.
  - `export type PanelKey = "diligence" | "timeline" | "companies" | "stops" | "mechanism" | "diseases" | "risk";`
  - `export function panelLetters(open: boolean): Record<PanelKey, string>` — closed: timeline a, companies b, stops c, mechanism d, diseases e, risk f, diligence g. Open: diligence a, timeline b, companies c, stops d, mechanism e, diseases f, risk g.
  - `export function pairHref(p: RecordedPair, open: boolean): string` — `/target/{target}?disease={disease}&panel={letter}`; disease `all` → no `disease` param.
- Changes in `diligence.ts`: `exampleHref(open = false)` uses `pairHref`. `StripView` gains `{ kind: "unrecorded" }`. `stripView(r, release: DiligenceRelease = "closed")` returns `unrecorded` where it would return `intro` with action `methods` and `release === "recorded"`. `contentsWord(r, release = "closed")` returns `not recorded` for it.

- [ ] **Step 1: Write failing tests:**
  - `parseIndex rejects malformed`: `null`, `{}`, `{runs: "x"}`, `{runs: [{target: "cd20"}]}`, `{runs: [{target: "", disease: "MS"}]}` → `null`; `{runs: [{target:"cd20",disease:"MS"},{target:"cd20",disease:"MS"}]}` → one pair.
  - `release is closed for an empty index` (`{runs: []}`), `closed when index 404s`, `recorded with one pair`, `live when VITE_DILIGENCE_URL is set` (stub `import.meta.env`), `pending before the fetch settles`.
  - `panelLetters`: both maps exactly as listed above; letters a–g each used once.
  - `pairHref for all`: `{target:"cd20",disease:"all"}`, open → `/target/cd20?panel=a`; `{target:"cd20",disease:"MS"}`, closed → `/target/cd20?disease=MS&panel=g`.
  - `stripView unrecorded`: offline intro input with `release "recorded"` → `{kind:"unrecorded"}`; same input with default release → today's intro; `contentsWord` → `not recorded`.
- [ ] **Step 2: Run** `cd web && npx vitest run tests/diligenceRelease.test.ts tests/diligence.test.ts` → FAIL.
- [ ] **Step 3: Implement.** Existing callers keep compiling with the defaults.
- [ ] **Step 4: Run** `npx vitest run && npm run lint && npx tsc -b` → PASS.
- [ ] **Step 5: Commit** `feat(web): diligence release state, index loader and panel letters`.

### Task 3: Target page: diligence first when open

**Files:**
- Modify: `web/src/components/target/TargetPage.tsx`, `TargetDiligence.tsx`, `DiligenceStrip.tsx`, `TargetChain.tsx`, `TargetDiseases.tsx`, `TargetRisk.tsx`, `target.css`/`diligence.css` as needed
- Test: `web/tests/TargetPage.test.tsx`, `web/tests/TargetPageDiligence.test.tsx`, `web/tests/TargetDiligence.test.tsx`

**Interfaces:**
- Consumes: `useDiligenceRelease`, `isOpen`, `panelLetters`, `pairHref`, `stripView(r, release)`, `contentsWord(r, release)` from Task 2.
- Produces: every panel's heading id is `p{letter}` and its visible letter is `letter`, both from `panelLetters(isOpen(release))`; panel components take a `letter: string` prop.

- [ ] **Step 1: Write failing tests** (mock `loadIndex` / the fetch of `diligence/index.json`):
  - `closed keeps today's order`: index 404 → contents strip reads a Timeline … g Diligence; diligence section is the last panel; heading ids `pa`…`pg` as today.
  - `open puts diligence first`: index with `cd20/MS` → contents strip first item `a Diligence`, then `b Timeline` … `g Stop chance`; the diligence section precedes the timeline section in DOM order.
  - `open with no trials`: a row with zero marks in the disease → diligence panel a still renders first.
  - `strip action targets the diligence panel id`: header strip's go action scrolls to `pg` when closed and `pa` when open.
  - `recorded, no memo for the pair`: strip text `AI diligence: no memo recorded for this target yet` with link `See recorded memos →` to `/diligence`; panel shows `No recorded memo for this target yet.`; the text `The diligence agent is offline.` is absent.
  - `recorded, memo present`: memo renders as today (reuse the existing fixture `web/tests/fixtures/diligence/cd20__MS.json`).
  - `pending shows the skeleton`: before the index settles, the page renders `Skeleton` (no panels), so panels never jump.
  - `?panel=a` deep link when open lands on the diligence heading.
- [ ] **Step 2: Run** the three test files → FAIL.
- [ ] **Step 3: Implement.** Build the panel order from `panelLetters`; render `TargetDiligence` before the timeline section when open; `TargetPage` keeps `Skeleton` while `release === "pending"`; `Intro` gains the recorded-only copy; `DiligenceStrip` renders the `unrecorded` view.
- [ ] **Step 4: Run** `npx vitest run && npm run lint && npx tsc -b` → PASS.
- [ ] **Step 5: Commit** `feat(web): target pages put diligence first once memos are recorded`.

### Task 4: Diligence page and nav item

**Files:**
- Create: `web/src/components/diligence/DiligencePage.tsx`, `web/src/components/diligence/diligence-page.css`
- Modify: `web/src/App.tsx` (route `/diligence`), `web/src/components/SiteNav.tsx` (both nav lists), `web/src/components/DiligenceMethods.tsx` (export `useEvalReport` and `EvalReport`)
- Test: `web/tests/DiligencePage.test.tsx`, `web/tests/AppRoutes.test.tsx`

**Interfaces:**
- Consumes: `useDiligenceRelease`, `pairHref` (Task 2); `loadRecorded`, `claimCounts`, `formatRunDate` (`lib/diligence.ts`); `usePipelineFile` (`lib/useDisease.ts`) for target and disease labels; `PageHead`.
- Produces: route `/diligence`; when the release is `closed`, the route redirects to `/methods` (the Methods diligence section) and the nav item is absent.
- Produces: `web/src/components/diligence/PairPicker.tsx`: `export function PairPicker({ pairs, rows, diseases, live }: { pairs: RecordedPair[]; rows: PipelineRow[]; diseases: { code: string; label: string }[]; live: boolean }): JSX.Element` — target select, disease select (recorded: only recorded pairs, disease options filtered by the chosen target; live: every row and its diseases plus `All diseases`), and the `Open memo →` button navigating to `pairHref(choice, true)`. Task 5 reuses it.

Page sections, in order (spec §6.3): PageHead (title `AI diligence`, one sentence, the not-investment-advice label) → How it works (three steps: draft with citations → checker removes unsupported claims → judgement shown only if its reasons survive; one row ≥ 768px, one column below) → Recorded memos table (target · disease · AI read (stance, confidence or `withheld`) · claims supported `n of m` · removed · recorded date · link via `pairHref(p, true)`; phone: two-line rows) → How well it does (support rate, checker agreement, judgement shown rate, mean cost from `eval-report.json`; absent numbers not shown; link `How it is measured →` to `/methods?s=diligence` or the existing Methods anchor) → live only: a target and disease picker (native selects) going to `pairHref`.

- [ ] **Step 1: Write failing tests:**
  - `lists recorded memos`: index with `cd20/MS` and `btk/MS`, fixture memos → two rows with label from pipeline.json, stance and `n of m` equal to `claimCounts` of the fixture, links `/target/cd20?disease=MS&panel=a`.
  - `skips a pair whose memo is missing`: second memo 404 → one row, no error text.
  - `withheld judgement reads withheld`.
  - `hides quality numbers without eval-report`.
  - `closed redirects to methods` and `nav has no Diligence item when closed`; `nav order when open` equals the Global Constraints list.
  - `no picker in recorded state`; `picker in live state lists every pipeline row`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** on the Figure Plate (PageHead, `.page`, tokens, scale; no new colours).
- [ ] **Step 4: Run** `npx vitest run && npm run lint && npx tsc -b` → PASS.
- [ ] **Step 5: Commit** `feat(web): Diligence page and nav item`.

### Task 5: Front-door band

**Files:**
- Create: `web/src/components/pipeline/DiligenceBand.tsx`, `web/src/components/pipeline/diligence-band.css`
- Modify: `web/src/components/pipeline/PipelinePage.tsx` (band between the page head and the figure when open; today's `DiligenceLine` only when closed)
- Test: `web/tests/PipelinePage.test.tsx`

**Interfaces:**
- Consumes: `useDiligenceRelease`, `pairHref`, `RecordedPair` (Task 2); `PairPicker` (Task 4); `usePipelineFile` for labels.

Band copy (spec §6.2): label `AI diligence`; sentence `An agent drafts a cited memo on a target, then a checker removes every claim its sources do not support.`; `PairPicker` (in the band it shows in both recorded and live states); link `Read how it works →`; fixed label `AI judgement from public data, not investment advice`. Phone (< 768px): one sentence, selects stacked, button full width, above the figure.

- [ ] **Step 1: Write failing tests:**
  - `closed shows today's example line, no band`.
  - `recorded shows the band with recorded pairs only`; choosing `CD20` then `MS` and pressing `Open memo →` navigates to `/target/cd20?disease=MS&panel=a`.
  - `all-diseases option`: a recorded `cd20/all` pair shows `All diseases` and links to `/target/cd20?panel=a`.
  - `band never POSTs /runs`: live state with a spy on `fetch` → after choosing and opening, no request to `…/runs`.
  - `band carries the not-investment-advice label`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run && npm run lint && npx tsc -b` → PASS.
- [ ] **Step 5: Commit** `feat(web): front-door diligence band`.

### Task 6: End-to-end, screenshots and docs

**Files:**
- Create: `web/tests/fixtures/diligence/index.json` (synthetic, `{"runs":[{"target":"cd20","disease":"MS"}]}`)
- Modify: `web/e2e/diligence.spec.ts`, `web/e2e/front-door.spec.ts`; `DESIGN.md`, `PRODUCT.md`, `.impeccable/design.json`, `docs/superpowers/HANDOFF.md` §00, `docs/superpowers/plans/2026-11-09-diligence-agent.md` Task 11 (one line: after recording, run `uv run python scripts/site_index.py` if the index was not written)

- [ ] **Step 1: e2e** (route interception for `**/diligence/index.json` and the memo, as the existing spec does): closed (index 404) → no band, no nav item, diligence last; recorded → band visible at 1280 and 375, band → target page with diligence first and memo shown; `/diligence` lists the row; at 375 `document.documentElement.scrollWidth <= 375` on the front door, target page and Diligence page.
- [ ] **Step 2: Run** with the e2e recipe (back up and restore `web/dist/data`; `PW_PORT=4181 PW_CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run e2e`) → all pass.
- [ ] **Step 3: Screenshots** of closed and recorded states (front door, CD20 MS target page, `/diligence`) at 1280 and 375, light and dark, on a port ≥ 4180, into the session scratchpad; measure the front door's first-data offset at 375 before and after (spec §6.2 expects +60–90px) and record it in HANDOFF.
- [ ] **Step 4: Docs.** DESIGN.md: the band, the page, the panel-order rule. PRODUCT.md: the diligence capability line names the three entry points and the release gate. HANDOFF §00: session-13 block (state, gate, how to switch to live by setting the `DILIGENCE_URL` repo variable).
- [ ] **Step 5: Run** full gates `npx vitest run && npm run lint && npx tsc -b` and `cd agent && uv run pytest -q` → PASS. **Commit** `test(web): diligence centrepiece e2e; docs`.
