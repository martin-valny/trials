# Design Revision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every target-page panel discoverable (contents strip, diligence strip), show data sooner on every page, and bring Changes, Trials, the trial page and Methods onto the Figure Plate with one type scale.

**Architecture:** One set of plate tokens and type-scale variables moves to `:root` (today each page root redefines them and the legacy pages use a second set). Shared pieces are small components: `PageHead`, `ContentsStrip`, `DiligenceStrip`, plus a `useDiligenceRun` hook that panel g and the strip both read. Legacy pages are restyled in place, reusing the plate's existing controls (`MultiSelect`, segmented pill, the Watchlist's show-more pattern and table).

**Tech Stack:** React 19, TypeScript, Vite, react-router (HashRouter), vitest + Testing Library, Playwright (system Chrome via `PW_CHROMIUM`).

**Spec:** `docs/superpowers/specs/2026-11-10-design-revision-design.md` (approved by Martin 2026-11-10). Read it with this plan; section numbers below (§n) refer to it.

## Global Constraints

- Branch `feat/diligence-agent`. Never push (Martin pushes). Never use port 4173; previews and e2e use ports ≥ 4180 (e2e: `PW_PORT=4181`). Never call AWS. Keep long steps awake with `caffeinate -dims`.
- All commands from `web/`: `npx vitest run <file>`, `npm run lint`, `npx tsc --noEmit`, `npm run build`; e2e `PW_PORT=4181 PW_CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run e2e`.
- Gates at every task end: vitest all green (635 before this plan, count only grows), lint and tsc clean. e2e (71 passed / 3 skipped before) at Tasks 5, 9, 10 and 13.
- Colours only via tokens `--plate --ink --muted --rule --pale --red` and mark tokens `--run --stop --fin --unk --fam`. Red/orange (`--red`) only for "advanced/succeeded" data. No shadows except the existing floating surfaces (tooltip, trial card, lens list, nav sheet, popovers).
- Type scale (§8), as CSS variables on `:root`: `--fs-meta: 12px` (lh 1.45), `--fs-ui: 13px` (1.4), `--fs-body: 14px` (1.5), `--fs-read: 15px` (1.6), `--fs-lede: 19px` (1.35). Display sizes: front-door headline 30px (24px phone), target title 40px (34px phone), trial title 28px. **12px is the floor for text**; allowed exceptions only: SVG axis ticks and canvas numerals (11px), front-door family band labels and "Mostly historical" divider (11px/700 uppercase tracked).
- Fixed copy (verbatim): label "AI judgement from public data, not investment advice"; phone diligence sentence "AI diligence: a cited memo from public sources, checked claim by claim."; desktop sentence "AI diligence: an agent searches ClinicalTrials.gov, ChEMBL, Europe PMC and openFDA, writes a cited memo, and a second model checks every claim."; stop-risk standing note unchanged.
- Every sentence on plate pages is computed from data (strip numbers and diligence line included). Colour is never the only carrier. Keyboard reachable; `prefers-reduced-motion` respected (smooth scroll only under `no-preference`).
- Phone breakpoint ≤ 640px; gutters 40px desktop, 16px phone.
- Deep links use query params (`?panel=f`), never `#` fragments (HashRouter).
- Model mix: Sonnet implementer + Sonnet reviewer for Tasks 1, 2, 3, 9, 10, 11; Opus implementer for UI-heavy Tasks 4, 5, 6, 7, 8, 12; Opus for Task 13's finish review and the whole-branch review.

## Review Focus

1. **Loading and empty data on the strips:** the diligence strip must reserve its height while loading (no layout jump), and the contents strip must list only panels that render (a target with no trials in the chosen disease shows only e and g). Tests in Tasks 4 and 5.
2. **Deep link to a panel that does not render** (`?panel=f` on a target with no scored trials, or after switching disease): no scroll, no error, the param is dropped. Test in Task 5.
3. **Withheld judgement:** the strip never shows a stance when `judgement_shown` is false or the memo is null. Test in Task 3.
4. **Search on the paged Trials list** must search all trials, not the 50 shown, and paging resets when the query or filter changes. Test in Task 10.
5. **Dark theme on the legacy pages:** after token unification nothing on Changes, Trials, the trial page or Methods may read a removed legacy token (blue links, card grey, amber callout). Test in Task 1 (CSS scan) and Task 13 (screenshots).

