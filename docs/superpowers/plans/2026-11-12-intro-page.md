# Intro Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new intro page at `/` where every trial is a dot and the page tours six arrangements of the same dots (one per section); the pipeline figure moves to `/pipeline`.

**Architecture:** The daily export writes a compact columnar `intro.json` (built from the explorer, pipeline, risk and 7-day change data it already has). The web app turns it into seven dot layouts with pure functions (`web/src/lib/intro.ts`), animates between them on one 2D canvas (`DotCanvas`), and a small hook drives the auto-tour. Routes: `/` intro, `/pipeline` figure, `/` with a query redirects to `/pipeline` with that query.

**Tech Stack:** Python 3 + polars (pipeline), pytest; React 19 + TypeScript + Vite, vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-12-intro-dots-design.md` (approved). Reference spike (behaviour only, do not copy blindly): `../trials-intro-spike/web/src/components/intro/DotsIntro.tsx` and `dots.css` on branch `spike/intro-page`.

## Global Constraints

- No source file under `pipeline/src` or `web/src` names the area or a condition (`pipeline/tests/integration/test_config_swap.py::test_no_source_file_names_an_area`, words: sclerosis, neuroimmun, myasthenia, neuromyelitis, encephalitis, cidp).
- Fits one screen, no page scroll: 1280 × 720 and 375 × 667 and up, light and dark (spec G1).
- Every dot is a real trial; every view agrees with its section (spec G2): pipeline dots use the row state, approaches never show a count that pretends to be the section's.
- Red (`--red`) only for "moved on" (state `adv`). Colours only from theme tokens (`--red --run --stop --fin --unk --ink --muted --rule --plate`); approach hues as the Approach colour mode in DESIGN.md (light `#3c5488 #00a087 #8e5ea2 #4dbbd5 #e0a030 #7e6148`, dark `#8da3d6 #3cc7a8 #cf8fd6 #7fd3e6 #f0c060 #b8977a`, Unclassified `--fin`).
- Hanken Grotesk only; type steps from `plate.css` (`--fs-meta` 12 … `--fs-read` 15); 12px floor except canvas axis ticks (11px allowed).
- Missing-data copy: "The overview appears after the next daily update."
- `intro.json` ≤ 260 KB raw and ≤ 60 KB gzipped on the real data (raised from 150 KB raw, ruling 2026-11-12).
- `prefers-reduced-motion: reduce` → no tour, no tweening.

## Review Focus

1. A window shorter than ~600px desktop or a 375 × 667 phone: nothing overlaps and the page still has no scroll at the reference sizes (Task 7 e2e at both sizes).
2. Theme switched while the canvas is idle: dots and labels repaint in the new colours without a reload (Task 5 test: canvas reads tokens per frame; Task 7 e2e toggles theme and screenshots).
3. Browser tab hidden during the tour: the tour does not race through views in the background (Task 5 `useTour` test with `document.hidden`).
4. Resize mid-transition: dots re-target to the new layout without jumping from (0,0) (Task 5 test: a size change keeps current positions as the `from`).
5. A diligence pair whose target is no longer a pipeline row: the Diligence view skips it instead of drawing an empty cluster (Task 4 test, using `knownPairs`).

---

### Task 1: Area label in config and meta; pipeline kicker reads it

**Files:**
- Modify: `pipeline/src/trialradar/config.py` (`AreaConfig`), `pipeline/src/trialradar/export.py` (`_meta`), `config/area.yaml`
- Modify: `web/src/types.ts` (`Meta`), `web/src/components/pipeline/PipelinePage.tsx` (3 kickers, lines ~102, 254, 281)
- Test: `pipeline/tests/unit/test_config.py`, `pipeline/tests/unit/test_export.py`, `web/tests/PipelinePage.test.tsx`

**Interfaces:**
- Produces: `AreaConfig.label: str | None = None`; `meta.json` key `"area_label": str` (= `label` or, if unset, `name`); TS `Meta.area_label: string`.

