# Explorer usability, drug mechanisms and the mechanism graph — design

Status: approved by Martin · 2026-11-06. Builds on the Explorer (`2026-11-05-explorer-figure-plate-design.md`, branch `feat/explorer-figure-plate`, unpushed). Visual rules: `DESIGN.md`.

## 1. Intent

Martin reads the Explore map the way he reads a single-cell UMAP: first he wants to know **what each cluster is**, the way you ask "is this a T-cell cluster?". Today the map cannot say. It labels disease regions only, and drug trials of the same mechanism (fingolimod, ponesimod: both S1P modulators) do not sit together, because every drug name is its own unrelated feature.

He wants three things, in this order:

1. **A map you can use:** it stops spinning when you want, tells you what a dot is on hover, has filters you can find (dropdowns above the map with select all/none), shows when a trial ran, and has a light/dark switch.
2. **Mechanism-aware clusters:** every drug gets its mechanism, target(s) and modality (small molecule, antibody, …). Mechanism becomes a layout feature (his analogy: choosing better "highly variable features"), clusters get automatic names ("MS · anti-CD20 (ocrelizumab)"), and success can be broken down by mechanism and modality. The question behind it: *across these diseases, what kind of treatment actually works?*
3. **A mechanism graph:** a second view, a knowledge graph of drug → target → pathway, where pathways connect to each other. At rest it is an overview; you focus it, and like a connectome where one neuron lights up its connections, the selected node and everything it reaches lights up while the rest fades. Filters such as "succeeded only" light up paths, so you can see whether successes **converge** on a shared pathway.

Audience (unchanged, `PRODUCT.md`): a hiring panel for a life-sciences AI-prototyping role first, then clinical-ops / competitive-intelligence readers. Honesty of method is part of the showcase.

Current measurement (snapshot 2026-11-05, dated, re-measure before quoting): 2,986 trials; 1,314 carry at least one cleaned experimental drug; the success pool is 478 finished trials, 66 succeeded. KMeans(14) on today's coordinates already separates *disease, then intervention type* (MS behavioural 397, MS devices 288, MS drugs 457/320/122, MS biologics 207, MG 197, NMOSD+CIDP 252, …) but does not split drug clusters by mechanism.

## 2. Goals, non-goals, anti-goals

**Goals**
1. Phase 1: pause/play spin, hover popup, dropdown filters above the map with select all/none, start–end years visible and a year filter, a light/dark/system theme switch.
2. Phase 2: a reviewed, committed drug → mechanism / target / modality mapping; a `mechanism` layout feature; named clusters; colour and filter by mechanism and modality; success by modality and mechanism with counts.
3. Phase 3: a `/mechanisms` graph view (drug → target → pathway, pathway hierarchy and shared-gene links), force-laid-out in the pipeline, with hover/click focus and highlight-not-hide filters, coloured by outcome.
4. Every phase ships on its own and keeps all gates green.

**Non-goals**
- Protein–protein interaction networks (STRING). Considered and rejected for now: hubs attract everything and mislead.
- Looking drugs up during the daily run or in the browser (approaches B and C, section 4).
- Guessing modality from drug-name endings (-mab, -nib). Unmapped stays unmapped.
- Per-mechanism significance tests or any claim that a mechanism "predicts" success.
- Restyling Changes / Trials / Methods beyond the theme switch and the new nav entry.
- The paused "Ask" feature.

**Anti-goals (failure even if it works)**
- A mapping that quietly guesses: a drug shown with a mechanism it does not have.
- A conclusion drawn from tiny groups. Every per-group rate shows its n; small groups say "too few to tell".
- The "neon brain" look. "Lights up" means full ink and opacity against faded context, inside the Figure Plate system, not glows on black (anti-goal carried from the Explorer spec).
- The daily run failing or slowing materially because of anything in this design (R19 holds).
- A layout that uses outcomes (mechanism is content, so it is allowed; success never is).

## 3. Constraints

- $0, no server, no secrets. Pipeline: Python 3.12, uv, polars, strict mypy, ruff, pytest. Web: Vite + React 19 + TypeScript, HashRouter, vitest, Playwright at desktop and 375px.
- New-area-is-config-only rule holds. The mechanism files are keyed by drug, not by condition, and live under `config/mechanisms/`; a new area reruns the mapping script and commits the result.
- Tests stay offline. The mapping script's tests use recorded HTTP fixtures; pipeline and web tests use small committed mapping fixtures.
- External data licences: ChEMBL is CC BY-SA 3.0, Reactome and Gene Ontology are CC BY 4.0. The committed mapping files carry a header/README with source, version/date and licence; the Methods page and the graph page credit all three.
- Never commit real trial data (unchanged). The mapping files are drug/pathway reference data, not trial data, and are committed.