---

## File Structure

| File | Responsibility |
|---|---|
| `web/src/plate.css` (new) | `:root` plate tokens (light, dark), type-scale variables, base link/focus styles, `.page` column, print rules. Imported once in `main.tsx` after `styles.css`. |
| `web/src/styles.css` | Shared header/nav/theme only; legacy tokens and legacy table/form rules removed by the end of Task 11. |
| `web/src/lib/format.ts` | Add `statusLabel`, `phasesLabel` (NA → "No phase", spec §7); `phaseLabel("NA")` stays "Not applicable" for Explore. |
| `web/src/lib/diligence.ts` | Add pure `stripLine(view)` and `claimCounts(rec)`. |
| `web/src/lib/useDiligenceRun.ts` (new) | The state machine now inside `TargetDiligence.tsx`, unchanged in behaviour. |
| `web/src/components/target/DiligenceRunContext.tsx` (new) | Provider so the strip (header) and panel g share one hook instance. |
| `web/src/components/target/DiligenceStrip.tsx` (new) | The header line (§5). |
| `web/src/components/ContentsStrip.tsx` (new) | Sticky contents nav for target pages and Methods; IntersectionObserver current item; `?panel=` sync. |
| `web/src/components/PageHead.tsx` (new) | Title + one sentence + optional right slot; shared by Watchlist, Approaches, Changes, Trials, trial page, Methods. |
| `web/src/components/target/*` | Header compression, panel ids, f capped at 8. |
| `web/src/components/pipeline/PipelinePage.tsx`, `pipeline.css` | Front-door header compression and the diligence example line. |
| `web/src/components/ChangesFeed.tsx`, `ChangeTable.tsx`, `ChangeRow.tsx` | Plate restyle. |
| `web/src/components/TrialsList.tsx` | Plate restyle + paging. |
| `web/src/components/TrialDetail.tsx` | Plate restyle. |
| `web/src/components/Methods.tsx` | Plate restyle + contents. |
| `web/tests/css-scale.test.ts` (new) | Scans every `src/**/*.css` for font sizes and legacy tokens. |

---

### Task 1: One token set and the type scale (Sonnet)

**Files:**
- Create: `web/src/plate.css`, `web/tests/css-scale.test.ts`
- Modify: `web/src/main.tsx` (import `./plate.css` after `./styles.css`), `web/src/components/pipeline/pipeline.css:3-20`, `web/src/components/explore/explore.css:3,10`, `web/src/components/risk/risk.css:5-6,86-91`, every CSS file with a font size off the scale.

**Interfaces:**
- Produces: tokens `--plate --ink --muted --rule --pale --ladder --red --run --stop --fin --unk --fam` and `--fs-meta --fs-ui --fs-body --fs-read --fs-lede` on `:root` and `:root[data-theme="dark"]` (values copied from `pipeline.css:4,11` and `styles.css:3-12`). Class `.page` (full width, `max-width: 1440px`, `margin: 0 auto`, 40px gutters, 16px ≤ 640px) for later tasks.

- [ ] **Step 1: Write the failing test** `web/tests/css-scale.test.ts`: reads every `src/**/*.css` with `fs` + a recursive walk.
  - `it("uses only scale sizes for text")`: every `font-size: Npx` is in `{12, 13, 14, 15, 19, 20, 22, 24, 28, 30, 34, 40}` or is 11px inside a selector listed in `ALLOWED_11 = [".fam", ".past", ".tick", ".axis", ".numeral"]` (extend the list only with selectors that are SVG ticks, canvas numerals or the uppercase family band; each entry gets a one-line comment). Also accepts `var(--fs-*)`, `clamp(...)`, `em`/`rem` values ≥ .75rem.
  - `it("reads no legacy token")`: no file contains `var(--bg)`, `var(--fg)`, `var(--accent)`, `var(--card)`, `var(--warn-bg)`, `var(--warn-fg)`, `var(--ok)`, `var(--line)`.
  - Write the second test as `it.skip` with a comment naming Task 11, which removes the last legacy token and un-skips it.