- [ ] **Step 1: Failing tests.** `test_label_defaults_to_none` and `test_label_must_not_be_blank` in `test_config.py`; in `test_export.py` extend the meta-shape test so the expected dict has `"area_label": cfg.label or cfg.name`; in `PipelinePage.test.tsx` add `test("kicker uses the area label from meta")` asserting the kicker text is `` `${meta.area_label} · drug pipeline` `` with a fixture meta whose `area_label` is `"Test area"`.
- [ ] **Step 2: Run** `cd pipeline && uv run pytest tests/unit/test_config.py tests/unit/test_export.py -q` and `cd web && npx vitest run tests/PipelinePage.test.tsx` → the new tests FAIL.
- [ ] **Step 3: Implement.** `label` with a not-blank validator like `short`; `_meta` adds `"area_label"`; `config/area.yaml` gets `label: MS and autoimmune neurology`; `PipelinePage` loads meta (`loadMeta`) or receives it from where it already gets data, and renders `{areaLabel} · drug pipeline`, rendering just `Drug pipeline` until meta is read.
- [ ] **Step 4: Regenerate fixtures** `cd pipeline && uv run python scripts/make_web_fixtures.py`; run both suites → PASS, including `test_no_source_file_names_an_area` and `test_committed_web_fixtures_are_current`.
- [ ] **Step 5: Commit** `feat: area label in config and meta; pipeline kicker reads it`.

### Task 2: `intro.json` in the daily export

**Files:**
- Create: `pipeline/src/trialradar/intro.py`
- Modify: `pipeline/src/trialradar/export.py` (`export`), `pipeline/tests/integration/conftest.py` (add `without_intro_coords`), `pipeline/tests/integration/test_web_fixtures.py` (skip `intro.json` bytes, compare without coords)
- Test: `pipeline/tests/unit/test_intro.py`

**Interfaces:**
- Consumes: the `explorer`, `pipeline`, `risk` dicts `export()` already receives; the 7-day window list `export()` builds from `_change_items`.
- Produces: `build_intro_doc(explorer: dict[str, Any], pipeline: dict[str, Any] | None, risk: dict[str, Any] | None, changes: list[dict[str, Any]], day: date) -> dict[str, Any]` and the file `intro.json`, shape:

```jsonc
{
  "generated_for": "YYYY-MM-DD",
  "trial_count": 2993,
  "approaches": [{"key": "targeted", "label": "Targeted drugs"}, ...],   // explorer.approaches order
  "rows": [{"id": "cd20", "label": "CD20"}, ...],                        // pipeline.rows order; [] without pipeline
  "typical": 0.17,            // median of risk.trials[*].typical; null without per-trial risk
  "trials": {                 // parallel arrays, one entry per explorer trial, explorer order
    "id": ["NCT…"], "x": [0.123], "y": [-0.456],                           // 3 decimals
    "outcome": ["running"],   // explorer outcome vocabulary
    "approaches": [["targeted"]],
    "start": [2019],          // start_year or null
    "dz": [["MS"]],           // condition codes (as pipeline marks' dz)
    "marks": [[[0, 3, "run"]]],  // [row index into "rows", column c (1-4), state s] for every pipeline mark of this trial
    "risk": [0.144],          // risk.trials[id].p or null
    "change": [["dates", "date_slip_ge_90d"]]  // [bin, notable_reason or null] or null; non-null reason = notable
  }
}
```

Change bins (field → bin): `completion_date, primary_completion_date, start_date` → `dates`; `overall_status, why_stopped` → `status`; `site_count, site_countries` → `sites`; `enrollment, enrollment_type` → `enrollment`; `primary_outcomes, secondary_outcomes` → `outcomes`; anything else → `other`. One bin per trial: its first notable change's bin and reason, else its first change's bin with null (window order).