## 4. Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **A (chosen)** | A script queries ChEMBL and Reactome and writes reviewed mapping files into `config/mechanisms/`; the daily run only reads them. | Daily run never depends on outside services; every mapping is reviewable; tests offline; $0. New drugs lag until the script reruns and show "unmapped" meanwhile. |
| B | Look drugs up during the daily run, cache on the `data` branch. | Automatic coverage; but the run depends on two services, wrong mappings go live unseen, coverage varies day to day. |
| C | Look drugs up in the browser. | Rejected: CORS, slow, untestable. |

Martin chose **A**, in three phases.

For the pathway connections Martin agreed with: **Reactome hierarchy as the backbone, plus shared-gene links between pathways**. Rejected: hierarchy only (groups by topic, shows no crosstalk) and protein interactions (hub artefacts).

For the graph look Martin chose a **force-laid-out network as the overview with connectome-style focus**, over a column (drug | target | pathway) layout.

## 5. Phase 1 — map usability

### 5.1 Spin
- The map **starts still** (my call: a still figure reads better and the user asked for it to stop). A play/pause button in the map's corner toggles spin; drag still turns it. Reduced motion: the button is hidden and it never spins (as today).
- Hovering the canvas pauses spin while the pointer is over a dot, so the popup does not slide away.

### 5.2 Hover popup
- On pointer hover (not touch), the nearest visible dot within the existing hit radius shows a small popup next to the pointer:
  `NCT01234567 · Title (truncated to one line)`
  `ofatumumab, teriflunomide · Drug · Phase 3 · 2014–2019`
  Phase 2 adds `· anti-CD20 · antibody`.
- Years: `start–end`, end = primary completion year (falls back to completion year); `2021–` when there is no end; `2021–2025 (est.)` when the end date is estimated.
- Click behaviour is unchanged (selects into panel d). Touch: tap selects, no popup.

### 5.3 Filters and toolbar
- One toolbar row **above** the map: Find (search, as today) · Colour (segmented control) · dropdowns **Disease, Phase, Outcome, Treatment, Years**, then the "Results posted" switch and "Reset all".
- Each dropdown is a multi-select popover: a checkbox list with counts and the colour swatch when that dimension is the colour mode, plus **Select all / Select none** at the top. The button shows its state ("Disease: all", "Disease: 2 of 6", "Phase: none").
- Years: a two-handle range (or two number inputs on narrow screens) over start year, min to max in the data. My call: filter on start year only, because it exists for nearly every trial; the popup shows the full span.
- The legend block below the map keeps the swatch legend and panel d; the toggle pills move into the dropdowns. At 375px the toolbar wraps; dropdowns open as full-width sheets.
- Accessibility: dropdowns are buttons with `aria-expanded`, the list is a group of checkboxes, Escape closes, focus returns to the button.

### 5.4 Theme switch
- A header control cycling **System / Light / Dark**, stored in `localStorage` (wrapped in try/catch; failure falls back to System). It sets `data-theme` on `<html>`; CSS keeps the `prefers-color-scheme` rules for System and adds `[data-theme="light"]` / `[data-theme="dark"]` overrides. The Explore canvas palette follows the effective theme. Applies site-wide.

### 5.5 Data change
- `explorer.json` trials gain `end_year: number | null` and `end_estimated: boolean`. Web types and fixtures follow (regenerate with `make_web_fixtures.py`).

## 6. Phase 2 — mechanism data, features and named clusters