- [ ] **Step 2: Run** `npx vitest run tests/css-scale.test.ts` → FAIL listing the off-scale sizes (11.5, 12.5, 13.5, 10.5, 10, 16, 17, 18, 38, 48…).
- [ ] **Step 3: Create `plate.css`** with the `:root` tokens and scale; delete the per-root token blocks in `pipeline.css` and `explore.css` (keep `.pipeline, .target-page { font-family…; font-size: var(--fs-ui) }` behaviour) and the `:root:has(...)` legacy aliases; `risk.css` reads `--ink`/`--rule` directly. Keep `styles.css` legacy tokens for now, but set `--accent` to `var(--ink)` and `--line` to `var(--rule)` on `:root` so legacy pages stop being blue immediately.
- [ ] **Step 4: Snap every off-scale size**: 10/10.5/11.5 → 12 (or 11 where allowed), 12.5 → 13, 13.5 → 14, 16/17/18 → 15 or 19 by role (prose 15, lede 19), 38 → 34, 48 → 40. Header brand stays at its size via a `--fs-brand: 17px` variable (allowed in the test).
- [ ] **Step 5: Run** the css test → PASS; then the full `npx vitest run`, `npm run lint`, `npx tsc --noEmit` → green.
- [ ] **Step 6: Screenshot check** (build to the session scratchpad, serve on 4190): front door and CD20 at 1280 light and dark look the same apart from the size snaps; nothing turned blue or lost its colour.
- [ ] **Step 7: Commit** `style(web): one plate token set on :root and a six-step type scale`.

### Task 2: Registry words (Sonnet)

**Files:** Modify `web/src/lib/format.ts`; Test `web/tests/format.test.ts`.

**Interfaces:**
- Produces: `statusLabel(s: string): string` and `phasesLabel(phases: string[]): string`.

- [ ] **Step 1: Failing tests** in `format.test.ts`:
  ```ts
  expect(statusLabel("RECRUITING")).toBe("Recruiting");
  expect(statusLabel("ACTIVE_NOT_RECRUITING")).toBe("Active, not recruiting");
  expect(statusLabel("NOT_YET_RECRUITING")).toBe("Not yet recruiting");
  expect(statusLabel("ENROLLING_BY_INVITATION")).toBe("Enrolling by invitation");
  expect(statusLabel("COMPLETED")).toBe("Completed");
  expect(statusLabel("TERMINATED")).toBe("Terminated");
  expect(statusLabel("UNKNOWN")).toBe("Unknown");
  expect(statusLabel("SOMETHING_NEW")).toBe("Something new"); // fallback: sentence case
  expect(phasesLabel(["PHASE1", "PHASE2"])).toBe("Phase 1/2");
  expect(phasesLabel(["PHASE2", "PHASE3"])).toBe("Phase 2/3");
  expect(phasesLabel(["PHASE3"])).toBe("Phase 3");
  expect(phasesLabel(["EARLY_PHASE1"])).toBe("Early phase 1");
  expect(phasesLabel(["NA"])).toBe("No phase"); // spec §7; phaseLabel("NA") stays "Not applicable" for Explore
  expect(phasesLabel([])).toBe("—");
  ```
- [ ] **Step 2: Run** `npx vitest run tests/format.test.ts` → FAIL (not exported).
- [ ] **Step 3: Implement** both in `format.ts`; `phasesLabel` joins two numbered phases as "Phase a/b" and otherwise maps through `phaseLabel`.
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `feat(web): registry status and phase words`.

### Task 3: Shared diligence run state and the strip line (Sonnet)

**Files:**
- Create: `web/src/lib/useDiligenceRun.ts`, `web/src/components/target/DiligenceRunContext.tsx`
- Modify: `web/src/components/target/TargetDiligence.tsx:55-200` (move `Shown`, `State`, the load effect, the clock, `run`, into the hook), `web/src/lib/diligence.ts`
- Test: `web/tests/diligence.test.ts`, existing `web/tests/TargetDiligence.test.tsx` (must stay green unchanged except imports)