- [ ] **Step 1: Failing tests in `test_intro.py`** with small hand-built dicts: `test_columns_are_parallel_and_in_explorer_order`; `test_marks_index_rows_and_keep_state` (a trial on two rows gets both `[row, c, s]`); `test_change_bin_prefers_notable` (a trial with a routine `site_count` then a notable `completion_date` slip → `["dates", "date_slip_ge_90d"]`); `test_unknown_field_goes_to_other`; `test_typical_is_median_and_null_without_risk`; `test_no_pipeline_gives_empty_rows_and_marks`; `test_coordinates_rounded_to_3dp`.
- [ ] **Step 2: Run** `uv run pytest tests/unit/test_intro.py -q` → FAIL (module missing).
- [ ] **Step 3: Implement `build_intro_doc`** in `intro.py`; in `export()` write `intro.json` when `explorer is not None` (using the 7-day `window` list), else `unlink(missing_ok=True)`, like `explorer.json`. Add `test_export_writes_intro_only_with_a_map` to `test_export.py`.
- [ ] **Step 4: Fixtures.** Add `without_intro_coords(site)` (drops `trials.x`/`trials.y`) beside `without_coords`; in `test_web_fixtures.py` add `"intro.json"` to `skip` and assert `without_intro_coords(out) == without_intro_coords(COMMITTED)`. Regenerate fixtures; run `uv run pytest -q` → PASS.
- [ ] **Step 5: Size check on real data.** Build it from the live site's JSON (download `explorer.json`, `pipeline.json`, `risk.json`, `changes/7d.json` from `https://martin-valny.github.io/trials/data/` into the scratchpad, call `build_intro_doc`, `len(json.dumps(doc, separators=(",", ":")))`) → ≤ 260 000 raw and ≤ 60 000 gzipped (`gzip.compress`). If over, shorten before committing.
- [ ] **Step 6: Commit** `feat(export): intro.json for the intro page`.

### Task 3: Web data access for `intro.json`

**Files:**
- Modify: `web/src/types.ts`, `web/src/data.ts`
- Test: `web/tests/intro.test.ts` (new; data part)

**Interfaces:**
- Produces (in `types.ts`): `type Outcome = "succeeded" | "running" | "stopped" | "completed_unknown" | "unknown"`; `type RowState = "adv" | "run" | "stop" | "fin" | "unk"`; `type ChangeBin = "dates" | "status" | "sites" | "enrollment" | "outcomes" | "other"`; `interface IntroFile` matching Task 2's shape (`marks: [number, number, RowState][][]`, `change: ([ChangeBin, string | null] | null)[]`). In `data.ts`: `loadIntro(): Promise<IntroFile | null>` and `isIntroFile(raw: unknown): raw is IntroFile` (all `trials` arrays present and the same length as `id`).

- [ ] **Step 1: Failing tests** `isIntroFile accepts the fixture` (read `tests/fixtures/data/intro.json`) and `isIntroFile rejects ragged columns` (drop one `risk` entry).
- [ ] **Step 2: Run** `npx vitest run tests/intro.test.ts` → FAIL.
- [ ] **Step 3: Implement**; `loadIntro` returns null for 404 or a file that fails `isIntroFile`.
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `feat(web): load intro.json`.

### Task 4: Dot layouts (pure)

**Files:**
- Create: `web/src/lib/intro.ts`
- Test: `web/tests/intro.test.ts` (layouts part)

**Interfaces:**
- Consumes: `IntroFile` (Task 3); `RecordedPair`, `knownPairs` from `web/src/lib/diligenceRelease.ts`.
- Produces:

