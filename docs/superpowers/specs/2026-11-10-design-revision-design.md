# Design revision: target-page structure, the diligence strip, and one design across the site

Status: draft for Martin's approval (2026-11-10). Branch `feat/diligence-agent` (from HEAD `6759e04`). Nothing is built until this is approved.

Screenshots referred to below are in the session scratchpad:
`/private/tmp/claude-503/-Users-martin-valny-Desktop-trials/825cdb54-31c2-4522-9eb2-2fd532d26301/scratchpad/shots/` (60 screenshots: 10 pages × 1280/375 × light/dark, plus full-page light captures). The annotated problem shots are in `shots/problems/`; each `fold-*.png` shades everything above the first piece of real data and draws a line where the data starts.

## 1. Intent

Trial Radar is a portfolio piece, judged on a premium, honest finish by a hiring panel that gives it a few minutes (PRODUCT.md). Three things work against that today:

1. **Target pages hide their depth.** Seven lettered panels (a–g) are stacked in one long scroll (CD20, all diseases: 4,819px at 1280 wide, 8,523px at 375). Nothing on the first screen says panels e, f and g exist; the diligence agent, the most distinctive feature, is the last thing on the page.
2. **The top of most pages spends a lot of space before real data appears** (measured in §3), worst on the front door and on phones.
3. **The site is two designs.** The front door, target pages, Approaches and Watchlist use the Figure Plate. Changes, Trials, the trial page and Methods still use the older plain styles: blue links, native form controls, raw registry codes, a different token set. A visitor moving between tabs sees two products.

The aim is a site that feels like one considered piece, shows its data sooner, and makes every panel discoverable without hiding any of them. Each change below is tied to a measured problem; nothing changes for the sake of change.

## 2. Goals, non-goals, anti-goals

**Goals**
- Every target-page panel is discoverable from the first screen, and reachable in one click or one key press, without hiding any of them.
- The diligence agent is visible in the target-page header in every state (decided earlier, §5).
- Real data starts higher on every page (targets in §3, measured the same way after the change).
- Changes, Trials, the trial page and Methods move onto the Figure Plate (Martin, 2026-11-10: "bring them all on the same design").
- One type scale with a 12px floor for text.