### 6.1 Mapping script (`pipeline/scripts/map_mechanisms.py`)
Run by hand (Martin's Mac) or by a manual-dispatch workflow that opens a PR; never by `daily.yml`.
1. **Input:** the distinct cleaned experimental drug names (same cleaning as `explorer/drugs.py`, so names match) from a raw snapshot directory, with trial counts.
2. **ChEMBL** (REST, no key): name → molecule by exact preferred-name or synonym match only (case-insensitive; no fuzzy matching). For a match: `molecule_chembl_id`, `molecule_type` → modality, `max_phase`, and `mechanism` rows (`mechanism_of_action`, `action_type`, `target_chembl_id`) → target components → gene symbols and UniProt accessions.
3. **Reactome** (downloadable files, versioned): UniProt → pathways (all levels), the pathway hierarchy, and gene sets per pathway (for shared-gene links). Reactome's "Disease" and drug-action branches are excluded (they contain entries like "Rituximab:MS4A1 targets B cells…" and "Potential therapeutics for SARS", which would make the graph circular). Spot check 2026-11-06: MS4A1 2 pathways, ITGA4 6, S1PR1 3, BTK 14, C5 5, IL6R 7, CHRNA1 2, TNFRSF13B 1; **FCGRT (FcRn) 0**; CD52 1 (GPI-anchor synthesis only, biologically uninformative for alemtuzumab).
4. **Outputs** (committed, each with source, release/date and licence in `config/mechanisms/README.md`):
   - `drugs.csv`: `drug, status, chembl_id, modality, mechanism_class, mechanism, action_type, targets` (gene symbols, `;`-joined). `status ∈ mapped | unmapped | not_a_drug | manual`. `mechanism` is ChEMBL's wording, kept for the detail panels. **`mechanism_class`** is the short, grouped label used everywhere else (colour, filters, cluster names, success table, the feature block): the script derives it from the target family plus action type (fingolimod's four S1PR1/3/4/5 "modulator" rows → `S1P receptor modulator`; ocrelizumab → `anti-CD20`), and hand edits in `overrides.csv` win. Reviewing the classes of the drugs that cover most trials is a scheduled manual step in phase 2 (my call).
   - `overrides.csv`: hand-written rows (same columns) that always win: combination products, brand names, investigational codes ChEMBL lacks, or corrections. The script never edits it.
   - `pathways.json`: `{reactome_release, targets: {gene: [pathway_id]}, pathways: {id: {name, parents: [id], genes: n}}, overlaps: [[id_a, id_b, jaccard]]}` restricted to pathways reached by mapped targets plus their ancestors; overlaps only between those pathways and only above a floor (builder sets the floor so the file stays small, under ~1 MB).
5. **Modality values:** `small molecule`, `antibody`, `protein`, `oligonucleotide`, `cell therapy`, `gene therapy`, `other`, from ChEMBL `molecule_type` (+ override). Unmapped drugs have no modality.
6. **Review:** the script prints a coverage report (drugs mapped / unmapped, weighted by trials) and the unmapped list sorted by trial count, so the top gaps go into `overrides.csv` by hand. Target for the first commit: the drugs covering ≥ 80% of drug-bearing trials are mapped or explicitly `not_a_drug`.