```ts
export type ViewKey = "all" | "pipeline" | "diligence" | "watchlist" | "approaches" | "changes" | "trials";
export type Paint = RowState | "ghost" | "changed" | "changed-ring" | "multi" | `ap:${string}`;
export interface DotTarget { x: number; y: number; a: number; r: number; paint: Paint }
export interface ViewLabel { text: string; x: number; y: number; align?: CanvasTextAlign; weight?: 400 | 700; size?: number; tone?: "ink" | "muted" }
export interface ViewRule { kind: "axis" | "tick"; x: number; y: number; length: number }  // axis: horizontal, tick: dashed vertical upward
export interface IntroView { dots: DotTarget[]; labels: ViewLabel[]; rules: ViewRule[] }
export const OUTCOME_PAINT: Record<Outcome, RowState>;   // succeeded→adv, running→run, stopped→stop, completed_unknown→fin, unknown→unk
export function cloudPositions(file: IntroFile, w: number, h: number): { x: number; y: number }[];
export function buildViews(file: IntroFile, pairs: RecordedPair[], w: number, h: number): Record<ViewKey, IntroView>;
export function visibleViews(file: IntroFile, pairs: RecordedPair[]): ViewKey[];  // drops "diligence" when pairs is empty, "watchlist" when no risk values
export const VIEW_TEXT: Record<ViewKey, { name: string; to: string; caption: string }>;
```

Layout rules (the spike's, with the spec's corrections): unused dots rest at their cloud position with `a: 0.035`, `paint: "ghost"`. **all:** cloud = explorer x/y scaled to the 1st–99th percentile box at 0.82 of the fit, then 60 rounds of collision relaxation on a spatial hash with minimum distance `clamp(sqrt(0.3·w·h/n), 4, 7)`, clamped 4px inside the canvas; paint `OUTCOME_PAINT`. **pipeline:** rows sorted by number of trials with marks, as many as fit at ≥ 26px; columns Phase 1, Phase 2, Phase 3, Approved use; a trial appears once, on the first (highest) shown row it has a mark on, painted with that mark's state. **diligence:** `knownPairs(pairs, rows)` only; one phyllotaxis cluster per pair (angle step 2.39996 rad); members = trials with a mark on that row whose `dz` includes the disease (`"all"` = any), each trial in its first cluster only; label `"<row label> · <disease>"`. **watchlist:** trials with `risk` on a 0–60% axis (values above clamp to 60%), beeswarm columns stacking upward; ticks 0%, 20%, 40%, 60%+; dashed tick + label `typical N%` at `file.typical`. **approaches:** columns in `file.approaches` order plus `"More than one approach"`; a trial with exactly one approach sits in it (`ap:<key>`), more than one → the extra column (`multi`, hollow ink ring), none → `unclassified`; label + dot count under each; note label "Trials in several approaches are under More than one; the Approaches page counts them in each." **changes:** faint grid of all trials in the bottom 34% (`a: 0.28`, `fin`); changed trials in six bins (Dates, Status, Sites & countries, Enrollment, Outcomes, Other details) inset 50px, notable `changed` r 6, routine `changed-ring` r 5; under each bin `"N trials · M notable"`, or `"N trials · M slipped 90+ days"` when every notable reason in the bin is `date_slip_ge_90d`; line `"X of N trials changed in the last 7 days · solid = flagged as notable"`; with no changes: label "No changes in the last 7 days". **trials:** stacked by start year from 1995 to next year (outside clamps to the ends), ordered adv, stop, run, then the rest; tick label every 5 years.

Captions (`VIEW_TEXT`): all "Every trial is a dot, placed by what it studies. Similar trials sit together." · pipeline "Trials sorted onto their drug target's row and phase. Red ones moved on to the next phase." · diligence "Targets an AI agent has written a checked memo on, each with its trials in that disease." · watchlist "Running trials by their estimated chance of stopping early, against the typical rate." · approaches "Every trial by how its treatment works, from targeted drugs to non-drug care." · changes "Trials whose registry record changed this week, sorted by what changed." · trials "Every trial by the year it started. Open any one for its full record and history." Routes: all `/explore`, pipeline `/pipeline`, diligence `/diligence`, watchlist `/watchlist`, approaches `/approaches`, changes `/changes`, trials `/trials`.

