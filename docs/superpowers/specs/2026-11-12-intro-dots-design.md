# Intro page: same dots, six arrangements (design)

Status: approved by Martin, 2026-11-12. Builder check done and folded in (§7, calls 8–12).
Reference spike (throwaway, not to be merged): worktree `../trials-intro-spike`, branch `spike/intro-page`, files `web/src/components/intro/DotsIntro.tsx` and `dots.css`. Martin's verdict on it: "I love it." The spike shows the behaviour; its code is a sketch, not code to reuse as is.

## 1. Intent

Trial Radar has real depth (pipeline figure, target pages, AI diligence, stop-risk watchlist, approaches, daily changes) but a first-time visitor lands on a dense figure and does not know what the site is or where to look. The main audience (PRODUCT.md) is a hiring panel giving the site a few minutes; the first screen has to say what this is, at a high level, and make them want to click.

**The idea:** a new intro page at `/`. Every one of the area's trials is a dot. The dots start as a cloud placed by what each trial studies, then the page tours six arrangements of the *same* dots, one per section of the site (Pipeline, Diligence, Watchlist, Approaches, Changes, Trials). "Six ways to look at the same trials" is something you watch happen, from real data. Hovering a section name holds its arrangement; clicking opens that section.

Martin's words: the site is "pretty difficult"; people should "know high level what's this about"; a features grid of schematic drawings worked practically but "from a design point of view, not really". Scrolling on the intro is "a no-no".

## 2. Goals, non-goals, anti-goals

**Goals**
- G1. `/` is the intro; it fits one screen with no page scroll on a laptop (1280 × 720 viewport and up) and on a phone (375 × 667 and up), light and dark.
- G2. Every dot is a real trial from today's data; every arrangement is a faithful, simplified version of its section (same states, same colours, same meaning as the section's own legend).
- G3. The tour runs by itself, holds on hover or focus, and every section is one click away.
- G4. The pipeline figure moves to `/pipeline` unchanged, and no old link breaks.

**Non-goals**
- The 90-second video (later, used outside the site; no "tour" button until it exists).
- Changing the pipeline page or any section page (beyond the route move and link updates).
- The whole-neuro expansion (backlog).

**Anti-goals (a failure even if it works)**
- The page scrolls on a laptop.
- A dot or a number that is not real data, or a view that says something its section would not.
- Motion that can't be stopped, or motion for visitors who asked for less (`prefers-reduced-motion`).
- Red for anything but "moved on to a later phase" (the Only-Succeeded Rule, DESIGN.md).
- A slow first view: dots should be on screen within about a second on a normal connection.
- Old shared links (`/#/?view=disease&company=…`) landing somewhere other than the pipeline figure.

## 3. Constraints

- Static site, $0, no server (PRODUCT.md). Data comes from the site's JSON, rebuilt daily.
- No source file names a condition; a test enforces it. The headline's area wording must come from data or config, not from source.
- Figure Plate design system (DESIGN.md): Hanken Grotesk only, hairline rules, bold lowercase panel letters, flat, tokens for every colour so dark mode works.
- Premium finish bar (an Impeccable finish review before merge).

## 4. Approaches considered

1. **A short video as the first thing (dropped as the intro).** Most visitors won't press play, it goes stale with every data and design change, and it's mostly Martin's time. Kept for later, outside the site (application email, LinkedIn, README).
2. **Outcome hero / features grid with schematic drawings (built as a spike, set aside).** Clear, but reads as a template features grid; equal boxes, no centrepiece, and it ignores what makes the site distinctive. Still at `/#/intro-grid` in the spike for comparison.
3. **One trial's journey** (a single dot travelling through the system). A story, but the visitor has to watch it in order. Not pursued.
4. **Same dots, six arrangements (chosen).** Uses the site's own visual language (one mark per trial, red = moved on), real data, and turns "six views" into something seen. Most work of the options.

## 5. The page

