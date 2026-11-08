# Front door: the pipeline figure and target pages (design)

Status: for Martin's approval, 2026-11-08 (session 7b); builder check done and folded in. Approach B from HANDOFF §00.
Approved comp: `docs/superpowers/mockups/2026-11-08-front-door/front-door-v1.html` (open it in a browser; real data, snapshot 2026-11-06). Martin's verdict on it: "I actually love it… it looks like an amazing product." **The build matches this comp.** Screenshots: `s-pipe.png`, `s-tgt.png` in the same folder. `build_data.py` there is the throwaway script that produced the comp's data; it is a sketch of the rules in §6, not code to reuse.
Evidence: `docs/superpowers/research/2026-11-08-front-door-research.md`.

## 1. Intent

Trial Radar is a portfolio showcase. Today a newcomer lands on a UMAP similarity map whose axes mean nothing and whose loudest finding is null (p = 0.061). They don't know where to start.

**The reader** is a pharma or biotech R&D researcher or manager sizing up MS and related autoimmune neurology (MG, NMOSD, CIDP, MOGAD, autoimmune encephalitis) for drug-discovery bets. Not a treating clinician. In the first minute they should see:
1. **What's in the pipeline:** which targets have running trials, at which phase, from which companies.
2. **What's working:** which targets' drugs advanced to a later phase.
3. **Who:** competitive intelligence. "Who is working on FcRn?", "Roche's MS pipeline".
Then they explore the data themselves.

**The new front door** is a pipeline figure: rows are target classes grouped into families, columns are phases, each mark is one trial, companies sit on each row. A data-generated headline and margin notes say what's notable. Clicking a row opens a **target page**. The similarity map and the mechanism graph move into an Explore drawer.

## 2. Goals, non-goals, anti-goals

**Goals**
- G1. `/` is the pipeline figure, readable in one glance on desktop and phone, light and dark.
- G2. Every claim on the page is computed from the data, survives the daily refresh, and states its denominator and date.
- G3. Sponsors are shown by parent company; industry and academic are distinguished.
- G4. A company lens answers "X's pipeline" without a separate page.
- G5. Target pages: timeline by drug, companies, what stopped and why, the mechanism chain.
- G6. Plain words across the whole app (§9), not only the new pages.
- G7. Clear two-way hand-offs between Pipeline, target pages, map, graph and Approaches, with the disease filter in the URL.
- G8. The front page loads fast: it fetches only `pipeline.json` (target ≤ 200 KB raw) and `meta.json`.