- [ ] **Step 1: Failing tests** (fixture `intro.json` plus a hand-built 12-trial file): `every view has one dot per trial`; `no dot is outside the canvas at 900×430 and 343×380`; `cloud relaxation leaves no two dots closer than 0.9 × min distance`; `pipeline paints the row state, not the trial outcome` (a `succeeded` trial whose only shown mark is `fin` is painted `fin`); `a trial on two rows appears once`; `diligence skips a pair whose target is not a row`; `approaches: multi-approach trial goes to More than one`; `changes: notable beats routine and empty week shows the message`; `visibleViews drops diligence without pairs and watchlist without risk`.
- [ ] **Step 2: Run** `npx vitest run tests/intro.test.ts` → FAIL.
- [ ] **Step 3: Implement** in `web/src/lib/intro.ts`.
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `feat(web): intro dot layouts`.

### Task 5: Canvas animation and tour

**Files:**
- Create: `web/src/components/intro/DotCanvas.tsx`, `web/src/lib/useTour.ts`
- Test: `web/tests/useTour.test.tsx`, `web/tests/DotCanvas.test.tsx`

**Interfaces:**
- Consumes: `buildViews`, `IntroView`, `ViewKey` (Task 4).
- Produces: `useTour(keys: ViewKey[], reduced: boolean): { active: ViewKey; held: boolean; hold(k: ViewKey): void; release(): void }` — starts on `"all"`, advances `"all"` after 3200 ms and others after 4200 ms through `keys` and back to `"all"`; no timer while held, while `document.hidden`, or when `reduced`. `DotCanvas(props: { file: IntroFile; pairs: RecordedPair[]; active: ViewKey; reduced: boolean; label: string })` — measures its box (ResizeObserver), builds views with `buildViews`, animates ~1100 ms ease-in-out cubic with a left-to-right stagger ≤ 320 ms (none when `reduced`), labels fade in after ~700 ms, paints with token colours read via `getComputedStyle` every frame, `ring` paints (`run`, `unk`, `changed-ring`, `multi`) stroked at 1.2px, others filled; `role="img"` with `aria-label={label}`. On a size change the current interpolated positions become the new `from`.

