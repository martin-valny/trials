# Mechanism × disease scorecard — design

Status: approved by Martin · 2026-11-06. **Amended 2026-11-08: largely superseded by `2026-11-08-front-door-pipeline-design.md` §13.** The landscape grid becomes the pipeline figure's "By disease" arrangement; the separate `/scorecard` page and raw-class rows are dropped; approvals per disease move to a round 2; Open Targets genetics is dropped; stop reasons use the shared `config/stop_reasons.csv`. R21 (§5.4, built) stands. Do not execute the old plan's Tasks 2+. Builds on `2026-11-06-mechanisms-and-graph-design.md` (the "mechanisms spec"): it needs that spec's phase 2 mapping (`config/mechanisms/*`, per-trial `mechanisms`/`targets`/`modalities`). Research behind it: `docs/superpowers/research/2026-11-06-insight-ideas.md`. Visual rules: `DESIGN.md`.

## 1. Intent

A pharma scientist deciding **which mechanism to back in which disease** ("is FcRn worth taking into CIDP?", "is anti-CD20 crowded in NMOSD?") wants the clinical track record of a mechanism × disease pair, condensed into something they can defend in a portfolio meeting. A registry search gives them trials one drug name at a time; the scorecard gives them the mechanism's story per disease, with the biology next to it and the empty cells (never tried here) visible.

Martin's framing: a tool useful in the field first; the hiring-panel showcase follows from that. It is standalone (not an input to any internal target-ranking pipeline).

## 2. Goals, non-goals, anti-goals

**Goals**
1. A landscape grid: mechanism classes × diseases, each cell showing trial count and how the trials ended; empty and near-empty cells visibly distinct.
2. A cell detail view per mechanism × disease: phases reached, approval for that disease, outcomes, sorted reasons for stopping, success rate (only when n is big enough), current crowding, genetic support, the same mechanism in neighbouring diseases, and links to every trial behind every number.
3. Everything computed in the pipeline from data it already has plus committed reference files; the daily run never depends on an outside service.

**Non-goals (this phase)**
- Early warnings about running trials (needs record history; later phase, section 9).
- Cell-type expression of targets (CELLxGENE) — first addition after this phase.
- Any predictive score, ranking of mechanisms by "promise", or per-cell significance test.
- Diseases outside the configured area.

**Anti-goals (failure even if it works)**
- A black-box number. Every figure clicks through to the trials it counts.
- Reading "no results posted" as failure, or showing a rate from a handful of trials.
- A guessed mechanism, approval or genetic score. Unknown stays unknown and says so.
- Disagreeing with the Explore map: same success pool (R18), same mechanism classes, same disease labels.
- Generic dashboard look (premium design bar: Figure Plate system, no cards/gradients/glows).

## 3. Constraints

As the mechanisms spec section 3: $0, no server, no secrets; Python 3.12/uv/polars/strict mypy; React 19 + TypeScript strict, no UI kit; tests offline (recorded fixtures for scripts, small committed reference fixtures for pipeline and web); new area = config only; never commit real trial data (reference files about drugs/targets are fine); R19: scorecard failures never fail the daily run.

Licences: ChEMBL CC BY-SA 3.0, Open Targets CC0. Credited on the scorecard page and Methods.

## 4. Approaches considered

| | Approach | Trade-off |
|---|---|---|
| 1 (chosen for this phase) | Scorecard from the current registry state + committed reference files (mechanism mapping, ChEMBL indications, Open Targets scores). | Buildable now, fully reviewable, no history needed. Says nothing about where running trials are heading. |
| 2 (chosen as the later phase) | Backfill record history (AACT monthly archives, or ClinicalTrials.gov history if permitted access returns) and add early-warning signals. | Most novel; blocked today: CT.gov's history endpoint refuses scripts and the cthist package has been broken since 2026-09-26; AACT archives need an account, are ~2.3 GB per copy and monthly before 2023. |
| 3 | Widen the area to all immunology first, for bigger n. | Fixes small groups but dilutes the neuroimmunology focus; it is a config change available any time. |

Martin chose: scorecard as phase 1, history-based warnings later. Order on the branch: map usability (in progress) → mechanism mapping → mechanism graph → **scorecard** → early warnings.

## 5. Data