**Interfaces:**
- Produces:
  ```ts
  // lib/useDiligenceRun.ts
  export interface Shown { rec: RunRecord; source: "recorded" | "backend"; stale: boolean; fresh: boolean }
  export interface DiligenceRun {
    phase: "loading" | "ready" | "running"; shown: Shown | null; attempt: DiligenceStep[] | null;
    notice: string | null; capped: boolean; failed: boolean; // failed: last attempt ended in fail()
    valid: boolean; online: boolean; elapsed: number; lastText: string; canRun: boolean;
    run(force: boolean): Promise<void>;
  }
  export function useDiligenceRun(row: PipelineRow, disease: string | null): DiligenceRun;
  // components/target/DiligenceRunContext.tsx
  export function DiligenceRunProvider(props: { row: PipelineRow; disease: string | null; children: ReactNode }): JSX.Element;
  export function useDiligence(): DiligenceRun; // throws outside the provider
  // lib/diligence.ts
  export function claimCounts(rec: RunRecord): { n: number; m: number }; // n = verdicts "supported"; m = verdicts.length + removed.length
  export type StripView =
    | { kind: "hidden" } | { kind: "loading" }
    | { kind: "intro"; action: "run" | "methods" }
    | { kind: "running"; seconds: number }
    | { kind: "read"; stance: string | null; confidence: string | null; n: number; m: number;
        when: string; stale: boolean; tail: "failed" | "capped" | null }
    | { kind: "failed" } | { kind: "capped" };
  export function stripView(r: Pick<DiligenceRun, "phase" | "shown" | "capped" | "failed" | "valid" | "online" | "elapsed">): StripView;
  ```
  `stance` words: favours → "favours further investment", mixed → "mixed", against → "argues against further investment"; `null` when `judgement_shown` is false or `memo` is null. `when` = "New run, {formatRunDate}" if `fresh`, else "Recorded {formatRunDate}" (move `formatRunDate` from `TargetDiligence.tsx` to `lib/diligence.ts`, re-export from the component for existing tests).

