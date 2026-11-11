# Phase 1 — Map Usability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Explore map usable: start still with a play/pause control, a hover popup, dropdown filters above the map with select all/none, start–end years plus a year filter, and a site-wide System/Light/Dark theme switch.

**Architecture:** One small pipeline change (`end_year`, `end_estimated` in `explorer.json`); everything else is web. Pure logic (filters, popup text, theme resolution) lives in `web/src/lib/` and is unit-tested; components stay thin. The toolbar replaces the toggle pills in `LegendBar`; `LegendBar` keeps the swatch legend and panel d.

**Tech Stack:** Python 3.12 / polars / pytest (pipeline); React 19 + TypeScript strict, vitest + Testing Library, Playwright (web). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-06-mechanisms-and-graph-design.md` (section 5 is this phase; section 9 the design bar). Phases 2 and 3 get their own plans after this one lands.

## Global Constraints

- React + TypeScript strict; no UI kit or component library.
- Design bar: premium, high-end, no "AI slop" (no generic cards, gradients, glows, emoji, default-looking controls). Style every new control inside `DESIGN.md`'s Figure Plate tokens (`.explore` custom properties `--ink --muted --rule --red --pale --plate`; Hanken Grotesk). Use the `impeccable:impeccable` skill when styling each UI task.
- Red (`--red`) is reserved for succeeded trials (R15); never use it for controls.
- Accessibility: every control keyboard-operable; dropdowns are buttons with `aria-expanded`/`aria-controls`; Escape closes and returns focus; reduced motion never spins.
- localStorage access is wrapped in try/catch; failure means "System".
- No horizontal scroll at 375px (existing e2e).
- Never commit real data. After changing `export.py`/`build.py` output, regenerate fixtures: `cd pipeline && uv run python scripts/make_web_fixtures.py`.
- Gates per task: `cd pipeline && uv run pytest -q && uv run ruff check . && uv run ruff format --check . && uv run mypy src scripts`; `cd web && npx vitest run && npm run lint && npx tsc --noEmit`. e2e: `cd web && npm run build && cp -r tests/fixtures/data dist/data && PW_CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run e2e`.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push (the user pushes).

## Review Focus

1. **Trials with no start year** (`start_year: null`): visible while the year range is the full range; hidden once the user narrows it. Test in Task 4.
2. **Theme before React mounts:** a stored "dark" must not flash light on load (inline script in `index.html`). Test in Task 2 (e2e: `data-theme` present at `DOMContentLoaded`).
3. **"Select none" on a dimension** leaves an empty map with the existing "No trials match these filters" + Reset state, not a broken page. Test in Task 6.
4. **Touch devices:** no hover popup on touch pointers; tap still selects. Test in Task 3 (`pointerType: "touch"` emits no hover).
5. **Popup near canvas edges:** the popup flips left/up so it never overflows the panel (and never causes horizontal scroll at 375px). Test in Task 3 (`popupPosition` pure function).

---

### Task 1: `end_year` and `end_estimated` in `explorer.json`

**Files:**
- Modify: `pipeline/src/trialradar/explorer/build.py` (trial dict, ~line 150)
- Modify: `web/src/types.ts` (`ExplorerTrial`)
- Test: `pipeline/tests/unit/test_explorer_build.py`
- Regenerate: `web/tests/fixtures/data/*` via `make_web_fixtures.py`; update `web/tests/explorer.test.ts` trial factory

**Interfaces:**
- Produces: `ExplorerTrial.end_year: number | null`, `ExplorerTrial.end_estimated: boolean`.

- [ ] **Step 1: Write the failing tests** in `test_explorer_build.py`: add `"end_year"` and `"end_estimated"` to the expected key list (line ~50), and:

```python
def test_end_year_prefers_primary_completion_and_flags_estimates(...):
    # trial A: primary_completion 2023-05-01 ACTUAL, completion 2024 -> end_year 2023, end_estimated False
    # trial B: primary_completion None, completion 2027-01 ESTIMATED -> end_year 2027, end_estimated True
    # trial C: both None -> end_year None, end_estimated False
```
Build the tables with the existing helpers in that file.

- [ ] **Step 2: Run** `cd pipeline && uv run pytest tests/unit/test_explorer_build.py -q` — expect FAIL (missing keys).
- [ ] **Step 3: Implement** in `build.py`: end date = `primary_completion_date` if not null else `completion_date`; `end_year = date.year`; `end_estimated = (the matching *_type column) == "ESTIMATED"`.
- [ ] **Step 4: Run** the test file — PASS. Regenerate fixtures; run the full pipeline gate (fixture staleness test must pass).
- [ ] **Step 5:** Add both fields to `ExplorerTrial` in `web/src/types.ts` and the test factory in `web/tests/explorer.test.ts`; web gate passes.
- [ ] **Step 6: Commit** `feat(explorer): export end year and whether it is estimated`.

---

### Task 2: Theme switch (System / Light / Dark), site-wide

**Files:**
- Create: `web/src/lib/theme.ts`, `web/src/components/ThemeSwitch.tsx`
- Modify: `web/index.html` (pre-paint script), `web/src/App.tsx` (header), `web/src/styles.css`, `web/src/components/explore/explore.css`, `web/src/components/explore/Explore.tsx` (palette from theme)
- Test: `web/tests/theme.test.ts`, `web/tests/ThemeSwitch.test.tsx`, `web/e2e/smoke.spec.ts`

**Interfaces:**
- Produces (`theme.ts`):
  - `type ThemeChoice = "system" | "light" | "dark"`; `type Theme = "light" | "dark"`
  - `readChoice(): ThemeChoice` (localStorage key `"trialradar.theme"`, any error/unknown → `"system"`)
  - `writeChoice(c: ThemeChoice): void` (errors swallowed)
  - `resolveTheme(c: ThemeChoice, systemDark: boolean): Theme`
  - `nextChoice(c: ThemeChoice): ThemeChoice` (system → light → dark → system)
  - `useTheme(): { choice: ThemeChoice; theme: Theme; setChoice(c: ThemeChoice): void }` — sets `document.documentElement.dataset.theme = theme` on every change; follows `prefers-color-scheme` live while `choice === "system"`. One shared store (module-level + `useSyncExternalStore`) so header and Explore agree.

- [ ] **Step 1: Write failing unit tests** (`theme.test.ts`):
  - `resolveTheme("system", true) === "dark"`, `resolveTheme("light", true) === "light"`, `resolveTheme("dark", false) === "dark"`.
  - `nextChoice` cycles system→light→dark→system.
  - `readChoice()` returns `"system"` when `localStorage.getItem` throws (mock with `vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error() })`) and when the stored value is `"purple"`.
  - `writeChoice("dark")` does not throw when `setItem` throws.
- [ ] **Step 2: Run** `cd web && npx vitest run tests/theme.test.ts` — FAIL.
- [ ] **Step 3: Implement** `theme.ts`.
- [ ] **Step 4: Write failing component test** (`ThemeSwitch.test.tsx`): renders a button named `/theme: system/i`; clicking sets `document.documentElement.dataset.theme` to `"light"` and the name to `/theme: light/i`; again → dark.
- [ ] **Step 5: Implement** `ThemeSwitch` (a single compact button with an icon-free text label, e.g. "Auto · Light · Dark" segmented look, styled with the impeccable skill in the header's typographic language) and mount it in `App.tsx` after `FreshnessBadge`.
- [ ] **Step 6: CSS.** Replace every `@media (prefers-color-scheme: dark)` block in `styles.css` and `explore.css` with the same rules under `:root[data-theme="dark"]` (and `:root[data-theme="dark"]:has(.explore)` / `:root[data-theme="dark"] .explore` for the explore blocks). Keep `color-scheme` in sync: `:root[data-theme="dark"] { color-scheme: dark }`, light likewise.
- [ ] **Step 7: Pre-paint script** in `index.html` `<head>`, before the stylesheet:

```html
<script>
  (function () {
    var c = "system";
    try { c = localStorage.getItem("trialradar.theme") || "system"; } catch (e) {}
    var dark = c === "dark" || (c !== "light" && window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  })();
</script>
```
- [ ] **Step 8:** In `Explore.tsx` replace `useMediaQuery("(prefers-color-scheme: dark)")` with `useTheme().theme === "dark"`. `PlateCanvas` re-reads CSS colours each render already, so it follows.
- [ ] **Step 9: e2e** in `smoke.spec.ts`: `test("theme switch persists across reload")` — click the theme button to Dark, reload, assert `html[data-theme="dark"]` immediately after `page.goto` (before waiting for network idle) and the button reads Dark.
- [ ] **Step 10:** Web gate + e2e pass. **Commit** `feat(web): site-wide system/light/dark theme switch`.

---

### Task 3: Spin control and hover popup

**Files:**
- Modify: `web/src/components/explore/PlateCanvas.tsx`, `web/src/components/explore/Explore.tsx`, `explore.css`
- Create: `web/src/components/explore/HoverCard.tsx`
- Modify: `web/src/lib/explorer.ts` (pure helpers)
- Test: `web/tests/PlateCanvas.test.tsx`, `web/tests/explorer.test.ts`, `web/tests/Explore.test.tsx`

**Interfaces:**
- `PlateCanvasProps` gains `spinning: boolean` and `onHover?: (h: { nct: string; x: number; y: number } | null) => void` (x, y in canvas CSS px). Reduced motion overrides `spinning`.
- `explorer.ts` produces:
  - `yearSpan(t: ExplorerTrial): string` — `"2014–2019"`, `"2021–"` (no end), `"2021–2025 (est.)"`, `""` when no start and no end, `"–2019"` when only an end.
  - `popupLines(t: ExplorerTrial): [string, string]` — line 1 `"NCT… · Title"`; line 2 joins non-empty parts with `" · "`: drugs (first 2, `+n` when more), treatment types via `treatmentLabel` (first 2), `phaseLabel(t.phase)`, `yearSpan(t)`.
  - `popupPosition(x: number, y: number, cardW: number, cardH: number, w: number, h: number): { left: number; top: number }` — 12px right/below the pointer; flips to the left/up when it would overflow; clamped to `[4, w - cardW - 4]` and `[4, h - cardH - 4]`.

- [ ] **Step 1: Failing pure-function tests** in `explorer.test.ts`:
  - `yearSpan({start_year: 2014, end_year: 2019, end_estimated: false})` → `"2014–2019"`; `{2021, null}` → `"2021–"`; `{2021, 2025, true}` → `"2021–2025 (est.)"`; `{null, null}` → `""`.
  - `popupLines` for a trial with drugs `["a","b","c"]`, types `["DRUG"]`, phase `"PHASE3"`, 2014–2019 → second line `"a, b +1 · Drug · Phase 3 · 2014–2019"` (use `treatmentLabel`/`phaseLabel` actual outputs).
  - `popupPosition(990, 590, 200, 60, 1000, 600)` → left `≤ 1000-200-4`, top `≤ 600-60-4`; `popupPosition(10, 10, 200, 60, 1000, 600)` → `{left: 22, top: 22}`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Failing canvas tests** in `PlateCanvas.test.tsx` (canvas stubbed as the file already does):
  - with `spinning={false}`, two animation frames produce no redraw beyond the first (spy on the stubbed context's `clearRect` call count after `dirty` is consumed);
  - a `pointermove` over a dot with `pointerType: "mouse"` calls `onHover` with that trial's `nct`; `pointerType: "touch"` does not call it; `pointerleave` calls `onHover(null)`.
- [ ] **Step 6: Implement** in `PlateCanvas`: `live.current.spinning` gates `angle += SPIN`; spin also pauses while `hover !== null`; `move` emits `onHover` (mouse/pen only) when the hovered id changes, with coordinates relative to the canvas box.
- [ ] **Step 7: Failing Explore test** (`Explore.test.tsx`): a button named `"Play rotation"` is present and `aria-pressed="false"` initially; clicking flips to `"Pause rotation"`, `aria-pressed="true"`; with reduced motion mocked on, no such button.
- [ ] **Step 8: Implement** in `Explore.tsx`: `const [spinning, setSpinning] = useState(false)`; the button sits in the top-right corner of panel a (Figure Plate style: small, text + a drawn play/pause glyph in `--ink` at 1.5px stroke; no filled pill); `HoverCard` renders absolutely inside `.panel-a-body` from `onHover` state using `popupLines` + `popupPosition`, `role="tooltip"`, `pointer-events: none`. Style both with the impeccable skill.
- [ ] **Step 9:** Update the caption copy: "Drag to turn, click a dot." → "Drag to turn, hover for details, click to open."
- [ ] **Step 10:** Web gate passes. **Commit** `feat(explore): map starts still with a play control; hover popup`.

---

### Task 4: Filter model — years, select all / none

**Files:**
- Modify: `web/src/lib/explorer.ts`
- Test: `web/tests/explorer.test.ts`

**Interfaces:**
- `Filters` gains `years: [number, number]` (inclusive start-year range).
- `allFilters(f)` sets `years` to `yearBounds(f.trials)`.
- New: `yearBounds(trials: ExplorerTrial[]): [number, number]` (min/max non-null `start_year`; `[0, 0]` when none).
- New: `isFullYears(f: Filters, bounds: [number, number]): boolean`.
- `matches(t, f, bounds)` — gains the `bounds` argument: a trial with `start_year === null` passes only when `isFullYears`; otherwise passes when `years[0] <= start_year <= years[1]`.
- New: `type SetKey = "conditions" | "phases" | "outcomes" | "treatmentTypes"`; `setAll(f: Filters, key: SetKey, all: Iterable<string>): Filters`; `setNone(f: Filters, key: SetKey): Filters`.
- New: `filterSummary(selected: number, total: number): string` → `"all"`, `"none"`, or `"2 of 6"`.

- [ ] **Step 1: Failing tests:** year range includes boundaries; null start year visible at full range and hidden at `[2020, 2024]` when bounds are `[2010, 2026]` (Review Focus 1); `setNone` empties only that key; `setAll` restores it; `filterSummary(6,6) === "all"`, `(0,6) === "none"`, `(2,6) === "2 of 6"`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement**; update the one caller in `Explore.tsx` (`visible`) to pass bounds (memoised `yearBounds(file.trials)`). **Step 4: Run** — PASS; web gate.
- [ ] **Step 5: Commit** `feat(explore): year range and select all/none in the filter model`.

---

### Task 5: `MultiSelect` dropdown and `YearRange`

**Files:**
- Create: `web/src/components/explore/MultiSelect.tsx`, `web/src/components/explore/YearRange.tsx`
- Modify: `explore.css`
- Test: `web/tests/MultiSelect.test.tsx`, `web/tests/YearRange.test.tsx`

**Interfaces:**
- `MultiSelect` props: `{ label: string; options: { value: string; label: string; n: number; swatch?: string; ring?: boolean }[]; selected: ReadonlySet<string>; onChange(next: Set<string>): void; searchable?: boolean }`. Button text: `` `${label}: ${filterSummary(selected.size, options.length)}` ``.
- `YearRange` props: `{ bounds: [number, number]; value: [number, number]; onChange(v: [number, number]): void }`. Button text `"Years: all"` or `"Years: 2018–2024"`. Inside: two `<input type="number">` (labelled "From", "To", min/max = bounds, `from ≤ to` enforced on change) above a two-thumb range track drawn in CSS (two overlaid `<input type="range">`).

- [ ] **Step 1: Failing tests** (`MultiSelect.test.tsx`, user-event):
  - button `"Disease: all"` with `aria-expanded="false"`; click → `true`, a group of checkboxes with each option label and count;
  - "Select none" → `onChange` called with an empty set; "Select all" → every value;
  - unchecking one → set without it;
  - Escape closes and focus returns to the button; click outside closes;
  - with `searchable`, typing filters the visible checkboxes (Select all then applies to the visible ones only — state this in the test name).
  - `YearRange.test.tsx`: typing From 2030 with bounds `[2010, 2026]` clamps to 2026; From greater than To moves To up to From; button text updates.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** both. Popover: positioned under the button, `--plate` background, 1px `--rule` border, no shadow beyond a hairline, checkboxes custom-drawn (square, `--ink` check), counts right-aligned in tabular numerals. Under 640px the popover becomes a full-width sheet fixed to the bottom of the viewport. Use the impeccable skill for the styling pass.
- [ ] **Step 4: Run** — PASS; web gate.
- [ ] **Step 5: Commit** `feat(explore): multi-select dropdown and year range controls`.

---

### Task 6: Toolbar above the map; legend slimmed

**Files:**
- Create: `web/src/components/explore/Toolbar.tsx`
- Modify: `web/src/components/explore/LegendBar.tsx` (remove search/colour/pills; keep a swatch legend for the active colour mode and panel d), `Explore.tsx`, `explore.css`
- Test: `web/tests/Explore.test.tsx`, `web/tests/ExplorePanels.test.tsx` (update), `web/e2e/smoke.spec.ts`

**Interfaces:**
- `Toolbar` props: `{ trials: ExplorerTrial[]; filters: Filters; onFilters(f: Filters): void; bounds: [number, number]; conditions: string[]; order: string[]; mode: ColorMode; onMode(m: ColorMode): void; palette: Palette; shown: number; onFind(): void; onReset(): void }`. Order: Find · Colour (segmented) · Disease · Phase · Outcome · Treatment · Years · "Results posted" switch · "Reset all" (only enabled when any filter differs from `allFilters`). "Showing N of M trials" sits at the end of the row.
- Counts and swatches reuse the existing `tally` logic (move `tally` into `explorer.ts` as an export so Toolbar and LegendBar share it).

- [ ] **Step 1: Failing tests** in `Explore.test.tsx`:
  - the toolbar (`role="toolbar"`, name "Map controls") precedes the canvas in DOM order;
  - opening "Phase", clicking "Select none" shows "No trials match these filters" and a "Reset filters" button; clicking it restores "Showing 14 of 14 trials" (fixture count) — Review Focus 3;
  - "Reset all" is disabled initially and enabled after any change.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** Toolbar and wire it in `Explore.tsx` above `.plate`; reduce `LegendBar` to a legend row (swatches of the active colour mode only, non-interactive) plus panel d. Update existing tests that clicked pills to use the dropdowns.
- [ ] **Step 4: e2e:** update any pill-based steps; add `test("filters live above the map")` asserting the toolbar's bounding box top is above the canvas's top at both viewports, and that at 375px opening a dropdown shows a sheet within the viewport width.
- [ ] **Step 5:** Web gate + e2e pass. **Commit** `feat(explore): toolbar with dropdown filters above the map`.

---

### Task 7: Finish — design review, real data, docs

**Files:**
- Modify: `DESIGN.md` (toolbar, dropdown, popup, theme switch, play control patterns), `docs/superpowers/HANDOFF.md` (session 5 state), `README.md` only if it describes the controls.

- [ ] **Step 1:** Rebuild the real-data preview (HANDOFF §00 commands) and take screenshots of `/explore` in light, dark and 375px, with a dropdown open and the popup showing. Save under `.superpowers/` (git-ignored).
- [ ] **Step 2:** Run the Impeccable finish review (`impeccable:impeccable-finish-reviewer` agent) against `DESIGN.md` and the screenshots; fix every material finding; re-shoot.
- [ ] **Step 3:** Update `DESIGN.md` with the new patterns and `HANDOFF.md` with the phase-1 state and the next step (phase 2 plan).
- [ ] **Step 4:** Full gates (pipeline, web, e2e) green; report counts.
- [ ] **Step 5: Commit** `docs: phase 1 design patterns and handoff`.