### 5.1 Reference files (committed, built by hand-run scripts, never by `daily.yml`)
Extends `config/mechanisms/` from the mechanisms spec:
- **`indications.csv`** — `mechanism_class, disease_label, drug, chembl_id, max_phase_for_indication, in_trials, source`. **Broad meaning (Martin's choice):** "approved for this disease" means *any* drug sharing the mechanism class is approved for it, whether or not Trial Radar tracks a trial of that drug. Built by a new step in the phase 2 mapping script: for every mapped target, ChEMBL `mechanism` → all molecules acting on that target with the same action type → their `drug_indication` rows; indications (MeSH/EFO) are mapped to disease labels by the area's condition terms; each such drug is given the mechanism class of the target + action type (same derivation as `drugs.csv`, overrides win). `in_trials` says whether we track a trial of it. `max_phase_for_indication = 4` = approved by any regulator per ChEMBL; Methods says so. Hand rows go in `overrides.csv`.
- **`genetics.csv`** — `target, disease_label, ot_score, ot_genetic_score, release`. Open Targets Platform association scores (overall and the genetic-association datatype) for each mapped target × each area disease (EFO ids listed in `config/area.yaml` under a new `scorecard.efo` block). Built by a new script `pipeline/scripts/fetch_genetics.py` (Open Targets GraphQL or Parquet download; recorded fixtures for tests). Missing pair = no evidence recorded, shown as "none recorded", not zero.
- `README.md` in `config/mechanisms/` gains source, release/date and licence for both.

### 5.2 Stop-reason categories
The registry's own `why_stopped` text (already in the store) sorted by keyword rules in `config/stop_reasons.yaml` into `enrollment`, `efficacy`, `safety`, `business`, `covid`, `other`, `not given`. First matching category wins; rule order is in the file. A unit test pins examples per category. No AI classifier. The Methods page lists the rules.

### 5.3 Pipeline
A new stage `scorecard` after `explorer` (it reuses the explorer's per-trial mechanisms, disease labels and R18 pool). Output `scorecard.json`:

```
{ generated_for, min_group,
  diseases: [label], mechanisms: [class],
  cells: [{ mechanism, disease,
            n_trials, n_drugs, n_sponsors,
            phases: {early1, p1, p2, p3, p4, na},        # furthest phase per trial
            outcomes: {completed_results, completed_no_results, terminated, withdrawn, suspended, running, unknown},
            stop_reasons: {enrollment, efficacy, safety, business, covid, other, not_given},
            pool_finished, pool_succeeded, success_rate|null,   # null when pool_finished < min_group
            running_now, started_last_2y,
            approved_drugs: [drug], max_phase_for_disease,
            genetics: {targets: [{target, ot_score, ot_genetic_score}|null]},
            trials: [nct_id] }] }
```
- A trial with several mechanisms or labels counts in every cell it touches (as the mechanisms spec decided); the page says so.
- Empty cells are not written; the web treats a missing cell as zero.
- `success_rate` uses the R18 pool with a **disease-specific success definition** (5.4); `min_group` comes from the config (default 10, added by the mechanisms spec's phase 2).
- Filters on the page (modality, "running only") change **only the grid counts**; the detail panel always shows the whole cell and says so. So `scorecard.json` additionally carries per-cell counts split by modality and a `running` count; no aggregation happens in the browser.
- **Unmapped trials stay visible:** trials whose drugs have no mechanism mapping form an `unmapped drugs` row (written as `mechanism: "__unmapped__"`), and the top of the page shows coverage ("mapped: N% of drug-bearing trials"). Drug-free trials are not on the scorecard; the page says so.

### 5.4 Success is disease-specific (Martin's choice; changes the Explore map too)
Today (`explorer/outcomes.py`, `_label`) a completed trial counts as `succeeded` if any of its drugs later reached a higher phase in **any** disease of the area. On a per-disease view that leaks success across diseases (a CIDP Phase 2 counts as a CIDP success because the drug went to Phase 3 in MG), which would make "worked next door" partly measure itself.

New rule, used **everywhere** (Explore map panels, `by_condition`, the neighbourhood statistic, the mechanism graph colours and the scorecard): a completed trial succeeded if one of its drugs later reached a higher phase **in a trial sharing at least one of its disease labels**. A trial with several labels succeeds if the progression happened in any of them; in the scorecard it counts as succeeded in the cells of the labels where the progression happened and as `completed_unknown` in its other labels' cells.

Consequences: the map's headline numbers (pool 478, 66 succeeded, p = 0.058 on the 2026-11-05 snapshot) change and must be re-measured; HANDOFF's dated result, README and Methods are updated; this is a new ruling (R21) that supersedes R18's success definition (the pool definition is unchanged). This change touches Explore code that the parallel session is finishing (map usability); it lands as its own task after that work merges, before the scorecard stage, and the other session is told.
- R19: any failure → `scorecard: <Exc>` run warning, no `scorecard.json`, stale file removed, the page says it appears after the next update.

## 6. What the visitor sees (`/scorecard`, nav entry "Scorecard")

Figure 3 in the Figure Plate system.

**a — Landscape grid.** Rows = mechanism classes (sorted by trial count; the long tail collapsed under "other mechanisms" with an expand), columns = disease labels. Each cell: trial count plus a small stacked mark of outcomes (ink for finished, outline for running, red only for succeeded — R15). Empty cells are a quiet dot so "never tried here" reads at a glance. Filter by modality; toggle "count all trials / running only". Keyboard: the grid is a table; cells are buttons.

```
                     MS        MG       NMOSD     MOGAD    CIDP
anti-CD20         ●●●● 41   ●  3     ●● 9       ·  1     ·  0
FcRn blocker      ·   0     ●●● 18   ·  2       ·  2     ●  6
```
(illustrative numbers)

**b — Cell detail** (side panel; bottom sheet at 375px), for the selected mechanism × disease:
```
FcRn blocker × CIDP                         6 trials · 3 drugs · 4 sponsors
How far it got   Ph2 3 · Ph3 2 · approved for this disease: no
How they ended   completed + results 2 · terminated 1 · running 3
Why stopped      enrollment 1   (the trial's own stated reason)
Success rate     too few to tell (2 finished; needs ≥10)
Right now        3 running · 2 started in the last 2 years
Genetics         FCGRT × CIDP: no genetic association recorded (Open Targets)
Same mechanism   MG 18 trials, approved · NMOSD 2, running
elsewhere
Trials           NCT… (each opens /trial/:nct)
```
(illustrative)

- Every count is a link that lists its trials.
- "Same mechanism elsewhere" is the row of the grid for the other diseases, so "worked next door, early here" is visible without a model.
- Cross-links: "Show on the map" (sets the Explore filter to these trials) and "Show in the mechanism graph" (focuses the mechanism) when the graph exists.
- Methods page gains: how cells are counted (multi-mechanism trials), the R18 pool, stop-reason rules, sources and licences, and what the scorecard cannot say (no forecasts; registry completeness).

## 7. Testing and verification

- Pipeline: unit tests for cell aggregation on a synthetic set (multi-mechanism trials, empty cells, min_group threshold, R18 pool agreement with the explorer stats), stop-reason rules, indications/genetics loaders (valid, missing, invalid → warning), R19 degradation; script tests on recorded ChEMBL/Open Targets fixtures; web fixtures regenerated with `make_web_fixtures.py`.
- A consistency test: for single-mechanism, single-label trials (the unmapped row included), the sum over a disease's cells of `pool_finished` and `pool_succeeded` equals the explorer's `by_condition` counts for that disease.
- Disease-specific success: unit tests for progression in the same label (succeeded), only in another label (not), multi-label trials, and the withdrawn/late-rank exclusions that exist today.
- Web: vitest for grid sorting/collapse, "too few to tell", missing-cell-as-zero, panel content; Playwright desktop + 375px for grid, panel, links.
- Gates (HANDOFF section 4) green; real-data screenshots light, dark, 375px; Impeccable finish review.

## 8. My calls (for Martin to check)
1. Diseases = the existing condition labels; mechanisms = the mechanisms spec's `mechanism_class`.
2. Success rate = the R18 pool with disease-specific success (Martin's choice, 5.4, also applied to the map), hidden below `min_group` (10).
3. "Approved for this disease" = any drug of the mechanism class, ChEMBL max phase 4 for that indication, any regulator (Martin chose the broad meaning; source named on the page).
3a. Page filters change the grid only; the panel shows the whole cell.
3b. Unmapped-drug trials get their own row plus a coverage line; drug-free trials are left out and the page says so.
4. Stop reasons by reviewable keyword rules, not AI.
5. Genetics from Open Targets (overall + genetic datatype), shown per target; no combined "genetic score" per cell.
6. Cell-type expression (CELLxGENE) deferred to the next addition.
7. "Started in the last 2 years" as the crowding signal (no forecast).
8. The scorecard comes after the mechanism graph on the branch.

## 9. Later phase: early warnings (not designed here)
Signals from record history: text drift between versions, "zombie" trials (improbable silence), date-slip forecasts, time-to-termination with competing risks, competitor contagion. Source options, in order: AACT monthly/daily archives (needs a free account; check earliest copy and terms), ClinicalTrials.gov history if permitted access returns (contact NLM; watch cthist), Trial Radar's own daily log (from 2026-11-05). Brainstormed separately once the scorecard ships.

## 10. Left to the builder
Grid sorting details and the long-tail cut; outcome mark design within `DESIGN.md`; exact stop-reason keywords (with the test examples); Open Targets access route (GraphQL vs Parquet); how the ChEMBL indication terms map to labels beyond the area's condition terms.

## 11. Amendment (2026-11-08)

See `2026-11-08-front-door-pipeline-design.md` §13. Kept: R21 (§5.4), the anti-goals, the ChEMBL indications source (§5.1, re-keyed by pipeline row) for round 2. Superseded: §5.2 file location and categories (shared `config/stop_reasons.csv`), §5.3 `scorecard.json`, §6 page, genetics (§5.1 `genetics.csv`, dropped).