- [ ] **Step 1: Failing tests** in `diligence.test.ts` (build `RunRecord`s from `tests/fixtures/diligence/cd20__MS.json`):
  - `claimCounts`: fixture → the counts computed by hand from the fixture's `verdicts`/`removed` (write the literal numbers into the test).
  - `stripView`: `{valid:false}` → `hidden`; `phase:"loading"` → `loading`; ready, no shown, online → `intro/run`; ready, no shown, offline → `intro/methods`; running → `running` with seconds `Math.round(elapsed/1000)`; shown with `judgement_shown:true` → `read` with stance "favours further investment" (or the fixture's), confidence, n, m, `when` "Recorded …"; same with `judgement_shown:false` → `stance: null`; `fresh:true` → `when` starts "New run"; `stale:true` → `stale:true`; shown + `failed` → `tail:"failed"`; shown + `capped` → `tail:"capped"`; no shown + `failed` → `failed`; no shown + `capped` → `capped`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `claimCounts`, `stripView`, move `formatRunDate`; extract the hook (behaviour identical; add `failed` set true in `fail()` and false on any success); `TargetDiligence` calls `useDiligence()` instead of local state; `TargetPage` wraps header + panels in `DiligenceRunProvider` keyed by `diligenceKey(row.id, disease ?? "all")` (move the key from `<TargetDiligence>` to the provider).
- [ ] **Step 4: Run** `npx vitest run tests/diligence.test.ts tests/TargetDiligence.test.tsx tests/TargetPage.test.tsx` → PASS; full suite, lint, tsc green.
- [ ] **Step 5: Commit** `refactor(web): one diligence run state for panel g and the header strip`.

### Task 4: Diligence strip in the target header and the front-door line (Opus)

**Files:**
- Create: `web/src/components/target/DiligenceStrip.tsx`
- Modify: `web/src/components/target/TargetPage.tsx` (render under the lede), `target.css`, `web/src/components/pipeline/PipelinePage.tsx` (example line), `pipeline.css`
- Test: `web/tests/TargetPage.test.tsx`, `web/tests/PipelinePage.test.tsx`

**Interfaces:**
- Consumes: `useDiligence()`, `stripView()` (Task 3); `EXAMPLE` and `loadRecorded` from `lib/diligence.ts`.
- Produces: `DiligenceStrip(props: { onGo(): void })` where `onGo` scrolls to panel g and focuses its heading (Task 5 supplies the real scroller; until then `document.getElementById("pg")?.scrollIntoView()`); panel g's heading gets `id="pg"`.

- [ ] **Step 1: Failing tests** (`TargetPage.test.tsx`, mocking `lib/diligence` endpoints as the existing diligence tests do):
  - no run, online: strip text contains the desktop sentence; a button "Run diligence →"; clicking it calls `startRun` once and calls `scrollIntoView` on `#pg` (mock it on `Element.prototype`).
  - offline, no run: contains "Offline at the moment." and a link "How it works →" whose target is the Methods diligence section, built exactly as panel g's existing Methods link is built today (read `TargetDiligence.tsx`'s `Intro` and reuse its link).
  - recorded run, judgement shown: text matches `/^AI read: .+ · (high|medium|low) confidence · \d+ of \d+ claims supported · Recorded /` and the label "AI judgement from public data, not investment advice" is present; a link-styled button "Read the memo →".
  - judgement withheld: text contains "judgement withheld" and none of "favours", "mixed", "argues against".
  - loading: an element with `data-state="loading"` and `aria-hidden="true"` exists with the same class as the loaded strip (height reserved by CSS `min-height`).
  - disease with no trials on this target (`!valid`): no strip.
  - phone (`matchMedia` ≤ 640px mocked as in existing phone tests): the intro text is the phone sentence.
  - `PipelinePage.test.tsx`: with no recorded example, the line reads "…How it works →" linking to Methods; with `loadRecorded` resolving a record for `EXAMPLE`, it reads "See an example: CD20 in MS →" linking to `/target/cd20?disease=MS&panel=g`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the strip per §5 table (copy verbatim; " · data has changed since", " · the latest run failed", " · daily run limit reached, try again tomorrow"); 13px (`--fs-ui`), label `--fs-meta`/700, on its own line ≤ 640px; plate tokens only, no red. Front-door line under the source line, `--fs-meta`, ink link; drop the word "New:" if it reads as marketing (builder's call, spec §5).
- [ ] **Step 4: Run** → PASS; full suite, lint, tsc.
- [ ] **Step 5: Look at it**: build to scratchpad, serve 4190, mock backend on 4191 (`mock_backend.py` in the session scratchpad; recreate from HANDOFF §00 if gone), screenshot CD20 · MS at 1280/375 light/dark in states intro, running, read. Stop the servers.
- [ ] **Step 6: Commit** `feat(web): diligence strip in the target header and an example line on the front door`.

### Task 5: Contents strip, deep links and a shorter panel f (Opus)

**Files:**
- Create: `web/src/components/ContentsStrip.tsx`, `web/tests/ContentsStrip.test.tsx`
- Modify: `TargetPage.tsx` (ids `pa`…`pg` on each panel heading, `tabIndex={-1}`; panel d/e/f/g headings get ids `pd pe pf pg`), `TargetRisk.tsx` (cap 8), `TargetChain.tsx`, `TargetDiseases.tsx`, `TargetDiligence.tsx` (`.dg-tr` sticky `top` = `calc(var(--strip-h) + 16px)`), `target.css`, `plate.css` (print rules)
- Test: `web/tests/TargetPage.test.tsx`, `web/e2e/front-door.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ContentsItem { id: string; letter?: string; name: string; count?: string }
  export function ContentsStrip(props: { items: ContentsItem[]; label: string; param?: string /* default "panel" */ }): JSX.Element;
  ```
  Writes `--strip-h` on `document.documentElement` from its measured height. Click/Enter: scroll (smooth only under no-preference), focus `#${id}`, `setSearchParams` with `replace: true` setting `panel=<letter or id>`. On mount with `?panel=x`: when `#p{x}` exists, scroll to it once after first render; when it does not, delete the param (replace). Current item: IntersectionObserver over the targets, nearest to the top below the strip → `aria-current="location"`.
- Target items (§4): `a Timeline`, `b Companies {n}`, `c Stops {n}`, `d Mechanism`, `e Diseases {n}`, `f Stop chance {k} above`, `g Diligence {state}` where state is `recorded {d Mon}` / `not run` / `running` / `offline` from `stripView`. Phone: names only. Only rendered panels.
- Panel f: first 8 rows by estimate, then a text button "Show all {N} running trials"; claim line unchanged (counts all). Print: `@media print` shows all rows, hides `.contents-strip` and `.dg-strip` placeholder-only states.

- [ ] **Step 1: Failing unit tests** `ContentsStrip.test.tsx`: renders a `nav` named by `label`; one link per item in order; clicking item `f` calls `scrollIntoView` on `#pf`, focuses it, and the router location search becomes `?panel=f` (MemoryRouter + a location probe); `?panel=zz` with no `#pzz` → param removed, no scroll; with `matchMedia('(prefers-reduced-motion: reduce)')` true the scroll is called with `behavior: "auto"`.
- [ ] **Step 2: Failing target tests**: CD20 fixture all diseases → strip items `a b c d e f g` with b's count equal to the companies panel's line count; a target/disease with no trials → items `e g` only; panel f shows 8 rows and a "Show all … running trials" button when more than 8 are scored, all rows after clicking; `?panel=f` on a target without risk data → param dropped.
- [ ] **Step 3: Run** → FAIL. **Step 4: Implement.** Sticky with plate ground and hairline bottom; current item 2px ink underline; ≤ 640px one line, sideways scroll, current item scrolled into view (`scrollIntoView({inline:"nearest"})` on the strip only), items ≥ 44px tall, bleed into gutters. Disease chip clicks keep `panel`.
- [ ] **Step 5: Run** → PASS; full suite, lint, tsc.
- [ ] **Step 6: e2e** in `front-door.spec.ts`: open `#/target/cd20?panel=f` → the "Running trials, estimated chance of stopping early" heading is in the viewport; keyboard: Tab to the strip's "g" link, Enter → focus is on panel g's heading. Run the full e2e → green.
- [ ] **Step 7: Commit** `feat(web): contents strip with deep links on target pages; panel f shows 8 then all`.

### Task 6: Target header, shorter (Opus)

**Files:** Modify `TargetPage.tsx:110-160`, `target.css:6-20`. Test `TargetPage.test.tsx`.

- [ ] **Step 1: Failing tests:** no element with `role="group"` named "Key numbers" on the target page; the lede still contains "of", "running", "advanced", "stopped" with the counts; the disease chips group is still named "Diseases"; panel c's reason chips have `border-radius: 999px` (class `reason-pill`, spec §9: pills on a hairline border, not 6px boxes on `--pale`).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** §6: drop the key numbers; crumb and title row tightened (crumb 16px top padding, title 40px/600, 34px phone); at ≥ 1100px disease chips right-aligned on the title row, below that under the title on one sideways-scrolling line (front door's disease switch behaviour); lede at `--fs-lede` desktop, `--fs-read` phone.
- [ ] **Step 4: Run** → PASS; suite, lint, tsc.
- [ ] **Step 5: Measure** with the scratchpad `measure.mjs` (serve on 4190; update its target selector to the timeline svg) in the diligence "intro" state (longest): CD20 · MS ≤ 330px at 1280, ≤ 470px at 375. If missed, tighten spacing inside the header (not the honesty text); if still missed, report the numbers to the controller.
- [ ] **Step 6: Commit** `style(web): target header says each number once and starts the timeline sooner`.