7. **Gaps in Reactome (Martin's choice: combine three layers, each visibly marked).**
   - **Gene Ontology biological process** (QuickGO, CC BY 4.0) fills in for a target with no Reactome pathway or only an uninformative one (`config/mechanisms/go_fallback.csv` lists which targets use it, written by the script, reviewable). Example: FCGRT (FcRn) → GO:0002416 "IgG immunoglobulin transcytosis in epithelial cells mediated by FcRn". The GO term becomes a pathway-kind node with `source: "go"`.
   - **Curated links** (`config/mechanisms/curated_pathways.csv`: `target, node_label, note, source_url`) for what neither covers well, e.g. CD52 (alemtuzumab) → "lymphocyte depletion". Nodes and edges carry `source: "curated"`.
   - Shared-gene links come from Reactome only (GO terms overlap too broadly to mean anything).
   - Rejected: KEGG (redistribution restricted; this is a public repo), WikiPathways (uneven coverage; may be added later), Open Targets (reuses Reactome for pathways), MSigDB (gene sets without a hierarchy).

### 6.2 Pipeline
- A loader reads `config/mechanisms/*`. Missing or invalid files: the mechanism parts are skipped with an `explorer_mechanisms:` run warning; the run continues (R19).
- Unmapped drugs present in today's trials: one `mechanism_unmapped: <n> drugs (<m> trials)` warning.
- Each trial in `explorer.json` gains `mechanisms: string[]` (mechanism classes), `targets: string[]`, `modalities: string[]` (union over its experimental drugs; empty for drug-free trials).
- **Counting a trial with several mechanisms (Martin's choice):** it counts in every group it touches: success table rows, cluster-naming shares and graph nodes. Group totals can therefore add up to more than the number of trials, and the table says so in a note. In the Mechanism and Modality colour modes such a dot takes a neutral "multiple" colour.
- New feature block `mechanism` (TF-IDF over mechanism and target tokens, L2-normalised like the others), added to `FEATURES`, the `ExplorerConfig.weights` literal and `area.yaml` (starting weight 1.0; builder tunes, see 6.4). Drug-free trials get a zero row in this block, as they do for `molecule`.
- Outcome stays out of the features (the existing no-leakage test extends to the new block).

### 6.3 Named clusters
- The pipeline clusters the 3D coordinates (HDBSCAN, sklearn; parameters in config with sensible defaults) and names each cluster from what dominates it: `disease` if one label covers ≥ 60%; then `mechanism` if one covers ≥ 40% of the cluster's drug-bearing trials, else the dominant intervention type if ≥ 50% (`behavioural`, `devices`, …), else `mixed`; then the top drug in brackets when it is in ≥ 15%. Example: `MS · anti-CD20 (ocrelizumab)`, `MS · behavioural`, `NMOSD + CIDP · mixed`. Thresholds live in config.
- `explorer.json` gains `clusters: [{id, label, n, x, y, z}]` (anchor = densest point, as R17) and each trial a `cluster: number | null` (noise = null).
- The map labels clusters instead of diseases by default; a toolbar switch picks **Labels: clusters / diseases / off**. R17's placement and skip-when-diffuse rules apply to both.

### 6.4 Does mechanism improve the map?
- A dev script `pipeline/scripts/cluster_report.py` prints, for given weights, the cluster table (size, disease, type, mechanism, top drugs, purity). The builder runs it with mechanism weight 0 vs the default and records both tables in the PR. The default weight is chosen so drug clusters split by mechanism without dissolving disease separation; the choice and the before/after go in the PR description and the Methods page.

### 6.5 Web
- Colour modes add **Mechanism** and **Modality**. Mechanism colours the top mechanisms by trial count (as many as `DESIGN.md`'s categorical palette allows, light and dark) and puts the rest in "other"; drug-free and unmapped trials take the neutral fill. Red stays reserved for succeeded (R15), so mechanism/modality palettes exclude it.
- Dropdown filters add **Modality** and **Mechanism** (with a search box inside the dropdown, since there are many), both with select all/none.
- Hover popup and panel d show mechanism, target(s) and modality.
- The success panel gains a **By modality** / **By mechanism** switch: rows `group · finished n · succeeded n · rate`, same pool as R18. Groups with fewer than `min_group` finished trials (config, default 10) show "too few to tell" instead of a rate. No p-values per group.

## 7. Phase 3 — the mechanism graph (`/mechanisms`)

### 7.1 Graph content (built in the pipeline, exported as `mechanisms.json`)
- **Nodes:** `drug`, `target`, `pathway` (Reactome pathways reached by targets, plus ancestors up to a top-level pathway). Each node carries trial counts for all drug-bearing trials: `n`, `finished`, `succeeded`, `stopped`, `running`, and the condition labels it touches.
- **Edges:** `drug→target` (with action type), `target→pathway` (lowest-level Reactome membership, or the GO / curated fallback from 6.1 item 7, each edge and node carrying `source: reactome | go | curated`), `pathway→parent` (Reactome hierarchy; GO and curated nodes have no parent), and `pathway↔pathway` shared-gene links (Jaccard from `pathways.json`, kept above a threshold and at most top-k per node, both config).
- **Pruning:** to stay readable the builder caps pathway nodes (aim ~150–300 nodes total on today's data) by dropping pathways reached by only one target unless they are on the way to a kept ancestor. The cap and the rule go in config.
- **Positions:** a seeded 2D force layout computed in the pipeline (a small own implementation or `networkx`, builder's choice; add the dependency only if needed), exported as `x, y`. Seeded, so the same input gives the same picture. If the build fails: a `mechanism_graph:` warning, no `mechanisms.json`, the page says the graph appears after the next update (R19 pattern).
- Per-trial membership: each drug node lists its trial ids, so the web can derive which nodes a filtered trial set reaches without another file.

### 7.2 What the visitor sees
- A new nav entry **Mechanisms**. The page is Figure 2 in the Figure Plate system: a large canvas (2D, zoom and pan) plus a side panel.
- **Source is visible:** GO-sourced nodes and edges use a distinct marker/line style, curated ones are dashed and labelled "curated"; the side panel names the source and links to it.
- **At rest:** all nodes and edges drawn muted (thin, low-contrast ink); node size = trials reaching it; node shape or ring distinguishes drug / target / pathway; top-level pathways labelled.
- **Hover a node:** it and its one-hop neighbours go to full ink with their labels; everything else fades to faint context.
- **Click a node (focus):** lights up its whole chain: for a drug, its targets → pathways → ancestors; for a pathway, every target and drug that reaches it and its trials. The side panel lists the node's facts (mechanism, targets, Reactome link, ChEMBL link), its trial counts by outcome, and its trials (links to `/trial/:nct`). Escape or clicking empty space clears focus.
- **Filters light up instead of hiding:** Outcome (e.g. succeeded only), Disease, Modality, Mechanism, and a pathway/drug search. Matching paths are drawn in full ink; everything else stays faint. Succeeded paths use the success red (R15) so convergence of successes reads at a glance.
- **Colour:** node colour by success share among its trials **in the R18 pool** (the same denominator as the map's success panel, so the two figures never disagree), with n in the tooltip and panel; nodes with fewer than `min_group` pool trials are drawn neutral ("too few"). Node size still uses all drug-bearing trials (my call).
- **What lights up (my call):** focus and filters travel only along drug → target → pathway → parent edges. Shared-gene links are context: drawn, never followed, and shown in full ink only between two nodes that are already lit (otherwise one hop lights the whole graph). Top-level Reactome pathways ("Immune System", "Signal Transduction") are drawn and labelled but never count as convergence: the success highlight and the side panel's "where successes converge" ranking start one level below the top, because every chain ends at those hubs.
- Cross-links: panel d on the map gets "Show in mechanism graph" (focuses the trial's drug); the graph's side panel gets "Show these trials on the map" (sets the map's search/filter). My call: include both; they are cheap and make the two figures one story.
- Keyboard: the search box selects nodes; the side panel is the accessible view of the focused node. At 375px the side panel becomes a bottom sheet.

## 8. Testing and verification

- Pipeline: unit tests for the mapping loader (valid, missing, invalid files), override precedence, per-trial mechanism union, the new feature block and no-leakage, cluster naming rules on a synthetic set, graph build (nodes/edges/pruning/determinism), and the R19 degradations. Script tests run against recorded ChEMBL/Reactome fixtures. Web fixtures regenerated with `make_web_fixtures.py` using small committed mapping fixtures.
- Web: vitest for dropdown select all/none, year filter, theme persistence (including storage failure), popup content, colour modes, "too few to tell", graph focus/highlight logic (pure functions); Playwright at desktop and 375px for toolbar, popup, theme switch and the graph page.
- Gates (HANDOFF section 4) green before each phase is called done. Real-data check on the local preview for each phase, with screenshots.

## 9. Delivery

- **Stack (unchanged):** React 19 + TypeScript (strict) for every new UI piece, including the graph canvas; no UI kit or component library that would bring its own look.
- **Design bar (Martin, on approval):** this is a showcase; it must look premium and high-end, never "AI slop" (no generic dashboard cards, gradients, glows, emoji, default-looking controls). Every new UI piece (toolbar, dropdowns, popup, theme switch, success table, graph page) is designed inside `DESIGN.md`'s Figure Plate system, built with the Impeccable skill, and gets an Impeccable finish review plus real-data screenshots (light, dark, 375px) before its phase is called done. `DESIGN.md` is updated with each new pattern.

- Work continues on `feat/explorer-figure-plate` (still unpushed; Martin pushes), one phase at a time, each committed and verified before the next.
- Docs: README "coming next" updated as phases land (mechanism data and graph become real); Methods gains mechanism sources, licences, coverage and the weight choice; `DESIGN.md` gains the toolbar, popup, dropdown and graph patterns; HANDOFF updated at the end.

## 10. My calls (for Martin to check)
1. The map starts still; play button to spin (5.1).
2. Year filter on start year only; popup shows start–end (5.3).
3. Theme switch is site-wide, System / Light / Dark (5.4).
4. ChEMBL for drug → mechanism/target/modality; Reactome downloads as the pathway backbone (Martin chose Reactome + GO + curated for gaps) (6.1).
5. Exact name/synonym matching only, plus a hand-kept overrides file; no name-ending guesses (6.1).
6. Cluster labels replace disease labels by default, with a switch (6.3).
7. "Too few to tell" below 10 finished trials per group; no per-group p-values (6.5, 7.2).
8. Graph positions computed in the pipeline, seeded (7.1).
9. Cross-links between map and graph (7.2).
10. A short `mechanism_class` derived from target family + action type, reviewed by hand for top drugs (6.1).
11. Graph success colour uses the R18 pool; node size uses all drug-bearing trials (7.2).
12. Highlight follows drug → target → pathway → parent only; shared-gene links are context; top-level pathways never count as convergence (7.2).

## 11. Left to the builder
HDBSCAN parameters; the starting mechanism weight (decided with `cluster_report.py`); Jaccard floor and top-k; pathway pruning cap; force-layout algorithm and parameters; exact palettes within `DESIGN.md`; popup and dropdown styling; whether the manual mapping workflow is added in phase 2 or later.