**Non-goals**
- No new data, pipeline or agent changes. No change to what any panel computes.
- No change to the mark vocabulary, the outcome colours, or the Only-Succeeded rule.
- Explore (`/explore`, linked only from Methods) is not revised beyond picking up shared tokens.
- Diligence plan Task 11 (Martin's AWS checkpoint) is separate and may run before or after this work.

**Anti-goals (a failure even if it technically works)**
- A dashboard look: cards, shadows, tinted panels, tabs that hide content, a left filter rail.
- Generic AI-made styling: gradient accents, glowing dark mode, emoji, icon rows, "insight" cards.
- Shrinking the honesty text (stop-risk standing note, AI labels, "Advanced" definition) to win space.
- Compressing headers until they lose the computed sentence that tells a visitor what they are looking at.

## 3. What was measured (before)

Built from the real 2026-11-06 snapshot plus the real `risk.json` from session 10, served locally on port 4190 with a mock diligence backend on 4191 (both stopped). "First data" is the top of the first chart, table row or trial row; the figure is the share of the first 800px that is data.

| Page | 1280 wide | 375 wide |
|---|---|---|
| Front door (first target row) | 555px (31% data) | 707px (12%) |
| Target page, CD20 · MS (timeline) | 345px (57%) | 467px (42%) |
| Target page, CD38 (sparse) | 345px (57%) | 411px (49%) |
| Watchlist (first trial row) | 385px (52%) | 489px (39%) |
| Approaches (canvas) | 327px (59%) | 544px (32%) |
| Changes (first row) | 363px (55%) | 399px (50%) |
| Trials (first row) | 335px (58%) | 348px (57%) |
| Trial page (facts) | 284px (65%) | 436px (46%) |

Martin's sense that "the top of every page wastes space" is right for the front door, for Watchlist, and for every page on a phone. On desktop target pages it is half right: the header carries real information, but it says it twice (below).

### Findings, page by page

**Front door** (`fold-front-1280-light-fold.png`, `fold-front-375-light-fold.png`)
- The headline is held to 22ch at 34px, so one sentence wraps to four lines and leaves the right half empty except for three key numbers.
- "185 running" appears in the headline and again as the first key number.
- The source line (three lines, 12px muted) sits between the headline and the controls. It is a caveat, not something a visitor needs before the figure.
- Gaps: 48px from the site header to the kicker, 26px above the controls, a separate legend line, then column heads. On a phone all of this stacks: the first row starts at 707px.

**Target page** (`fold-cd20-ms-1280-light-fold.png`, `cd20-all-1280-light-full.png`)
- The opening sentence ("41 of 99 trials are running … 6 advanced to a later phase; 7 stopped") and the three key numbers (41 / 6 / 7) state the same three facts.
- There is no sign of panels e, f and g on the first screen. Panel f lists every scored running trial (30 for CD20), so panel g starts about 4,500px down.
- On a phone the key numbers take their own band (rule, numbers, captions) and the disease chips wrap to two lines.

**Watchlist** (`fold-watchlist-1280-light-fold.png`)
- A 48px title, a lede, a claim line and the standing note take four separate blocks before the filters. The lede and claim could be one sentence.

**Changes, Trials, trial page, Methods (legacy styles)** (`fold-changes-1280-light-fold.png`, `fold-trials-1280-light-fold.png`, `trials-375-dark-fold.png`, `trial-1280-dark-fold.png`, `methods-1280-light-fold.png`)
- A separate token set in `styles.css` (`--bg --fg --accent --card --warn-*`) beside the plate tokens; blue links (`--accent` #0b5cad, dark #6cb0f5) and a 3px blue focus ring, against the plate rule of a 2px ink ring; the selected Changes range button is solid blue.
- Native `<select>` and search fields; Changes' "Notable only" checkbox did not show a visible box in the 1280 screenshot (cause not investigated; the builder confirms).
- Raw registry codes: "RECRUITING", "COMPLETED", "PHASE2", "NA"; dates mixed between "31 Dec 2024" and "2026-11-06".
- A narrower, differently placed column (`max-width: 72rem`, 80px gutters at 1280) from the full-width 40px-gutter plate pages, so the left edge jumps when moving between tabs.
- **Trials renders all 2,987 trials at once**: the page is 285,616px tall at 1280 and 1,066,338px at 375, where each trial is a bordered card about 350px tall with uppercase labels for every field.
- **Methods** is 12,443px long with no contents, set in 16px prose at about 140 characters a line (comfortable reading is 60–75).
- The trial page uses uppercase tracked labels (STATUS, PHASE) that the plate's Lowercase Letter Rule avoids, and a 32px bold title in a different style from the target page's 48px/600 head.

**Type** (measured by share of text characters at 1280)
- Front door: 46% of its text is under 12px; target page 37%; Watchlist 31%.
- Eight sizes between 11 and 15px are in use (11, 11.5, 12, 12.5, 13, 13.5, 14, 15). Neighbouring steps half a pixel apart do not read as hierarchy; they read as inconsistency, and 11–11.5px muted text is hard to read on a laptop at arm's length.

**Colour and contrast**
- The plate palette holds up in light and dark (dark screenshots of the front door, CD20 and Approaches read cleanly; orange stays reserved for "advanced"). Muted text passes 4.5:1 in both themes.
- The legacy palette is the problem: a second blue (`--accent`), a card grey and amber warning colours that appear nowhere on the plate pages.
- Panel c's reason chips are 6px-cornered boxes on `--pale`, neither a pill nor flat: the only rounded-rectangle tint on the plate pages.

## 4. Target-page structure

### Approaches considered

| | What it is | Trades off |
|---|---|---|
| **A. Contents strip (chosen)** | One sticky line listing every panel by letter, short name and one computed number; the current panel underlined; click or Enter scrolls to it; `?panel=` deep links; long panels capped with "Show all". | Keeps one scroll, cross-reading, print and find-in-page. Costs one line of height (paid for by header savings, §6). |
| B. Figure legend first | Below the header, one caption line per panel with its computed finding ("f, 15 of 30 running trials sit above their phase's typical rate"), each linking to its panel. | Most paper-like and informative, but seven lines above panel a: works directly against the fold problem. Rejected. |
| C. Tabs on phones only | Phones show one panel at a time; desktop scrolls. | Two layouts to build and test; phone visitors still see one panel unless they click. Rejected. |

Also rejected, with reasons given to Martin on 2026-11-10:
- **Dropdown panel picker:** hides the panel names behind a click, which makes discovery worse.
- **Toggles like the disease switch (tabs):** the disease switch is a filter (every panel stays, narrowed); panel toggles would change which panel is shown. A visitor giving the site a few minutes sees the default panel only; panels are read together (a red line in a, who runs it in b, why trials stopped in c; f's rows are a's trials); a second row of identical-looking pills with a different job; hidden panels drop out of print, screenshots and find-in-page; on a phone seven tabs scroll sideways, half hidden; and the figure stops being a figure.
- **Two-panel split view:** the timeline needs the full width at 1280 and a split is impossible at 375.

**Decision: A** (Martin, 2026-11-10).

### The contents strip

- **Place:** directly under the target-page header (after the diligence strip, §5), before panel a. A `<nav aria-label="Panels on this page">` holding one link per rendered panel.
- **Items** (only panels that render; with no trials in scope only e and g render):
  `a Timeline` · `b Companies 7` · `c Stops 7` · `d Mechanism` · `e Diseases 6` · `f Stop chance 15 above` · `g Diligence` + a state word (`recorded 9 Nov`, `not run`, `running`, `offline`).
  Letter in 800, name in 500, the number in 400 muted, tabular. Numbers come from the same values the panels compute (b: companies listed, c: stopped trials, e: diseases listed, f: trials above their typical rate). Copy for the short names is final unless Martin changes it.
- **Look:** plain text on the plate with an underline for the current item (2px ink, like the disease switch's selected part), hairline rule below. Not pills, so it cannot be mistaken for the disease switch.
- **Sticky:** sticks to the top of the viewport once scrolled to; plate ground, hairline bottom border. Each panel gets `scroll-margin-top` equal to the strip's height.
- **Current panel:** an IntersectionObserver marks the panel nearest the top as current (`aria-current="location"`, underline).
- **Click / Enter:** scrolls to the panel (smooth only under `prefers-reduced-motion: no-preference`), moves focus to the panel heading (`tabIndex=-1`), and sets `?panel=f` with `replace` (no history entry per click).
- **Deep link:** `?panel=` is read on load and scrolls once the panel has rendered. It is kept when the disease switch changes, and dropped if that panel no longer renders. HashRouter means a real `#fragment` cannot be used.
- **Phone (≤ 640px):** same sticky strip, letter plus short name only (no numbers), one line that scrolls sideways with the current item kept in view; items at least 44px tall. Bleeds into the 16px gutters like the Approaches chips.
- **Print:** strip hidden; every panel prints in full (capped lists expanded with a print style).

### Shorter long panels

- **f:** show the 8 highest estimates, then a text button "Show all 30 running trials". The claim line above still counts all of them. Expanded state is kept in `?panel=f&all=1` only if that is cheap; otherwise it resets on reload (builder's call).
- **c** already shows six stop reasons then "Show all 8"; **b** already shows seven companies then "+2 more". No change.
- **a** (timeline) keeps every lane: it is the page's main figure.

Effect on CD20 (all diseases) at 1280: panel f drops from about 30 rows (≈ 1,100px) to 8 (≈ 300px); g starts roughly 800px sooner, and the strip reaches it from the top anyway.

## 5. Diligence strip and front-door line (decided earlier, specified here)

Agreed with Martin in session 11 and confirmed 2026-11-10. One line in the target-page header, under the opening sentence and above the contents strip; 13px; the fixed label in 12px/700 after it, or on its own line on a phone. Plate tokens only, never red or orange.

| State | Strip reads | Action |
|---|---|---|
| Agent configured, no run for this target and disease | "AI diligence: an agent searches ClinicalTrials.gov, ChEMBL, Europe PMC and openFDA, writes a cited memo, and a second model checks every claim." | **Run diligence →** starts the run (same call as panel g's button) and scrolls to panel g |
| Running (started in this tab) | "AI diligence running · 12 s" | **Follow it →** scrolls to g |
| Run done or recorded, judgement shown | "AI read: {stance} · {confidence} confidence · {n} of {m} claims supported · Recorded {date}" | **Read the memo →** scrolls to g |
| Judgement withheld by the checker | "AI read: judgement withheld · {n} of {m} claims supported · Recorded {date}" | **Read the memo →** |
| Replay of an older run, data changed since | adds " · data has changed since" | as above |
| Run failed | "The last diligence run failed." | **Run again →** |
| Agent offline, no recorded run | "AI diligence: (what it does, as above). Offline at the moment." | **How it works →** to `/methods#diligence` |
| Agent offline, recorded run exists | the recorded line | **Read the memo →** |
| Run finished in this tab | "AI read: … · New run, {date}" (panel g's wording) | **Read the memo →** |
| A run fails while a recorded or cached run exists | the recorded line, then " · the latest run failed" | **Read the memo →** |
| Daily run limit reached | the recorded line if there is one, then " · daily run limit reached, try again tomorrow"; without a recorded run only the limit sentence | **Read the memo →** if there is a memo, else none |
| The page's disease has no trials on this target | strip not shown (panel g already says so) | none |
| Loading (looking for a recorded run) | a one-line pale placeholder at the strip's final height, so nothing below moves | none |

**Phone copy (≤ 640px, approved by Martin 2026-11-10):** the "what it does" sentence is shortened to "AI diligence: a cited memo from public sources, checked claim by claim." in every state that uses it. The fixed label stays word for word, and panel g keeps the full description. The phone fold target (§6) is measured in the longest state, configured with no run.

"Offline" means no agent endpoint is configured (`diligenceEndpoint() === null`), as in panel g today. An endpoint that does not answer is a failed run, not offline. (These rows were settled after the builder check, as my calls, to match what panel g already does.)

- **Fixed label** in every state with a stance or a memo: "AI judgement from public data, not investment advice".
- **Stance words:** favours → "favours further investment"; mixed → "mixed"; against → "argues against further investment". Confidence is `high | medium | low`.
- **Claim counts (my call):** m = sentences the checker judged (verdicts plus sentences removed); n = verdicts `supported`. Panel g shows the same two numbers so they can be checked against each other.
- **A withheld judgement never shows a stance** (the checker did not clear it), matching panel g.
- State comes from the same hook panel g uses; the strip and g share one run (one fetch, one poll, one source of truth). Starting a run from the strip and from g is the same action.
- **Front door:** one line under the source line: "New: an AI agent drafts a checked diligence memo on each target page. See an example: CD20 in MS →" linking to `/target/cd20?disease=MS&panel=g`. It shows only once a recorded example run ships (after Task 11). Before that, the line ends "How it works →" linking to `/methods#diligence`. The word "New:" is the builder's to drop if it reads as marketing; the rest of the copy is final unless Martin changes it.

## 6. Headers: show data sooner

One header pattern for every page, so the left edge, title size and spacing match from tab to tab:

- **Page head:** title, then at most one computed sentence. The kicker, where a page has one, sits on the title's line or is dropped. 24px from the site header to the title (currently 40–48px on plate pages and about 60px on legacy pages).
- **No fact stated twice.** Where a sentence and key numbers repeat each other, keep the sentence and drop the repeated numbers.
- **Caveats move next to what they qualify or to the footer**, never between the title and the data. The standing notes (stop-risk, AI labels) stay where they are; they are honesty text, not caveats to tidy away.

Per page:

- **Front door:** headline widened to about 34ch and set at 30px, so it takes two lines at 1280. Key numbers stay for advanced (36) and companies (34), which the headline does not state; "185 trials still running" is dropped because the headline already says it (my call). The source line becomes one line ("693 of 2,987 trials test a targeted drug in these 28 classes. Registered trials only. How rows are built →"), with the full text moved to the footer. The legend joins the controls' second line where width allows. Phone: headline at 24px, the two remaining key numbers on one inline line, source line moved below the figure.
- **Target page:** the three key numbers are dropped (the opening sentence says the same thing, with the colours). The disease chips move to the right of the title line at 1280 and stay under the title on a phone, on one line that scrolls sideways (like the front door's disease switch). Title 48px → 40px (34px on a phone). The diligence strip and the contents strip are added.
- **Approaches:** takes the shared page head too (my call, after the builder check): the "Figure 2 |" title stays, with the same top gap and left edge as the other tabs. Targets 327 → ≤ 290 at 1280 and 544 → ≤ 460 at 375.
- **Watchlist:** title, then one sentence ("237 running drug trials, ranked by estimated chance of stopping early; 79 sit above their phase's typical rate."). The standing note stays, directly under the filters, at full contrast size (12px).
- **Changes, Trials, trial page, Methods:** the same page head (see §7).

**Targets** (measured as in §3, after the change; the build is not finished until they are met or a miss is explained to Martin):

| Page | 1280 now → target | 375 now → target |
|---|---|---|
| Front door | 555 → ≤ 400 | 707 → ≤ 480 |
| Target page (with both new strips) | 345 → ≤ 330 | 467 → ≤ 470 |
| Watchlist | 385 → ≤ 300 | 489 → ≤ 400 |
| Changes / Trials | 363 / 335 → ≤ 260 | 399 / 348 → ≤ 330 |
| Trial page | 284 → ≤ 240 | 436 → ≤ 380 |

The target page gains two lines (diligence strip, contents strip) and still has to start its timeline no lower than today; the header savings pay for them.

## 7. Changes, Trials, trial page and Methods on the Figure Plate

Martin chose this on 2026-11-10. The goal is the same tokens, type, controls and page head as the plate pages, not new features.

**Shared**
- One token set: the plate tokens (`--plate --ink --muted --rule --pale --red`, mark tokens `--run --stop --fin --unk --fam`). `--bg --fg --accent --card --warn-bg --warn-fg --ok` go; `styles.css` aliases are removed once nothing reads them.
- Links in ink with a muted underline that darkens on hover (as on plate pages); focus ring 2px ink, 2px offset everywhere. No blue.
- Same full-width column with 40px gutters (16px on a phone) as the plate pages; prose blocks keep a 68ch measure inside it.
- Registry codes shown as words: Recruiting, Active, not recruiting, Completed, Terminated, Withdrawn, Unknown; Phase 1, Phase 1/2, …, "No phase" for NA. One date format everywhere: "6 Nov 2026" (month and year when the registry gives no day). One shared formatter, used by all four pages.
- Status shown with the plate's mark vocabulary where it applies (running ring, stopped dot, finished pale dot) beside the word, never colour alone.

**Changes**
- Range picker (1 / 7 / 30 days) becomes the plate's segmented pill (selected = solid ink).
- Sponsor and Field become plate dropdown pills (the Watchlist's filter component, with counts); "Notable only" becomes the plate's narrowing pill (as Results posted on Explore).
- Table restyled as the Watchlist's table: hairline rows, 13px, tabular dates; old value struck through in muted, new value in ink; "slipped 212 days" stays bold.
- Phone: two-line rows (trial and change on one, field and why on the next), not bordered cards with uppercase labels.

**Trials**
- Shows 50 rows, then "Show 50 more" with "Showing 50 of 2,987" (the Watchlist's pattern). The search still searches everything. This is the largest fix on the page.
- Search becomes the plate's find pill; Status becomes a dropdown pill with counts.
- Rows: NCT (700) · status mark and word · phase · primary completion · last change, title in 13px under the NCT, sponsor muted. Phone: two lines per trial, no cards.
- The `?nct=` banner ("Showing 35 trials from CD20 · Clear") keeps its behaviour in plate styling.

**Trial page**
- Page head: back link as a breadcrumb in the target page's style, the title at 28px/600 (long titles wrap; no 32px bold), then NCT and the CT.gov link on one muted line.
- Facts as the trial card's two-column fact list (muted terms in sentence case, not uppercase), in two columns at 1280.
- The stop-risk block keeps its content; Summary, Timeline and Change history become lettered or plainly headed sections with the plate's 13px/700 heading over an ink rule (lettering is the builder's call: letters are for figures, and this page is a record, so plain headings are the default).

**Methods** (12,443px today)
- Side by side (≥ 1100px): a sticky contents list in a left column (section titles, current one marked, the same behaviour as the target page's strip), prose in a 68ch column beside it. Below 1100px: the contents list as a block at the top, then the prose.
- Prose 15px/1.6 (16px is fine for a reading page but sits outside the scale in §8; 15px is the scale's body-reading step).
- Headings on the scale; the stop-risk and diligence sections keep their figures and tables.

## 8. Type scale

Replace the eight sizes between 11 and 15px with six steps, Hanken Grotesk only:

| Step | Size / line | Use |
|---|---|---|
| Meta | 12 / 1.45 | captions, notes, sub-lines, axis labels in HTML, column heads |
| UI | 13 / 1.4 | controls, table cells, panel headings (700), company names |
| Body | 14 / 1.5 | panel prose, stop reasons, memo text |
| Reading | 15 / 1.6 | Methods prose, the target and Watchlist opening sentences on a phone |
| Lede | 19 / 1.35 (desktop) | target and Watchlist opening sentence |
| Display | 30 / 1.15 front-door headline; 40 target title (34 phone); 28 trial title | page heads |

- **12px is the floor for text.** Exceptions: SVG axis ticks and canvas numerals (11px), and the uppercase family band labels on the front door (11px/700 tracked, which read at that size because of weight and case).
- The 20px panel letter and the 30px key numbers stay.
- Expected effect: text under 12px drops from 46% to under 10% on the front door and from 37% to under 5% on the target page (re-measured with the same script). Front-door row height grows slightly; the builder checks the figure still fits as many rows above the fold as the header savings allow.

## 9. Smaller fixes found on the way

- Panel c's reason chips become full pills (999px) on a hairline border, matching every other control (Shape rule: pills only).
- The trial page's and legacy tables' uppercase labels become sentence case (Lowercase Letter Rule).
- Changes' "Notable only" checkbox visibility: confirm and fix as part of the pill change.

## 10. Constraints

- Static site, $0 running cost, React 19 + TypeScript + Vite, HashRouter (deep links use query params, not `#` fragments).
- Works at 375px; light and dark; keyboard reachable; screen-reader names for the strips; colour never the only carrier; reduced motion respected.
- Every sentence on plate pages stays computed from the data (the strips' numbers and the diligence line included).
- Existing e2e tests (71 passing) and vitest (635) stay green; selectors that change are updated, not deleted.
- DESIGN.md, `.impeccable/design.json` and PRODUCT.md are updated to describe what ships, and DESIGN.md drops its "Changes, Trials, trial detail and Methods do not yet [follow the system]" caveat.
- Never push; never port 4173; never call AWS. Subagent-driven: Sonnet builders for well-specified tasks, Opus for UI-heavy tasks and the reviews.

## 11. Left to the builder

- Component boundaries (for example a shared `PageHead`, `ContentsStrip` used by target pages and Methods, a shared registry-words formatter).
- Exact pixel spacing inside the stated targets, and breakpoints between 641 and 1099px.
- Whether f's expanded state is kept in the URL (§4).
- Whether Methods' contents list and the target strip share one component.
- Which panel the strip marks current when b and c sit side by side at 1280 (one row, two panels).
- Panel g's sticky trace (`.dg-tr`, `top: 16px`) must clear the sticky contents strip; the builder offsets it by the strip's height.
- The diligence run state moves out of `TargetDiligence.tsx` into a shared hook used by the strip and panel g.
- Ordering of the work; the plan should land the token unification early so later tasks build on one token set.

## 12. How it is checked

- Re-run the fold measurement and the type-size script (kept in the session scratchpad: `measure.mjs`, `type.mjs`) on the same real data at 1280 and 375; report before and after in one table.
- Screenshots of every page at 1280 / 375 × light / dark after the change, beside the before shots.
- A keyboard-only pass (strip reachable, Enter moves focus to the panel) and a screen-reader name check of both strips.
- Print preview of a target page shows all panels in full and no strips.
- An Opus finish review against this spec and DESIGN.md before handing back.
