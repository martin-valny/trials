# By Year Arrangement and Explore Retirement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a By year arrangement to the pipeline figure and take Explore out of the nav, sending "on the map" links to a filtered Trials list.

**Architecture:** Pure year binning and note rules go in `web/src/lib/pipeline.ts` next to the existing arrangement logic; the figure components gain a third column mode; `TrialsList` learns `?nct&from&disease`; map links are replaced site-wide.

**Tech Stack:** React 19 + TypeScript strict + Vite, react-router (HashRouter), vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-09-by-year-and-explore-retire-design.md` (amends `2026-11-08-front-door-pipeline-design.md`). Mock: `docs/superpowers/mockups/2026-11-08-front-door/by-year.png`.

## Global Constraints

- Never push; never bypass the sandbox; port 4173 is Martin's (use 4175–4179, stop servers). Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Web gates per task: `cd web && npx vitest run && npm run lint && npx tsc --noEmit`; e2e when routes/flows change: `PW_CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run e2e`.
- Values: axis from **2000**; first bin collects every earlier start and is labelled "≤2001" (desktop) / "≤2002" (phone); **2-year bins** above 640px, **3-year bins** at ≤ 640px; null start years not drawn and counted in the source line; ticks every 5 years; marks 4px (phone 3.5px), stacked bottom-up, order adv → run → stop → fin → unk.
- By year notes (exact copy, in order, distinct rows, max 4, hidden under the company lens): Rising (min 5 trials, ≥ 60% started in the last `NEWEST_YEARS` years) "{r} of {n} trials started since {year}."; Fading (≤ 1 running, most trials started before 2012, min 15) "{k} trials before 2012; {run} running now."; Longest run (rows with ≥ 20 dated trials, span ≥ 15 years) "Trials every few years since {first year}."
- Nav: Pipeline · Approaches · Changes · Trials · Methods. `/explore` route stays. Link copy "List these {n} trials →". Trials banner "Showing {n} trials from {from} · Clear"; empty "None of these trials are in the current data."
- Real-data site for visual checks (never commit): `/private/tmp/claude-503/-Users-martin-valny-Desktop-trials/1abea365-c67e-4376-ade2-a908299d245a/scratchpad/build/site/`.

## Review Focus

1. A row whose trials all started before 2000 (e.g. some historical rows): everything lands in the first "≤2001" bin, nothing is lost. Test in Task 1 (`yearBins puts pre-2000 starts in the first bin`).
2. A bookmarked `?view=year&disease=AE` with an empty result: calm empty state, no crash. Test in Task 2.
3. `/trials?nct=` with unknown or duplicate NCTs: ignored/deduped, count correct. Test in Task 3.
4. Old bookmarks to `/explore?nct=…`: still render the map (route kept). Test in Task 3.
5. Phone width with 3-year bins: no horizontal scroll. e2e in Task 3.

---

### Task 1: Year binning and By year notes (lib)

**Files:** Modify `web/src/lib/pipeline.ts`; Test `web/tests/pipeline.test.ts`.

**Interfaces:**
- `Arrangement = "phase" | "disease" | "year"`; `parseFigureState`/`figureSearch` accept and round-trip `view=year`.
- `export const YEAR_START = 2000;`
- `export interface YearBin { start: number; label: string }` and `export function yearBins(thisYear: number, width: 2 | 3): YearBin[]` — bins from 2000 to thisYear; first label `"≤" + (2000 + width - 1)`, others the start year.
- `export function binOf(year: number | null | undefined, bins: YearBin[]): number | null` — index; pre-2000 → 0; null/undefined → null.
- `cellMarks(v, column, s)` handles `s.view === "year"` with `column` = bin index (the caller passes the bins; add an optional `bins?: YearBin[]` parameter).
- `export function yearNotes(views: RowView[], s: FigureState, thisYear: number): Map<string, MarginNote>`; `marginNotes` delegates to it when `s.view === "year"`.
- `export function undatedCount(views: RowView[]): number` (distinct trials with no start year), for the source line.

- [ ] Step 1: failing tests — `yearBins(2026, 2)` first `{start:2000,label:"≤2001"}`, last start 2026; `yearBins(2026, 3)` first label "≤2002"; `binOf(1994, bins) === 0`, `binOf(null, bins) === null`; `parseFigureState(?view=year)` → view "year" and `figureSearch` round-trip; `yearNotes` Rising/Fading/Longest run thresholds with synthetic rows, distinct rows, max 4, empty under company lens; `marginNotes` with view year returns yearNotes; `cellMarks` year column.
- [ ] Step 2: run `npx vitest run tests/pipeline.test.ts` — FAIL.
- [ ] Step 3: implement.
- [ ] Step 4: PASS; web gates.
- [ ] Step 5: commit `feat(web): year bins and By year notes`.

### Task 2: By year on the pipeline figure (UI)

**Files:** Modify `web/src/components/pipeline/{FigureControls,PipelineFigure,PipelineStrip,PipelinePage}.tsx`, `pipeline.css`; Test `web/tests/PipelinePage.test.tsx`.

**Interfaces:** consumes Task 1. Arrangement switch gets a third button "By year". Desktop grid columns become `yearBins(thisYear, 2)` (one grid column per bin, equal width), header ticks every 5 years (bin labels only where `start % 5 === 0` or the first bin), plus a vertical "data as of" hairline through all rows at the snapshot date (`generated_for`). Phone strip uses `yearBins(thisYear, 3)`. Disease filter stays visible in By year. Source line appends "; {k} trials without a start year are not drawn" when k > 0. Match the mock's look (`by-year.png`) but with the spec's axis/bins.

- [ ] Step 1: failing tests — switch to By year sets `view=year`; renders the bin headers incl. "≤2001"; notes show "Rising" kicker on the fixture where thresholds allow (else assert none rendered and no crash); `?view=year&disease=AE` empty state copy; phone strip renders 3-year bins (mock matchMedia as existing tests do).
- [ ] Step 2: run — FAIL. Step 3: implement. Step 4: PASS; web gates; screenshot `/?view=year` at 1280 and 375, light and dark, on the real-data site (build, copy dist + site as data into scratch, serve 4175, stop) into `<scratch>/shots-by-year/`; compare to `by-year.png`.
- [ ] Step 5: commit `feat(web): By year arrangement on the pipeline figure`.

### Task 3: Explore out of the nav; "List these trials"

**Files:** Modify `web/src/components/SiteNav.tsx`, `web/src/components/TrialsList.tsx`, `web/src/components/target/TargetPage.tsx`, `web/src/components/pipeline/{TrialCard,PipelinePage}.tsx`, `web/src/components/mechanisms/{SidePanel,MechanismsPage}.tsx`, `web/src/components/Methods.tsx`; Tests `web/tests/TrialsList.test.tsx`, `AppRoutes.test.tsx`, `TargetPage.test.tsx`, `TrialCard.test.tsx`, `Mechanisms.test.tsx`, `Methods.test.tsx`, `plainWords.test.tsx`, `web/e2e/front-door.spec.ts`, `web/e2e/smoke.spec.ts`.

**Interfaces:** `export function trialsLink(ncts: string[], from: string, disease: string | null): string` in `web/src/lib/pipeline.ts` (or a small `lib/links.ts`) → `/trials?nct=…&from=…[&disease=…]`; replaces every map-link builder (SidePanel `mapLink`, Methods `mapLink`, TargetPage, MechanismsPage). TrialCard drops "Show on map". Footer/intro "Trial map" links removed or pointed at Trials. Methods `map-statistic` gains the line "Similarity map (experimental): trials laid out by how alike they are →" linking `/explore`. `TrialsList` reads `nct` (dedupe, ignore unknown), `from`, `disease`; banner + Clear; empty copy.

- [ ] Step 1: failing tests — nav has no "Explore" and no "Trial map"; `/explore` still renders; target page link text "List these {n} trials →" with `/trials?nct=` href carrying `disease`; trial card has no map link; SidePanel kind/node links point to `/trials?`; Methods has the similarity-map line; TrialsList filters by `nct` (incl. unknown + duplicate ids), shows the banner, Clear removes params, empty copy; plainWords: no "on the map" outside Methods/Explore. e2e: nav has no Explore; target → "List these trials" → Trials with banner; mobile no horizontal scroll on `/?view=year`.
- [ ] Step 2: run — FAIL. Step 3: implement (update existing tests/e2e that asserted map links). Step 4: PASS; web gates + e2e.
- [ ] Step 5: commit `feat(web): Explore leaves the nav; map links become a filtered Trials list`.

### Task 4: Docs

- [ ] Update `DESIGN.md` (By year arrangement, nav), `README.md` (routes/nav), `docs/superpowers/HANDOFF.md` §00 (what changed, why, the Explore decision). Gates; commit `docs: By year and Explore retirement recorded`.
