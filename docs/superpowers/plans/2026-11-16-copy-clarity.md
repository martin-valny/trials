# Copy Clarity Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every reader-visible word on the site mean one thing and be true: one name per idea, no labels that read as bugs, no internal jargon, a front door that says what each view is for.

**Architecture:** Edit strings where they live in `web/src`; add one route (`/stop-risk`, with `/watchlist` redirecting); fix two small logic bugs that produce wrong copy (pipeline margin-note superlatives, uncategorised footnote counts). The existing `web/tests/plainWords.test.tsx` guard grows to ban every retired word, across more pages.

**Tech Stack:** React 19 + TypeScript, react-router 7 (HashRouter), Vitest + Testing Library, Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-11-16-copy-clarity-design.md`

## Global Constraints

- Branch `feat/copy-clarity` off `origin/main` (b0c73e6). Never push; Martin pushes via bundle.
- Vocabulary table in the spec is binding; reader-visible text only. Internal names stay (`Outcome = "succeeded"`, `ViewKey "watchlist"`, `components/watchlist/`, `in_pool`, CSS classes).
- Words never on the page after this plan: `Watchlist`, `Stop chance`, `moved on`, `succeeded`, `Success share`, `successes`, `no follow-on`, `without a known result`, `that count`, `pool trials`, `could succeed`, `neuroimmunology`, `Figure 1 |`, `Figure 2 |`, `No target row`, `· hand`, `further investment`. "not investment advice" stays.
- Existing banned stop-risk words stay banned (`risk of failure|likely to fail|in trouble`).
- Run from `web/`: `npm test`, `npm run lint`, `npm run build`. E2e: `npm run e2e`.
- Commit after each task, by path only (`git add <paths>`), message ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Old `/#/watchlist` links (bookmarks, earlier PRs, README) must land on the stop-risk page with filters in the query string intact.
2. Dark theme: the intro caption swaps "Red ones" → "Orange ones"; the new caption wording must keep that swap working.
3. Phone nav sheet and desktop nav must show identical labels (two copies in `SiteNav.tsx`).
4. Margin-note fix must not leave a row with an empty note box that shifts the layout (the `note-empty` class path).
5. Diligence memos recorded before this change carry stance keys, not text; the new wording must apply to recorded memos too (check `STRIP_STANCE` and `TargetDiligence` both).

---

### Task 1: Nav, routes and front-door names

**Files:**
- Modify: `web/src/App.tsx:46` (routes), `web/src/components/SiteNav.tsx:30-67`, `web/src/lib/intro.ts:16-24`, `web/src/components/intro/IntroPage.tsx:113-127`, `web/src/components/intro/intro.css`
- Test: `web/tests/AppRoutes.test.tsx`, `web/tests/IntroPage.test.tsx`, `web/tests/intro.test.ts`

**Interfaces:**
- Produces: route `/stop-risk` rendering `WatchlistPage`; `/watchlist` → `<Navigate to={"/stop-risk" + location.search} replace />`. `VIEW_TEXT[k]` gains `line: string`.

- [ ] **Step 1: Write failing tests**
  - `AppRoutes.test.tsx`: `renders the stop-risk page at /stop-risk` (heading "Stop risk"); `redirects /watchlist?disease=MS to /stop-risk?disease=MS` (assert location search preserved via a `useLocation` probe, as other redirect tests in the file do).
  - `IntroPage.test.tsx`: the view list contains, in order, links named `Pipeline`, `Diligence`, `Stop risk`, `Treatments`, `Registry changes`, `Trials` (Diligence only when open, as now), and each link's text includes its `line` from Step 3.
  - Nav test (add to `AppRoutes.test.tsx`): desktop nav link texts are exactly `Pipeline, Diligence, Stop risk, Treatments, Registry changes, Trials, Methods`.
- [ ] **Step 2: Run** `npx vitest run tests/AppRoutes.test.tsx tests/IntroPage.test.tsx` — expect FAIL.
- [ ] **Step 3: Implement.** Nav labels as above in both nav copies (`to` for Stop risk is `/stop-risk`; Approaches keeps `/approaches`, Changes keeps `/changes`). In `VIEW_TEXT`: names `Stop risk`, `Treatments`, `Registry changes`; `watchlist.to = "/stop-risk"`. Add `line` (shown under the name in each tile, replacing nothing; "Open →" stays):
  - pipeline: "Which targets are in trials, and how far they got"
  - diligence: "AI memos on a target, every claim checked"
  - watchlist: "Running trials most likely to stop early"
  - approaches: "Every trial by how its treatment works"
  - changes: "What sponsors changed in the registry this week"
  - trials: "Search and open any trial"
  - all: "Every trial on one map" (not a tile; used only if `listed` includes it)
  
  Render `<span className="ln">{VIEW_TEXT[k].line}</span>` after `.nm`; style `.intro-list .ln` muted, step-down type size from the existing scale (no new tokens). Update the doc comment on `SiteNav`.