```
┌ shared header (brand · freshness · nav · theme) ─────────────────────────────┐
│ KICKER (area · rebuilt every morning)                                        │
│ **2,993 clinical trials in <area>.** Six ways to look at them.  [Open the pipeline →] │
│ ─────────────────────────────────────────────────────────────── (ink rule) │
│ a Pipeline        │ **a Pipeline.** One-sentence caption for the current view │
│ b Diligence       │                                                         │
│ c Watchlist       │            canvas: the dots, current arrangement        │
│ d Approaches      │                                                         │
│ e Changes         │                                                         │
│ f Trials          │ key for this view ……………… "Touring the six views · hover one to hold it" │
└──────────────────────────────────────────────────────────────────────────────┘
```

- The intro fills the viewport under the header (spike: `height: calc(100dvh - header)`, min-height ~560px; below that the page may scroll).
- Left: the six sections as a lettered list (bold lowercase letters). The current one is ink and bold with "Open →"; the rest muted.
- Right: a one-sentence caption, the canvas, and a one-line key under it.
- **Phone (≤ 760px):** headline, full-width "Open the pipeline →", the six sections as a wrapping row of pills, caption, canvas, key. No auto-tour note.

### 5.1 Arrangements (as in the spike)

Each dot keeps its identity across views. Dots a view does not use rest faintly in their cloud position (alpha ≈ 0.035).

| View | Dots | Arrangement | Caption (spike wording) |
|---|---|---|---|
| All trials (start) | all | similarity cloud from the Explore layout (x, y), relaxed so piled-up dots spread into blobs; outcome colours | Every trial is a dot, placed by what it studies. Similar trials sit together. |
| a Pipeline | trials in pipeline rows | top target rows by trial count (as many as fit at ≥ 26px a row) × four phase columns (Phase 1, 2, 3, Approved use); each dot coloured by its **state on that row** exactly as the figure's mark (adv/run/stop/fin/unk), so a dot may change colour between All and Pipeline; a trial on several rows appears once, on the highest row that fits | Trials sorted onto their drug target's row and phase. Red ones moved on to the next phase. |
| b Diligence | today's trials on each recorded memo's target row, in that memo's disease ("all" = every disease) | one phyllotaxis cluster per recorded memo, labelled "Target · Disease" | Targets an AI agent has written a checked memo on, each with its trials in that disease. |
| c Watchlist | trials with a per-trial estimate | beeswarm on a 0–60%+ axis of estimated chance of stopping early; dashed "typical N%" marker (median typical) | Running trials by their estimated chance of stopping early, against the typical rate. |
| d Approaches | all | one waffle column per approach in the vocabulary's order plus **More than one approach** (hollow ink rings, as in the Approach colour mode), so every trial appears once; approach hues; under each column its dot count. A note says "trials in several approaches are under More than one; the Approaches page counts them in each". | Every trial by how its treatment works, from targeted drugs to non-drug care. |
| e Changes | trials changed in the last 7 days | changed trials gather into bins by what changed (Dates, Status, Sites & countries, Enrollment, Outcomes, Other details); notable = solid and larger, routine = hollow; each bin labelled with its count and notable count ("6 slipped 90+ days"); all trials as a faint grid below; "30 of 2,993 trials changed in the last 7 days · solid = flagged as notable" | Trials whose registry record changed this week, sorted by what changed. |
| f Trials | all | stacked by start year (from 1995, capped at next year; earlier and later clamp to the ends), outcome colours | Every trial by the year it started. Open any one for its full record and history. |

Outcome colours match the pipeline legend: moved on = red fill, running = hollow running-blue ring, stopped = stop fill, finished = pale fill, status unknown = hollow mid-grey ring.

### 5.2 Motion

- Transition ~1.1 s, ease-in-out cubic, staggered left to right (≤ 320 ms); labels fade in once dots have mostly arrived.
- Auto-tour: All (3.2 s) → a … f (4.2 s each) → All, looping. Hover or keyboard focus on a section holds it; leaving resumes. The tour pauses while the tab is hidden.
- `prefers-reduced-motion`: no tour, no tweening; the page shows the cloud, and hover/focus switches views instantly.

### 5.3 Navigation and routes

- `/` → intro. `/pipeline` → the current front-door figure, unchanged.
- **Old links:** `/` with any query string redirects (replace) to `/pipeline` with the same query, so `/#/?view=year` still opens the figure.
- Nav "Pipeline" → `/pipeline` (current-page bold there). Brand → `/`.
- Every in-app link to the figure (`TargetPage` back links, `TargetCompanies` company links, anything else found) points to `/pipeline…`.
- A section in the list: click/Enter opens its page. "All trials" caption links to Explore.