**Non-goals (this round)**
- Company pages (`/company/:id`). Named follow-up.
- A timeline arrangement on the similarity map (Martin's earlier decision, dropped this round on 2026-11-08: the target page carries the timeline where it means something). Named follow-up.
- An animated transition between map arrangements.
- Any data source beyond ClinicalTrials.gov.
- New investment in the similarity map beyond the trims in §8.3.

**Anti-goals (a failure even if it technically works)**
- Plain tables. Martin is big on design; the figure is marks, not a grid of numbers.
- Claims the data can't carry. **No "open opportunity" or "white space" label anywhere.** A target with few registered trials might be untried, abandoned, preclinical or run outside the registry.
- "Advanced" read as "worked". Daclizumab advanced and was withdrawn from the market in 2018 for safety. The page says what "advanced" means every time it is the headline.
- Running trials read as failures.
- Hand-written annotation text that goes stale after a refresh.
- A forced tour, a modal, or a "Data may be stale" warning as the first words.
- AI-slop styling: gradients, glassmorphism, emoji, generic cards. The comp is the bar.

## 3. Constraints

- Stack: existing React + TypeScript + Vite web app (`web/`), HashRouter; Python pipeline (`pipeline/`, uv). Static site, JSON written by the pipeline (HANDOFF §2.4 contract).
- Design system: the Figure Plate (`DESIGN.md`, `.impeccable/design.json`): Hanken Grotesk, white plate, rubric red `#c8102e` for advanced, outcome colours, dark parity. New surfaces extend it; DESIGN.md and design.json are updated at the end.
- R19: missing config or a failed stage logs a warning and the run continues; the front page then shows a calm fallback (§7.6), never a blank page.
- Never push; Martin pushes (org block). Work on the current unpushed branch `feat/explorer-figure-plate` or a branch off it.
- The Explore and Mechanisms behavioural contracts (HANDOFF §2.6, §6 rulings, R18/R21 success rules, 1b success credit) are unchanged unless §8 says otherwise.

## 4. Approaches

**Front door (decided before this brainstorm).** A: add a lede band to the current pages. B: a pipeline figure as the front page with target pages behind it. C: search-first entity pages. **Martin chose B**; C was too table-like, A left the UMAP as the first impression.

**Where the figure's data comes from (decided 2026-11-08).**
- **A. A new pipeline stage writes `pipeline.json`** (chosen). Rules live in Python next to the mapping tests; the front page loads ~150 KB, not the 2 MB `explorer.json`; aggregates are computed in the browser so they follow the disease switch and company lens.
- B. Add fields to `explorer.json` and compute in the browser: the front page would wait on 2 MB, and stop reasons (in 2,987 trial files) would bloat it.
- C. All in the browser from existing files: would fetch every trial file for stop reasons. Ruled out.

**Company intelligence (decided).** A company lens on the figure (chosen) over company pages (follow-up).

**Explore (decided).** Explore becomes a tool drawer (map, graph), not a destination; Mechanisms' rail and kind trees become "Approaches"; the harsher option (retire the map) was rejected because the map is the only visual of all 2,987 trials.

## 5. Information architecture

**Nav:** Pipeline · Approaches · Explore ▾ (Trial map, Mechanism graph) · Changes · Trials · Methods. Freshness reads "Registry data from 6 Nov 2026" (green dot); the stale warning appears only when stale, after the brand, never as a headline.

**Routes**
| Route | Page |
|---|---|
| `/` | Pipeline figure (new). Query: `disease`, `company`, `sort`. |
| `/target/:slug` | Target page (new). Query: `disease`. Unknown slug → "No target called …" with a link back. |
| `/approaches/:approach` | Today's Mechanisms page, renamed. `/mechanisms/*` redirects here (old links keep working). |
| `/explore` | Trial map. Stays at this route; nav label "Trial map" under Explore. |
| `/approaches/targeted` | The targeted-drugs graph, as today. Nav label "Mechanism graph" under Explore points here. |
| others | Unchanged. The catch-all now redirects to `/`. |

Implementation note: "Mechanism graph" and "Approaches → Targeted" are the same canvas. The Approaches rail's Targeted chip shows a short lede above the graph, "Targeted drugs are on the Pipeline, grouped by target → Open the pipeline", so the reader isn't stranded.

**The disease filter travels.** One `disease` query value (`MS`, `MG`, `NMOSD`, `CIDP`, `MOGAD`, `AE`; absent = all). Pipeline and target pages are single-select and own it. The trial map and the graph keep their multi-select Disease filters unchanged: on arrival they preselect the one disease in `disease`; when exactly one disease is selected they write `disease` into the URL and their outgoing links; with two or more selected, outgoing links carry none (the hand-off falls back to all diseases, which is visible on arrival). Short codes are added to `config/area.yaml` next to the condition labels.

## 6. Data and rules (pipeline)

### 6.1 Config files (committed, hand-kept)

New folder `config/pipeline/` with a README in the style of `config/mechanisms/README.md`.

1. **`rows.csv`**: `row_id, label, sub, family, family_order, row_order, classes, drugs`.
   - `classes` is a `;`-separated list of ChEMBL mechanism class strings (exactly as in `drug_index[...].mechanisms`). `drugs` is a `;`-separated list of canonical drug names that map to this row regardless of class (for ambiguous classes: cladribine sits in "DNA inhibitor" with cyclophosphamide; clemastine sits in "H1 receptor antagonist" with cetirizine).
   - `label` is the name researchers say (CD20, FcRn, C5, BTK, S1P receptor); `sub` is the gene and format line ("MS4A1 · antibodies"). Labels reuse `config/mechanisms/target_labels.csv` where it covers the gene.
   - `row_id` is the URL slug (`cd20`, `fcrn`, `cd19-car-t`).
   - Seed: the comp's 22 rows and 8 families (§6.5). The builder extends it so that every mechanism class with ≥ 3 trials since 2012 is either in a row or listed in `unrowed.csv` (`class, reason`, e.g. "symptomatic", "antiviral prophylaxis", "too few"). A test enforces this so new classes can't silently vanish.
2. **`background.csv`**: `drug, reason`. Drugs that never put a trial in a row when the trial has another experimental drug: conditioning chemotherapy (fludarabine, cyclophosphamide when given with a CAR-T or transplant), corticosteroids given alongside, premedication (cetirizine, paracetamol, diphenhydramine), antiviral prophylaxis, contrast media. Seed from the comp's list. If background drugs are all a trial has, they do define its row (methylprednisolone-only trials stay in Glucocorticoids, if that row exists).
3. **`config/sponsors/parents.csv`** (new folder): `sponsor, parent, kind`. `sponsor` is the raw lead-sponsor string (matched case-insensitively after whitespace normalisation); `parent` the display name (Roche, Novartis, Merck KGaA, AstraZeneca, J&J, Gilead…); `kind` is `industry`, `academic`, `government` or `other`.
   - Seeded from the top ~150 sponsors by trial count, plus every industry sponsor appearing in a row. Known merges from the data: Hoffmann-La Roche + Genentech + Chugai → Roche; Novartis Pharmaceuticals + Novartis → Novartis; Merck KGaA + EMD Serono + Merck Healthcare KGaA → Merck KGaA; Alexion + MedImmune + AstraZeneca → AstraZeneca; Janssen + Actelion + Momenta → J&J; Celgene → BMS; Kite → Gilead; Loxo Oncology → Lilly; Ra Pharma → UCB; Viela + Horizon → Amgen; Genzyme → Sanofi.
   - **Unlisted sponsors:** `kind` comes from the registry's `sponsor_class` (`INDUSTRY` → industry, `NIH`/`FED` → government, else academic or other); display name is the raw string with legal suffixes trimmed (Co., Ltd., Inc., LLC, GmbH, AG, S.A., plc). The comp's regex-only guess wrongly made individual investigators ("Daishi Tian") industry; `sponsor_class` fixes that.
   - A pipeline warning lists unlisted industry sponsors with ≥ 3 trials, so the file gets maintained.

### 6.2 Which drug puts a trial in a row

For each trial in the Targeted approach with a drug phase (`EARLY_PHASE1`, `PHASE1`, `PHASE2`, `PHASE3`, `PHASE4`; trials with phase `NA` are skipped):
1. Start from the trial's experimental drugs (`drugs`, already experimental-arm only).
2. Drop drugs in `background.csv`, unless that leaves nothing.
3. For each remaining drug: if it is in some row's `drugs` list, that row; else each of its mechanism classes that is in some row's `classes`.
4. A trial can sit in several rows (a combination of two targeted drugs). Each placement remembers the **drug that put it there**; the target page shows that drug, never the trial's first drug. Totals in headlines count distinct trials.
5. Trials with no row are counted in the source line's "not grouped" figure (§7.1) and listed in `pipeline.json` as `unrowed` counts per class, so Methods can say what isn't shown.

Known limit, stated in Methods: some trials list standard-of-care comparators inside an experimental arm (e.g. "interferon or glatiramer" in a switch study). Those drugs can pull a trial into a second row. The builder checks the snapshot for this pattern (trials in ≥ 2 rows where one row is Interferon-β, Glatiramer or Glucocorticoids) and either adds a narrow rule or lists the cases in Methods; not silently ignored.

### 6.3 Per-trial fields

- **Column:** `EARLY_PHASE1`/`PHASE1` → Phase 1; `PHASE2` → 2; `PHASE3` → 3; `PHASE4` → "Approved use". The `phase` field already holds the higher phase of a combined trial; keep that, and add `span: "1/2" | "2/3" | null` from `phases`. Combined trials draw in the higher column with a short tail into the lower one (the comp's `cb` mark).
- **State, per placement (not per trial):** from `outcome`: `running` → `run`, `stopped` → `stop`, `completed_unknown` → `fin` (Finished, no follow-on), `unknown` → `unk`. For `succeeded`, the existing success rules decide, so the Pipeline and the Approaches/graph never disagree:
  - **1b:** the placement is `adv` only if its drug (the one that put the trial in this row) is in the trial's `succeeded_by`. Otherwise the placement is drawn as `fin`, and its tooltip and trial card say "Advanced, through {drug}". On the snapshot, 16 of 56 succeeded targeted trials credit only some of their drugs.
  - **R21:** each placement also carries `succeeded_in` (disease labels). Under a disease filter, a placement counts as `adv` only if that disease is in `succeeded_in`; otherwise it is drawn as `fin`. (Affects 1 trial on the snapshot.)
- **Dates:** `start_year`, `end_year`, `end_estimated` (exist in `explorer.json`).
- **Diseases:** short codes from `condition_labels`.
- **Sponsor:** raw string, `parent`, `kind`.
- **Stop reason** (stopped trials only): `why_stopped` text (registry, verbatim, max 300 chars) and a `reason` group from `config/pipeline/stop_reasons.csv` (`pattern, group`, ordered, first match wins). Groups: Business or strategy · Slow enrolment · Safety · Efficacy or futility · Funding · COVID-19 · Sponsor or investigator decision · Other · Not given. **Target: "Other" ≤ 15% of stopped trials with a reason** on the snapshot; if the rules can't get there, the target page shows the quotes without the group chips (the builder reports which). In the comp, "Other" was the largest CD20 group, which is the failure to avoid.

### 6.4 `pipeline.json` (site JSON contract, new)

The comp's source line said "612 of 2,987 trials test a drug with a known target", which overstates: 612 is the rowed count, not every targeted trial. §7.1 has the corrected wording.

Written by a new stage `pipeline_figure` (logged with `_stage`, after `explorer`, before `mechanism_graph`; R19 on failure: warning `pipeline_figure: …`, no file, run continues). Shape:

```jsonc
{
  "generated_for": "2026-11-06",
  "counts": { "trials": 2987, "targeted": 1062, "in_rows": 612, "targeted_not_rowed": 450 },   // illustrative numbers
  "families": [{ "id": "b-cell-depletion", "label": "B-cell depletion", "order": 1 }],
  "rows": [{
    "id": "cd20", "label": "CD20", "sub": "MS4A1 · antibodies", "family": "b-cell-depletion", "order": 1,
    "gene": "MS4A1",                       // for the graph hand-off; null for class rows
    "chain": ["CD20", "B-cell receptor signalling", "Adaptive immune system"],  // from mechanisms.json; may be []
    "related": ["cd19", "cd20-car-t", "baff-april"],                            // same family, or listed in rows.csv
    "marks": [ { "n": "NCT…", "c": 3, "span": "2/3", "s": "run", "y": 2021, "y2": 2027, "est": true,
                 "dz": ["MS"], "drug": "ocrelizumab", "sp": 12 } ]               // sp = index into sponsors
  }],
  "sponsors": [{ "raw": "Hoffmann-La Roche", "parent": "Roche", "kind": "industry" }],
  "trials": { "NCT…": { "title": "…", "why": "…", "reason": "Business or strategy" } },  // title for every mark; why/reason for stopped only
  "unrowed": [{ "class": "Kv channel inhibitor", "trials": 27, "reason": "symptomatic" }]
}
```
Exact key names are the builder's; the contents are not. Size target ≤ 200 KB raw; if over, drop `title` to 80 chars first. Web fixtures (`make_web_fixtures.py`) gain a `pipeline.json`, and the stale-fixture test covers it.

### 6.5 Seed rows (from the comp, real numbers on the 2026-11-06 snapshot; all-diseases, running / total)

- **B-cell depletion:** CD20 (53/123) · CD19 (7/10) · BAFF / APRIL (4/13)
- **IgG and complement:** FcRn (23/50) · C5 (12/28) · C1s / C2 (9/9)
- **Cell therapy:** CD19 CAR-T (22/27) · BCMA CAR-T (17/20) · CD20 CAR-T (5/5)
- **Kinases:** BTK (15/36)
- **Cytokines and co-stimulation:** IL-6 receptor (7/15) · CD40L / CD3 (8/8)
- **Lymphocyte trafficking:** S1P receptor (7/74) · α4-integrin (0/31)
- **Broad immune modulation:** DHODH · Fumarates · CD52 · Interferon-β · Cladribine
- **Repair and protection:** Clemastine · LINGO-1 / RGMa · Syncytin-1

The builder should add rows the comp missed if they clear the bar in §6.1 (e.g. Glucocorticoids, ACTH, Glatiramer if mapped, IL-17A, anti-CD38), and decide whether symptomatic classes (Kv channel / fampridine, cannabinoids) get a "Symptom relief" family or go to `unrowed.csv` with reason "symptomatic". **My call: a "Symptom relief" family at the bottom**, because R&D readers do fund symptomatic programmes; flag it in the report.

## 7. What the visitor sees

The comp is normative for layout, type, spacing, marks and tone. Below is what it doesn't fully say.

### 7.1 Pipeline figure (`/`)

**Lede (left) and key numbers (right).**
- Kicker: "MS and autoimmune neurology · drug pipeline".
- Headline, generated: "**N targeted-drug trials are running**[ in MG]. {Family} leads, with {k} of them; {Row} alone has {m}." Running count in the running blue, as in the comp. With the company lens: "**Roche**: 55 trials across 4 target classes; 12 running, 6 advanced." Edge cases: zero running under a filter → "No targeted-drug trials are running in {disease}; {n} finished or stopped." Ties: name the first by sort order.
- Key numbers: running (blue), advanced to a later phase (red), companies with a running trial (ink). All follow disease and lens.
- Source line (12px, muted): "{in_rows} of {trials} trials test a targeted drug in one of these {rows} classes; {not_rowed} more targeted-drug trials sit in smaller classes (Methods); the rest are care, cell transplant, plasma treatments and others (see all → `/approaches`). ClinicalTrials.gov registered trials only: no preclinical programmes, company pipeline disclosures or EU-only trials." The "not grouped" targeted trials are reported in Methods with the `unrowed` list.

**Controls.** Disease segmented control (All diseases · MS · MG · NMOSD · CIDP · MOGAD · AE; on phone it scrolls horizontally). Company lens: a search field with suggestions from parent names (industry first, then others), plus clicking any company name on a row; active lens shows as a dark chip with ✕. Sort: most running (default) · most advanced · newest activity (trials started in the last 5 years) · A–Z. All three in the URL.

**Legend.** Advanced to next phase (red filled) · Still running (blue ring) · Stopped (ink filled) · Finished, no follow-on (pale filled) · Status unknown (grey dashed ring). Desktop also: "One mark per trial, oldest first · ⟜ spans two phases".

**Figure grid (desktop).** Target column (label, sub, top 3 industry parents as links, "+k · n academic") · Phase 1 · Phase 2 · Phase 3 · Approved use (each with its "incl. …" sub-label) · Running (big number "of total", thin bar, "k companies") · margin notes column. Family headings as small-caps bands. Marks are 8px, wrap within the cell, ordered by start year. Hover a mark → tooltip (title, drug · parent, NCT · phase (span) · start year · state). Click a mark → trial card popover (§7.3). Click elsewhere on a row → its target page. Row hover tints the row.

**Mostly historical.** Rows with ≤ 1 running trial and ≥ 12 trials sink under a dashed "Mostly historical — many past trials, at most one running" divider, at 62% opacity. A factual statement about trial starts, not advice. The thresholds live in one constant.

**Margin notes (data-generated, ≤ 4, none hand-written).** Rules evaluated in order, each on a different row, each with a minimum:
1. Most crowded: max running, min 5. "{run} trials running, from {k} companies plus academic groups."
2. Newest wave: max share of trials started in the last 5 years, min 5 trials and 60%. "{r} of {n} trials started since {year}."
3. Most advanced: max advanced, min 3. "{a} trials advanced to a later phase."
4. Most stopped: max stopped, min 5. "{s} stopped; {k} of them by {parent}. Reasons on the target page." (Names the sponsor, so one company's portfolio decision doesn't read as a failed target.)
Notes recompute with disease and lens; with the lens on, notes are hidden (the lens is the story). A note's red kicker and hairline leader as in the comp.

**Company lens.** Marks of the chosen parent at full opacity with an ink outline; all other marks at 13%; rows without the company fade to 45%; rows re-sort so the company's rows come first (within the current sort). The headline switches (above). URL `?company=roche`.

**Footer line.** "'Advanced' means the drug has a later-phase trial on the registry. It does not mean the drug worked or was approved." Links: Methods · Trial map · Mechanism graph.

**Phone (≤ 640px).** As the comp: stacked lede, three key numbers in a row, sticky phase header (Ph 1 · Ph 2 · Ph 3 · Approved), each row as label + sub + "{n} running" on one line, a four-column mark strip (6px marks), top 3 company names, and its note inline under the row. Tap a row → target page; tap a mark → trial card as a bottom sheet. No hover-only information.

### 7.2 Target page (`/target/:slug`)

As the comp:
- Breadcrumb "Pipeline / {family}" (Pipeline keeps the disease query).
- Title: the label, large (48px), with "gene {GENE} · {family} · {format}" beside it. Lede, generated: "{run} of {n} trials are running, from {k} companies and academic groups. {a} advanced to a later phase; {s} stopped." Key numbers right. Disease chips with counts (clicking one sets the disease filter).
- **a. Every {label} trial over time, by drug.** One lane per drug with ≥ 4 trials (normalised drug names; the remainder grouped as "Other {label}"); within a lane, trials packed into tracks. Each trial a line from start to end (expected end if estimated); thicker = later phase; advanced ends in a red dot, stopped ends in a short ink tick, finished is pale, unknown dashed; running starts with an open ring and continues dashed past the "Data as of {date}" rule. Year axis 2000 to the latest expected end + 1 (clamped at 2032). Hover → tooltip; click → trial card. Phone: same chart narrowed to the screen width, lane label above its lane.
- **b. Who is working on {label}.** One line per parent (industry first by trial count, then a single "Academic and other" line): name, its drugs (≤ 2), its trials as marks sorted advanced → running → stopped → finished, "{n} · {run} running". Top 7 plus "+k more" that expands. Clicking a parent goes to `/` with that company's lens.
- **c. What stopped, and why.** Reason-group chips with counts (if §6.3's target is met), then stopped trials as quoted reasons with "drug · parent · phase · year · NCT". Six shown, "Show all {s}" expands. If none stopped: "No {label} trial has stopped."
- **d. How it works.** The drug → target → pathway chain (row `chain`, built from `config/mechanisms/pathways.json`, since the stage runs before `mechanism_graph`; the graph link is hidden when the 300-node limit dropped the gene from the graph), drug pill in red, with "Open in the mechanism graph →" (graph focused on the gene node; class rows without a gene show the chain without the link). One plain sentence per row from `rows.csv` (new optional `blurb` column; empty → omitted). Related rows as links.
- Footer: limit line, and "Show these {n} trials on the map →" (the existing map arrival banner, given this NCT set).

### 7.3 Trial card

One component used by the figure (popover / bottom sheet) and the target page: title, NCT, drug, parent (raw sponsor in small type if different), phase (span), start–end, state in words, why stopped if any. Actions: "Open trial page" (`/trial/:nct`), "Show on map", "ClinicalTrials.gov ↗".

### 7.4 Approaches (`/approaches/:approach`, renamed Mechanisms)

- Rename in nav, title and copy. Kind trees unchanged.
- **Unclassified leaves the rail.** Under the rail, a muted footnote: "{n} trials not yet categorised ({u} unsorted names, {d} diagnostic or not a treatment). How we sort →" linking to a Methods section that lists them. On Explore it stays as a filter value renamed "Not yet categorised", last in every key.
- Targeted chip: the lede pointing to the Pipeline (§5), then the graph as today.
- Graph target node panel gains "Open {label} page →" when the gene belongs to a row; arriving from a target page shows "← Back to {label}".
- **Fix "Where successes converge":** pathways reached by exactly the same set of trials collapse into one entry, labelled with the most specific pathway and "+k related pathways (same trials)". Today daclizumab and IL-2, through the shared IL2RG chain, light six pathways (IL-2, 7, 9, 15, 21, ALK signalling) each at 5 of 10, i.e. one drug family shown six times. Test with that case.

### 7.5 Trial map (`/explore`)

Trims only: remove panel b "By approach" (duplicate of Approaches and the Pipeline), remove the rotation and "Play", replace "Embedding of N trials (…)" with "{N} trials; similar trials sit close together", move the p-value sentence to Methods. Trial card gains "Open {label} target page →" when the trial sits in a row. Disease filter read from and written to the URL.

### 7.6 States

- Loading: the lede skeleton (headline block, three number placeholders) and grey row bands; no spinner.
- `pipeline.json` missing (R19): headline "The pipeline figure isn't available for this data refresh", with links to the Trial map and Trials; no fake numbers.
- Filter with no rows (e.g. AE + a company with nothing there): "Nothing for {company} in {disease}. Clear the company lens →".
- Unknown target slug: "No target called '{slug}'. Back to the pipeline →".

### 7.7 Accessibility and motion

- The figure has a text alternative: each row is a focusable link with an accessible name like "CD20: 123 trials, 53 running, 11 advanced, 8 stopped. Open target page." Marks are not individually tab stops on the figure (too many); the trial card is reachable from the target page timeline via its list fallback ("List these trials" toggle under panel a, which also serves as the no-JS / screen-reader view of the chart).
- Colour is never the only cue: running is a ring, unknown dashed, stopped an ink fill or a tick.
- Contrast: all text ≥ 4.5:1 in both themes; marks against the plate ≥ 3:1, except "Finished, no follow-on" which is deliberately quiet (pale) and is always paired with the legend.
- Lens and filter changes may cross-fade marks (≤ 180ms); `prefers-reduced-motion` turns it off.

## 8. Plain words (whole app)

From the research note's jargon table; the builder applies every row:

| Old | New |
|---|---|
| Succeeded (drug moved to a later phase) | Advanced to next phase |
| Completed, outcome unknown | Finished, no follow-on |
| Succeeded via another drug | Advanced, through {drug} |
| credited to the drug that moved on | counted for the drug that advanced |
| Share that succeeded, of finished trials that could succeed | How often the drug advanced to the next phase |
| success pool | finished trials that count |
| Acts on MS4A1 (binding agent) | Target: CD20 (gene MS4A1) |
| Embedding of N trials (…) | N trials; similar trials sit close together |
| cluster no more than chance would (p = …); shuffled labels | Successful trials aren't concentrated in one part of the map (p-value in Methods) |
| Treatment / Mechanism / Modality / Approach (Explore toolbar dimensions only) | Intervention type / Drug target class / Drug format / Approach, each with a one-line hint. "Approach" is kept because it is the Approaches page's name; the problem was four unexplained terms, which the hints fix. |
| Unclassified, Not yet sorted… | Not yet categorised |
| "proposed" tag | Thought to work by: |
| Reactome pathway / GO term / Hollow: too few to tell | Biological pathway / Pathway (other source) / Size = number of trials |
| panel d; Click a dot in **a** | the trial card below; the map |
| Data may be stale. | Registry data from {date} (stale state: "Registry data from {date}, {n} days old") |
| Hover a node… (on touch) | Tap a node… |

Methods gains: what "advanced" means and its time bias (recent trials can't have advanced yet); the registered-trials-only limit; how rows and parents are assigned and where the files are; the unrowed classes; the comparator-arm limit (§6.2); the similarity-map statistic moved from Explore.

## 9. Testing

- **Pipeline (pytest):** row assignment (background drop, background-only fallback, drug-list override, multi-row with the right drug per placement, NA phase skipped); span; state mapping; parent lookup (case/whitespace, `sponsor_class` fallback, suffix trimming); stop-reason grouping; the coverage test (§6.1: every class ≥ 3 trials since 2012 is rowed or in `unrowed.csv`); `pipeline.json` schema and size; R19 path. A snapshot check script prints per-row counts and the "Other" share for the report.
- **Web (vitest + Testing Library):** headline and notes generators (filters, lens, ties, zero-running, thresholds); lens fading and re-sort; URL state round-trip; target page lanes ("Other" grouping), company list, stop list, empty states; convergence de-duplication (the IL2RG case); every renamed string (a test that the old strings in §8's left column are gone from the rendered app; "Approach", "Approaches" and "Mechanism graph" are allowed).
- **E2E (Playwright, existing setup):** `/` renders from fixtures; disease switch; lens via a company name; row → target page → "Show on map" arrives with the banner; graph "Back to {label}"; `/mechanisms/targeted` redirects; phone viewport has no horizontal scroll.
- **Visual:** screenshots of Pipeline and CD20 target page, desktop 1280 and phone 375, light and dark, on the real snapshot, for the finish review.

## 10. Delivery

Order (each step leaves the app working):
1. Config files + `pipeline_figure` stage + `pipeline.json` + fixtures.
2. Web: data loader and the figure (desktop, phone, both themes), routes and nav.
3. Target page and trial card.
4. Company lens and URL state.
5. Hand-offs: Approaches rename and redirects, graph links and back link, map trims and links, convergence fix.
6. Plain-words sweep and Methods.
7. Reviews (whole-branch code review, then the design finish review against the comp on real data), fixes, then DESIGN.md, design.json, README and HANDOFF.

Execution as a workflow: Sonnet for well-specified builders; Opus for reviews, UI work and the final review (Martin, 2026-11-08). Local commits only.

## 11. My calls (for Martin to check)

1. "Advanced" gets no column; it's a mark state (a phase-2 trial that advanced already has its follow-on in the phase-3 column; a column would count it twice).
2. Phase 4 is shown as an "Approved use" column, not dropped: it shows where a target is already on the market.
3. "Mostly historical" thresholds: ≤ 1 running and ≥ 12 trials.
4. Newest wave = started in the last 5 years (the comp used "since 2021").
5. A "Symptom relief" family at the bottom rather than hiding symptomatic classes.
6. Margin notes are hidden while the company lens is on.
7. The graph stays the same canvas as Approaches → Targeted; the nav just points two labels at it.
8. Target-page drug lanes need ≥ 4 trials; smaller drugs pool into "Other {label}".
9. If stop-reason grouping can't reach ≤ 15% "Other", group chips are dropped and only quotes shown.
10. `/explore` keeps its route; only its nav label changes.
11. Mark state follows the existing 1b and R21 success rules per placement (§6.3); an uncredited placement in a combination trial is drawn "Finished, no follow-on" with "Advanced, through {drug}" in its tooltip, not a sixth mark style.
12. The map and graph keep multi-select Disease filters; only a single-disease selection travels in the URL (§5).
13. The Explore toolbar keeps the word "Approach" (it names the Approaches page); the other three dimensions are renamed.

## 12. Left to the builder

Exact JSON key names; component structure and file layout; how the lens search suggests names; the exact row/family seed beyond §6.5 within §6.1's coverage rule; stop-reason patterns; the convergence collapse's label wording; skeleton details; the precise breakpoint behaviour between 640 and 1100px (the comp shows 1280 and 375; the grid must not scroll horizontally at any width, so the notes column moves under the row below ~1100px).