- [ ] **Step 4: Run** the same tests — expect PASS. Then `npm test` — fix any other test asserting the old names.
- [ ] **Step 5: Commit** `feat(copy): Stop risk, Treatments, Registry changes in nav and front door`.

### Task 2: Stop-risk wording

**Files:**
- Modify: `web/src/components/watchlist/WatchlistPage.tsx:36,135,195,228,242,329`, `web/src/components/risk/RiskNote.tsx`, `web/src/components/target/TargetPage.tsx:128`, `web/src/components/target/TargetRisk.tsx`, `web/src/components/risk/RiskMethods.tsx:276-285`
- Test: `web/tests/Watchlist.test.tsx`, `web/tests/TargetPage.test.tsx`, `web/tests/plainWords.test.tsx`

**Interfaces:**
- Consumes: `/stop-risk` route from Task 1.

- [ ] **Step 1: Write failing tests**
  - `Watchlist.test.tsx`: heading `Stop risk`; sort option `Furthest above typical`; key text `Ring = estimate, band = likely range, tick = typical for each trial's phase.`; a trial with no pipeline target shows `No pipeline target`; filter group aria-label `Stop-risk filters`.
  - `TargetPage.test.tsx`: contents strip item for the risk panel reads `Stop risk` and its count reads `14 above typical` style (`${n} above typical`).
  - `plainWords.test.tsx`: add `Watchlist`, `Stop chance`, `Not a statement about any sponsor or trial`, `No target row` to `OLD`; render `WatchlistPage` (fixture data, as `TargetPage` is rendered) in the old-words sweep.
- [ ] **Step 2: Run** `npx vitest run tests/Watchlist.test.tsx tests/TargetPage.test.tsx tests/plainWords.test.tsx` — expect FAIL.
- [ ] **Step 3: Implement.** Page title `Stop risk`; head sentence keeps its numbers, reworded to "{n} running drug trials, ranked by estimated chance of stopping early; {k} sit above the typical rate for their phase." `RiskNote` exact copy:

  > A statistical pattern from similar past trials, read from the registry record alone. It knows nothing about the drug's results and is not a judgement of the sponsor. It ranks a trial that stopped above one that completed about 7 times in 10, so it is often wrong; [how it is measured](/methods#stop-risk).

  `RiskMethods`: "the Watchlist" → "the Stop risk page" (both sentences); "not a statement about any sponsor or trial" → "not a judgement of any sponsor".
- [ ] **Step 4: Run** the tests — expect PASS; then `npm test`.
- [ ] **Step 5: Commit** `feat(copy): stop-risk page and note wording`.

### Task 3: One outcome vocabulary ("advanced")

**Files:**
- Modify: `web/src/lib/format.ts:88`, `web/src/lib/pipeline.ts:28`, `web/src/components/pipeline/PipelinePage.tsx:66`, `web/src/components/mechanisms/KindTree.tsx:19,111`, `web/src/components/mechanisms/MechanismsPage.tsx:197,355,401,468-476,591,598,618`, `web/src/components/mechanisms/SidePanel.tsx:130,293,323,328`, `web/src/components/mechanisms/ApproachRail.tsx:77`, `web/src/components/explore/Explore.tsx:57`, `web/src/components/explore/PanelSuccess.tsx:123,127`, `web/src/components/target/TargetTimeline.tsx:255`, `web/src/components/intro/IntroKey.tsx:4`, `web/src/lib/intro.ts:18,38-40`, `web/src/components/Methods.tsx:200,488,571,580,604`
- Test: `web/tests/plainWords.test.tsx`, `web/tests/intro.test.ts`, `web/tests/Mechanisms.test.tsx`, `web/tests/ExplorePanels.test.tsx`