## 6. Decisions made in the conversation

- Intro is its own page at `/`, not an overlay, not an auto-advancing splash.
- Six sections, all shown: Pipeline, Diligence, Watchlist, Approaches, Changes, Trials. Methods and Explore are links, not views.
- One screen, no scroll, on laptop and phone.
- No video now; no tour button until the video exists.
- The dots version over the schematic grid.
- Changes is the bins-by-what-changed version (Martin agreed the first grid version was weak).

## 7. Calls I made (Martin to check)

1. **Data: a new compact `intro.json`** written by the pipeline's export, instead of the page fetching `explorer.json` (~2 MB), `pipeline.json`, `risk.json`, `changes/7d.json` and the diligence index. Per trial: id, x, y, outcome, approaches, start year, every pipeline (row, column, state), risk estimate if any, change bin and notable flag; plus row labels, the median typical rate, the counts. (Memo pairs: call 9.) Target ≤ 150 KB raw. Keeps the first view fast (anti-goal: slow first view) and keeps view logic out of the browser.
2. **Legend per view:** the key under the canvas changes with the view (outcome key for All/a/b/f; approach key for d; notable/routine for e; the typical-rate note for c).
3. **Phone taps:** a pill tap shows that arrangement and adds "Open <section> →" to the caption; a second tap or that link opens the page (no hover on phones).
4. **Missing data:** Diligence hidden while the agent is closed (letters re-run a–e); Watchlist hidden when there are no per-trial estimates (`risk.per_trial: false`); Changes shows "No changes in the last 7 days" with the faint grid. The headline count always shows.
5. **Headline wording:** "{N} clinical trials in {area label}. Six ways to look at them." with the area label from config/meta (new field if needed), keeping source free of condition names. The pipeline page's hard-coded kicker ("MS and autoimmune neurology") moves to the same source.
6. **Canvas** (2D, devicePixelRatio aware), colours read from the theme tokens each frame so the theme switch repaints live; the canvas has an `aria-label` with the caption, and the list is real links/buttons.
7. The spike's ghost dots (unused dots resting in the cloud) stay, faint.

8. **Diligence clusters are today's trials** on the memo's target and disease, not the trials the memo cited (the memo's own citations would need parsing every memo's steps and would point at trials that may have left the data). The caption says so ("each with its trials in that disease").
9. **Memo pairs come from `diligence/index.json` at runtime** through the existing `useDiligenceRelease`, not from `intro.json`, so the intro follows new memos without waiting for the daily run. Diligence shows in the `recorded` and `live` states and only when at least one memo is recorded; it is hidden in `closed` (and in `live` with nothing recorded).
10. **Approaches:** one dot per trial, multi-approach trials in their own "More than one approach" column (design-system pattern), dot counts under columns plus the one-line note, so no number pretends to be the section's.
11. **Pipeline:** `intro.json` carries, per trial, every (row, column, state) it has in `pipeline.json`, so the view can use the row state whatever number of rows fits.
12. **No map build** (`explorer.json` and `pipeline.json` missing after an R19 warning): `intro.json` is then written without cloud positions and rows, or not at all; `/` shows the headline and the section list, and the canvas area says "The overview appears after the next daily update" (the site's existing wording). No redirect.

## 8. Left to the builder

Exact timings and easing within the ranges above; label placement; how many pipeline rows fit; the relaxation details for the cloud; the waffle and beeswarm sizing; component structure; test layout. Update `DESIGN.md` (an Intro section) and `PRODUCT.md` (routes) when done.

## 9. Testing and done

- Unit: `intro.json` export (shape, size, every trial once, bins, missing-data cases); the view builders (every dot gets a target; no target off-canvas at the two reference sizes).
- e2e: no scroll at 1280 × 720 and 375 × 667; the tour advances; hover holds; click opens the section; reduced motion shows a still cloud; `/#/?view=year` lands on `/pipeline?view=year`; existing front-door specs move to `/pipeline`.
- The no-condition-names test still passes.
- Impeccable finish review against the spike screenshots, light and dark, desktop and phone.