- [ ] **Step 1: Failing tests** `useTour`: advances on schedule (fake timers), `hold` stops it, `release` resumes, `reduced` never advances, a `visibilitychange` to hidden pauses. `DotCanvas`: renders a canvas with the aria-label; with a stubbed 2D context, a theme change (`document.documentElement.dataset.theme = "dark"` plus a CSS var change) changes the `fillStyle` used in the next frame; a resize keeps the previous positions as `from` (assert via an exported `nextFrom(prev, cur)` helper or by spying on the first frame's `arc` calls).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(web): intro canvas and tour`.

### Task 6: Intro page, routes and links

**Files:**
- Create: `web/src/components/intro/IntroPage.tsx`, `web/src/components/intro/IntroKey.tsx`, `web/src/components/intro/intro.css`
- Modify: `web/src/App.tsx`, `web/src/components/SiteNav.tsx` (both Pipeline links → `/pipeline`, drop `end`), `web/src/components/target/TargetPage.tsx` (back links → `/pipeline…`), `web/src/components/target/TargetCompanies.tsx` (company links → `/pipeline?…`), any other `to="/"` / `` `/?` `` link to the figure (grep), existing tests that assumed `/` is the figure (`web/tests/AppRoutes.test.tsx`, `PipelinePage.test.tsx`, `TargetPage.test.tsx`).
- Test: `web/tests/IntroPage.test.tsx`, `web/tests/AppRoutes.test.tsx`

**Interfaces:**
- Consumes: `loadIntro`, `loadMeta`, `useDiligenceRelease` (pairs, release), `usePhone`, `useTour`, `DotCanvas`, `visibleViews`, `VIEW_TEXT`.
- Produces: routes `/` → `RootRoute` (query present → `<Navigate to={"/pipeline" + search} replace />`, else `IntroPage`), `/pipeline` → `PipelinePage`.

Page per spec §5: kicker `` `${meta.area_label} · rebuilt every morning` ``; headline `<b>{N} clinical trials in {area_label}.</b> Six ways to look at them.` (N from `meta.trial_count`, en-GB grouping; "Six" becomes the word for `visibleViews(...).length - 1`); button "Open the pipeline →" to `/pipeline`; lettered list a–f of the visible views (letters re-run when one is hidden); caption `<b>{letter} {name}.</b> {caption}` (all-trials caption links "Explore the map →" to `/explore`); `IntroKey` per view (outcome key: moved on, running, stopped, finished, status unknown; approaches: hues + More than one ring; changes: solid notable / hollow routine; watchlist: running ring + dashed typical); note "Touring the six views · hover one to hold it" while touring on desktop. Desktop: hover/focus a list item → `hold`, leave list → `release`, click/Enter → navigate. Phone (`usePhone`): pills; first tap holds and adds "Open {name} →" link to the caption, a tap on the active pill navigates. Intro height `calc(100dvh - <header height>)` with `min-height: 560px` desktop; phone header height measured, not hard-coded (CSS var set from the header's `offsetHeight` on resize, or a flex column layout on `body` — builder's choice). With `intro.json` null: headline and list render, canvas area shows "The overview appears after the next daily update."

- [ ] **Step 1: Failing tests** `IntroPage.test.tsx`: headline shows the fixture count and area label; list shows six items when pairs exist and five (letters a–e, no Diligence) when release is `closed`; hover on Watchlist sets the caption to its text; click on Approaches navigates to `/approaches`; with `loadIntro` → null the overview message shows. `AppRoutes.test.tsx`: `/` renders the intro; `/?view=year` lands on `/pipeline?view=year`; nav "Pipeline" links to `/pipeline`; brand links to `/`.
- [ ] **Step 2: Run** `npx vitest run` → new tests FAIL.
- [ ] **Step 3: Implement**, then update the existing tests that assumed `/` is the figure.
- [ ] **Step 4: Run** `npx vitest run && npm run lint && npx tsc --noEmit` → PASS; `test_no_source_file_names_an_area` still PASS.
- [ ] **Step 5: Commit** `feat(web): intro page at /, pipeline at /pipeline`.

### Task 7: End-to-end

**Files:**
- Create: `web/e2e/intro.spec.ts`
- Modify: `web/e2e/front-door.spec.ts` (`/` → `/pipeline`, `/#/?…` → `/#/pipeline?…`), `web/e2e/smoke.spec.ts` (route list adds `#/pipeline`)

- [ ] **Step 1: Write `intro.spec.ts`:** at 1280 × 720 and 375 × 667 `document.documentElement.scrollHeight <= innerHeight`; the caption changes from All to Pipeline within 5 s; hover on "Changes" holds (caption unchanged after 6 s); click "Approaches" → URL `#/approaches/…`; `page.emulateMedia({ reducedMotion: "reduce" })` → caption stays "All trials" after 6 s; `goto("/#/?view=year")` → URL `#/pipeline?view=year`; switching theme to Dark keeps the page free of console errors and the canvas non-blank (sample pixel differs from the plate colour).
- [ ] **Step 2: Run** `cd web && npm run e2e` → all PASS (desktop and mobile projects).
- [ ] **Step 3: Commit** `test(e2e): intro page and moved pipeline`.

### Task 8: Docs and finish review

**Files:**
- Modify: `DESIGN.md` (new "Intro" section: layout, list, caption, key, canvas paints, motion and reduced motion, phone pills), `PRODUCT.md` (routes: `/` intro, `/pipeline` figure), `docs/architecture.md` (export writes `intro.json`; module table row `intro`)

- [ ] **Step 1:** Write the doc changes from what shipped.
- [ ] **Step 2:** Impeccable finish review (`impeccable:impeccable-finish-reviewer`, Opus) on the intro at 1280 × 720 and 375 × 667, light and dark, against the spike screenshots; apply material fixes; rerun `npx vitest run`, `npm run e2e`, `uv run pytest -q`.
- [ ] **Step 3: Commit** `docs: intro page in DESIGN, PRODUCT and architecture`.