### Task 7: Front-door header, shorter (Opus)

**Files:** Modify `PipelinePage.tsx`, `pipeline/parts.tsx` (where the lede/keys/source render; confirm by reading), `pipeline.css:25-61`, footer in `PipelinePage.tsx`. Test `PipelinePage.test.tsx`, `e2e/front-door.spec.ts` (h1 text check stays).

- [ ] **Step 1: Failing tests:** key numbers group has exactly two keys ("advanced to a later phase", "companies with a running trial"), no "trials still running" key; the source paragraph above the figure is one sentence ending "How rows are built →" (link to Methods `#rows-and-companies`); the full source text is in the footer.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** §6 front door: headline 30px max ~34ch (24px phone), kicker kept on its own 12px line, top padding 24px, legend joins the controls' second line at ≥ 1100px, phone: two keys inline on one line, source line after the figure.
- [ ] **Step 4: Run** → PASS; suite, lint, tsc. **Step 5: Measure** first row ≤ 400px at 1280, ≤ 480px at 375.
- [ ] **Step 6: Commit** `style(web): front-door headline on two lines, caveat to the footer`.

### Task 8: PageHead; Watchlist and Approaches adopt it (Opus)

**Files:** Create `web/src/components/PageHead.tsx`; Modify `watchlist/WatchlistPage.tsx:38-45`, `watchlist.css:4-9`, `mechanisms/MechanismsPage.tsx` (title block), `explore.css` (Approaches title spacing). Test `Watchlist.test.tsx`, `Mechanisms.test.tsx`.