- [ ] **Step 1: Write failing tests**
  - `plainWords.test.tsx` `OLD` gains: `moved on`, `/\bsucceeded\b/i`, `/success share/i`, `/successes/i`, `no follow-on`, `without a known result`, `that count`, `pool trials`, `could succeed`.
  - `intro.test.ts`: `captionText("pipeline","light")` === "Trials sorted onto their drug target's row and phase. Red ones advanced to a later phase."; with `"dark"` the same with "Orange ones".
  - `Mechanisms.test.tsx`: graph key items `Pathway (Reactome)`, `Pathway (Gene Ontology)`, `Pathway (hand-curated)`, `Advance rate, 0 to {n}%`; side heading `Pathways shared by drugs that advanced`.
  - `ExplorePanels.test.tsx`: tick note `Tick: average across all measured finished trials (13%).` (use the fixture's value).
- [ ] **Step 2: Run** those four files — expect FAIL.
- [ ] **Step 3: Implement** with the spec table. Fixed strings:
  - status label `Finished, not advanced` (all five copies); Explore summary "…, {n} advanced, {n} stopped early, {n} still running, {n} finished, not advanced."; intro key `advanced`.
  - Rail note: "Bars: share of finished trials whose drug went on to a later phase; a trial counts for the approach of the drug that advanced. Under {minGroup} finished trials, too few to tell."
  - "{n} finished trials that count, {m} advanced" → "{n} measured finished trials, {m} advanced" (and the "No measured finished trials yet." variant).
  - Pathway list footnote: "Pathways below the top level, ranked by the share of their finished trials whose drug advanced."
  - Methods: replace "moved on"/"succeeds" phrasing with "advanced"; keep the "does not mean the drug worked" sentence.
  - Update the `OLD` comment in `plainWords.test.tsx` (Approach/Approaches still allowed in body text; Task 1 changed only nav).
- [ ] **Step 4: Run** the four files, then `npm test` — expect PASS.
- [ ] **Step 5: Commit** `feat(copy): one outcome vocabulary, advanced`.

### Task 4: Pipeline labels that read as bugs

**Files:**
- Modify: `web/src/lib/pipeline.ts:454-470` (rule loop), `:676-681` (approval source), `web/src/components/pipeline/PipelineFigure.tsx:173-179`
- Test: `web/tests/pipeline.test.ts`, `web/tests/PipelinePage.test.tsx`

**Interfaces:**
- Produces: `marginNotes` keeps its signature; behaviour change only.

- [ ] **Step 1: Write failing tests** in `pipeline.test.ts`:
  - `a superlative note goes only to the true leader`: views A (run 53, adv 11) and B (run 7, adv 5), both above thresholds. Expect A → "Most crowded", and B has **no** note (not "Most advanced").
  - `the leader with no earlier note gets it`: A (run 53, adv 2), B (run 7, adv 11) → A "Most crowded", B "Most advanced".
  - `approval source reads hand-curated`: the source formatter returns `"PMDA 2022 · hand-curated"` and `"hand-curated"` with no head.
  - `PipelinePage.test.tsx`: a row stat reads `53 of 123 running` and `5 companies running` (`1 company running` singular).
- [ ] **Step 2: Run** `npx vitest run tests/pipeline.test.ts tests/PipelinePage.test.tsx` — expect FAIL.
- [ ] **Step 3: Implement.** In the rule loop, pick `best` over **all** views (ignore `notes.has`); if `notes.has(best.row.id)`, skip the rule. Row stat: `<b>{v.run}</b> of {v.total} running` and `{k} {company|companies} running`.
- [ ] **Step 4: Run** — expect PASS; `npm test`.
- [ ] **Step 5: Commit** `fix(pipeline): superlative notes only when true; units on row stats`.

### Task 5: Treatments page, map and target page fixes

**Files:**
- Modify: `web/src/lib/approaches.ts:278-299`, `web/src/components/mechanisms/ApproachRail.tsx:80-84`, `web/src/components/mechanisms/MechanismsPage.tsx:57-63`, `web/src/components/explore/Explore.tsx:140-145,298,399-400`, `web/src/components/target/TargetChain.tsx:94`, `web/src/components/target/TargetPage.tsx:213,235`, `web/src/components/target/TargetTimeline.tsx:127`, `web/src/lib/format.ts:48-53`
- Test: `web/tests/approaches.test.ts`, `web/tests/Explore.test.tsx`, `web/tests/TargetPage.test.tsx`, `web/tests/TargetTimeline.test.tsx`, `web/tests/format.test.ts`, `web/tests/plainWords.test.tsx`

**Interfaces:**
- Produces: `Uncategorised` becomes `{ n: number; named: number; d: number }` (`named` = trials with at least one unsorted name, so `named + d === n`). `TargetTimeline` takes `asOf: string` (registry date) instead of reading `file.generated_for` for its label and rule.

- [ ] **Step 1: Write failing tests**
  - `approaches.test.ts`: for a fixture with trials {2 unsorted names in one trial, 1 trial with none}, `uncategorised()` → `{ n: 2, named: 1, d: 1 }`.
  - `format.test.ts`: `formatDelta(121)` → "slipped 121 days"; `formatDelta(1218)` → "slipped 3.3 years"; `formatDelta(-400)` → "pulled in 1.1 years"; `formatDelta(365)` → "slipped 1 year" (a one-decimal value of exactly 1.0 reads "1 year"). Days below 365 stay in days.
  - `Explore.test.tsx`: title starts "The MS and autoimmune neurology trial landscape" (from `meta.area_label`) and contains no "Figure 1"; hint contains "drag to rotate".
  - `TargetPage.test.tsx`: mechanism panel heading `Mechanism`; timeline legend `Line = start to (expected) end · thicker = later phase · dashed = planned, not yet reached`.
  - `TargetTimeline.test.tsx`: label reads `Registry data from 13 Nov 2026` when `asOf="2026-11-13T…"`.
  - `plainWords.test.tsx` `OLD` gains `neuroimmunology`, `Figure 1 |`, `Figure 2 |`, `past the data date`.
- [ ] **Step 2: Run** the six files — expect FAIL.
- [ ] **Step 3: Implement.** Footnote: "{n} trials not yet categorised ({named} with a drug name not yet sorted, {d} diagnostic or not a treatment)." Drop the `<b>Figure N |</b>` prefixes (sentence stays, capitalised). Explore uses `meta.area_label`. Target page passes `meta.data_timestamp ?? file.generated_for` as `asOf` (load meta with `loadMeta` from `../data`, as `FreshnessBadge` does). Label text `Registry data from {dayMonthYear(asOf)}` (reuse the badge's formatter).
- [ ] **Step 4: Run** — expect PASS; `npm test`.
- [ ] **Step 5: Commit** `feat(copy): treatments footnote, map title, target panel names, one data date`.

### Task 6: Diligence stance wording

**Files:**
- Modify: `web/src/components/target/TargetDiligence.tsx:21-23`, `web/src/lib/diligence.ts:243`, `web/src/components/diligence/DiligencePage.tsx` (table cell uses `STRIP_STANCE`; verify)
- Test: `web/tests/TargetDiligence.test.tsx`, `web/tests/DiligencePage.test.tsx`, `web/tests/diligence.test.ts`, `web/e2e/diligence.spec.ts`

- [ ] **Step 1: Write failing tests:** `STRIP_STANCE` equals `{ favours: "favours further development", mixed: "mixed", against: "argues against further development" }`; target memo headline for `favours` is "Favours further development of this mechanism for this disease" (mixed: "Mixed on further development of…", against: "Argues against further development of…"); `plainWords` `OLD` gains `further investment`. Update the matching strings in `e2e/diligence.spec.ts`.
- [ ] **Step 2: Run** `npx vitest run tests/TargetDiligence.test.tsx tests/diligence.test.ts tests/DiligencePage.test.tsx` — expect FAIL.
- [ ] **Step 3: Implement** the three maps.
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `feat(copy): diligence reads speak of development, not investment`.

### Task 7: Whole-site sweep and e2e

**Files:**
- Modify: `web/tests/plainWords.test.tsx` (render `IntroPage`, `ChangesFeed`, `DiligencePage` in the old-words sweep), `web/e2e/front-door.spec.ts`, `web/e2e/risk.spec.ts`, `README.md`, `PRODUCT.md` (any "Watchlist" mention)

- [ ] **Step 1:** Add the three pages to the sweep; run `npx vitest run tests/plainWords.test.tsx`. Any failure is a missed string: fix it at its source.
- [ ] **Step 2:** `grep -rnE "Watchlist|moved on|no follow-on|Figure [12] \||further investment|Stop chance" web/src web/e2e README.md PRODUCT.md` — only code identifiers and comments may remain.
- [ ] **Step 3:** Update e2e specs to the new names and `/stop-risk`; run `npm run e2e` — expect all PASS.
- [ ] **Step 4:** `npm run lint && npm test && npm run build` — all clean.
- [ ] **Step 5:** Visual check on a free port ≥ 4180 (never 4173): `npx vite preview --port 4181`; check front door (light + dark, desktop + 390px), pipeline, stop risk, target CD20, treatments. Note anything that wraps badly.
- [ ] **Step 6: Commit** `test(copy): site-wide old-words sweep; docs and e2e on the new names`.

### Task 8: Investigation, trial age as a top stop-risk factor (no shipped change)

**Files:**
- Create: `docs/superpowers/research/2026-11-16-trial-age-factor.md`

- [ ] **Step 1:** In `pipeline/`, load the shipped v2 model and the current scored running trials; for the 20 highest estimates, list the top factors and the trial-age contribution.
- [ ] **Step 2:** Plot or tabulate estimate vs. trial age (months since start) for running Phase 1–3 trials, holding phase fixed; and the training-snapshot stop rate by trial-age band.
- [ ] **Step 3:** Write up in 1 page: is "young trial → higher stop chance" real in the snapshot data (young stopped trials), or the known short-ending bias from Methods? Recommend one of: keep, relabel the factor (e.g. "Early in its planned run"), or hide it from Main factors. No code change; Martin decides.
- [ ] **Step 4: Commit** `docs(research): trial age as a stop-risk factor`.