**Interfaces:**
- Produces: `PageHead(props: { title: ReactNode; sentence?: ReactNode; aside?: ReactNode; crumb?: ReactNode }): JSX.Element` — `<header className="page-head">` with `h1` (Display for the page, default 34px desktop/28px phone), one sentence at `--fs-read`, `aside` right-aligned ≥ 1100px. 24px top gap, `.page` gutters.

- [ ] **Step 1: Failing tests:** Watchlist renders one sentence "237 running drug trials, ranked by estimated chance of stopping early; 79 sit above their phase's typical rate." for the fixture's numbers (derive the literal from the fixture) and no separate `.wl-claim`; the standing note sits after the filters toolbar in DOM order. Approaches h1 still contains "Figure 2 |".
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; suite, lint, tsc.
- [ ] **Step 5: Measure** Watchlist ≤ 300 / ≤ 400; Approaches ≤ 290 / ≤ 460.
- [ ] **Step 6: Commit** `feat(web): shared page head; Watchlist and Approaches use it`.

### Task 9: Changes on the plate (Sonnet)

**Files:** Modify `ChangesFeed.tsx`, `ChangeTable.tsx`, `ChangeRow.tsx`, add `web/src/components/changes.css`. Test `ChangesFeed.test.tsx`, `e2e/smoke.spec.ts:16-19` (selector `table.changes tbody tr` — keep the class `changes` on the table).

- [ ] **Step 1: Failing tests:** window picker is a group named "Time window" of three `aria-pressed` buttons (was a `tablist`; update existing tests that use `role="tab"`); Sponsor and Field are `MultiSelect` dropdowns (`button` named "Sponsor: all" / "Field: all"); "Notable only" is a `aria-pressed` button, pressed by default; status values render through `statusLabel` ("Completed", not "COMPLETED"); dates through `formatDate` ("6 Nov 2026", not "2026-11-06").
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** with `PageHead` (title "Changes", sentence "{n} changes to tracked trials in the last {window}; {k} notable.") and the Watchlist table look; phone two-line rows, no cards, no uppercase labels.
- [ ] **Step 4: Run** → PASS; suite, lint, tsc; e2e smoke → green.
- [ ] **Step 5: Measure** first row ≤ 260px at 1280, ≤ 330px at 375; confirm "Notable only" is visible and toggles in a screenshot (spec §9).
- [ ] **Step 6: Commit** `style(web): Changes on the Figure Plate`.

### Task 10: Trials on the plate, 50 at a time (Sonnet)

**Files:** Modify `TrialsList.tsx`, add `web/src/components/trials.css`. Test `TrialsList.test.tsx`, `e2e/smoke.spec.ts:31-34` (keep `table.trials`).

- [ ] **Step 1: Failing tests:**
  - with > 50 fixture trials (build a list in the test if the fixture has fewer): 50 rows render, "Showing 50 of {N}" text, a button "Show 50 more" (or "Show {r} more" when fewer remain) adds rows.
  - searching for an NCT that sits beyond row 50 shows it (search covers all).
  - changing the query or Status filter resets to 50.
  - status shows as words with the plate mark (`statusLabel`), phases via `phasesLabel`, dates "6 Nov 2026".
  - the `?nct=` banner still reads "Showing {n} trials from {from} · Clear".
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (reuse the Watchlist's `PAGE` show-more logic; extract it to `lib/useShowMore.ts` if both pages would copy it — builder's call); search as the plate find pill; Status as `MultiSelect` with counts; `PageHead` title "Trials", sentence "{N} tracked trials, most recently changed first."; phone two-line rows.
- [ ] **Step 4: Run** → PASS; suite, lint, tsc; e2e smoke → green.
- [ ] **Step 5: Measure** first row ≤ 260px at 1280, ≤ 330px at 375; page height at 1280 under 8,000px (was 285,616).
- [ ] **Step 6: Commit** `feat(web): Trials on the Figure Plate, 50 at a time`.

### Task 11: Trial page on the plate; legacy tokens removed (Sonnet)

**Files:** Modify `TrialDetail.tsx`, `styles.css` (delete legacy tokens `--bg --fg --accent --card --warn-bg --warn-fg --ok --line` and the `.tabs .filters select table.changes .facts .callout .placeholder .timeline` rules no longer used), add `web/src/components/trial.css`. Test `TrialDetail.test.tsx`, `css-scale.test.ts` (un-skip "reads no legacy token").

- [ ] **Step 1: Failing tests:** facts terms are sentence case ("Status", "Lead sponsor"), values via `statusLabel`/`phasesLabel`/`formatDate`; title is `h1` at the page head; breadcrumb link back to where the visitor came from keeps today's target (read today's back-link logic first and keep it); "Why stopped" renders without the amber callout class; un-skipped css test fails until legacy tokens are gone.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** §7 trial page (two-column fact list like the trial card, plain section headings 13px/700 over an ink rule; stop-risk block content unchanged). Remove legacy tokens and rules; fix every remaining reader (Methods' `rk-m-table` uses `--rule`).
- [ ] **Step 4: Run** → PASS (incl. the css test); suite, lint, tsc.
- [ ] **Step 5: Measure** facts start ≤ 240px at 1280, ≤ 380px at 375; dark screenshots of Changes, Trials, the trial page and Methods show no blue, card grey or amber.
- [ ] **Step 6: Commit** `style(web): trial page on the Figure Plate; legacy tokens removed`.

### Task 12: Methods on the plate with contents (Opus)

**Files:** Modify `Methods.tsx`, `DiligenceMethods.tsx`, `risk/RiskMethods.tsx` (headings only), add `web/src/components/methods.css`. Test `Methods.test.tsx`.

**Interfaces:** Consumes `ContentsStrip` (Task 5) with `param="s"` and items from the `h2` sections (every `h2` gets an `id`; existing ids `advanced`, `registry-only`, `rows-and-companies`, `unrowed`, `approved`, `map`, `stop-risk`, `diligence` are kept; new ids for "What is tracked" `tracked`, "How changes are detected" `changes`, "Limitations" `limitations`).

- [ ] **Step 1: Failing tests:** a `nav` named "On this page" lists every `h2` in order; each `h2` has an id; existing deep links (`/methods#stop-risk`, `#diligence`) still scroll to their section (read how they work today — the app reads the second hash — and keep it; `?s=` is the strip's own param).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**: ≥ 1100px contents as a sticky left column (`ContentsStrip` in a vertical variant: add `orientation?: "row" | "column"` prop to `ContentsStrip`), prose 68ch at `--fs-read`/1.6; below 1100px the contents list as a block at the top. Headings on the scale.
- [ ] **Step 4: Run** → PASS; suite, lint, tsc.
- [ ] **Step 5: Commit** `style(web): Methods on the Figure Plate with a contents list`.

### Task 13: Docs, measurements, screenshots and finish review (Opus)

**Files:** Modify `DESIGN.md` (scope section: the system now covers every route; contents strip, diligence strip, PageHead, type scale, legacy pages; drop the "do not yet" Don't), `.impeccable/design.json` (tokens and type scale), `PRODUCT.md` (diligence strip sentence), `docs/superpowers/HANDOFF.md` §00 (session 12 block).

- [ ] **Step 1:** Build to the scratchpad with real data (2026-11-06 snapshot + session-10 `risk.json`, as in this session), serve on 4190, mock on 4191; run `measure.mjs` and `type.mjs` at 1280 and 375; write the before/after table into HANDOFF (before values from spec §3). Every target in spec §6 met, or the miss explained with numbers.
- [ ] **Step 2:** Screenshots of every page at 1280/375 × light/dark into the scratchpad `shots-after/`; compare with `shots/` side by side.
- [ ] **Step 3:** Keyboard-only pass of a target page and Methods; screen-reader names of both strips (Playwright `getByRole('navigation', { name })`); print preview (`page.pdf` or `emulateMedia({ media: "print" })`) of CD20 shows all f rows and no strips.
- [ ] **Step 4:** Full gates: vitest, lint, tsc, build, e2e (`PW_PORT=4181`). Stop all servers.
- [ ] **Step 5:** Opus finish review against the spec and DESIGN.md (use `impeccable:impeccable-finish-reviewer` agent type if the security hook allows it; otherwise a general Opus reviewer given the spec, DESIGN.md and the after screenshots); fix the material findings in one wave; re-review.
- [ ] **Step 6: Commit** `docs: design revision shipped (DESIGN, design.json, PRODUCT, HANDOFF)`.
