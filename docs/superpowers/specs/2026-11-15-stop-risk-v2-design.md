# Stop-risk model v2 (AACT point-in-time) — design

Status: approved by Martin, 2026-11-15. Successor to `2026-11-09-stop-risk-model-design.md` (v1), which named this as approach 2 (§4) and as open work (§10).

## 1. Intent and why

v1 learns from each finished trial's **final** record, because the CT.gov API shows only the current version. Two costs follow, both named on Methods today:
- facts edited at the end of a trial can leak the outcome, so v1's published test AUC (0.682) may be flattering;
- enrollment had to be dropped entirely: a stopped trial's record shows its small *actual* enrollment.

v2 learns from **how each trial looked while it was still running**, read from AACT's monthly archives of the whole registry. That removes the end-of-trial leakage, brings back planned enrollment, and makes snapshot-time facts usable (status, age, overdue completion, time since last update). It also lets us measure, for the first time, how good v1 really is on running trials. The before/after comparison is itself a Methods result.

Readers are unchanged (v1 §1): the hiring panel (a real point-in-time ML evaluation, leakage handled properly) and the CI/clinical-ops reader (a better-calibrated estimate on the Watchlist and target pages).

## 2. Goals, non-goals, anti-goals

**Goals**
- G1. A model trained on point-in-time records (AACT snapshots), same prediction target as v1, that replaces v1 on the site if it clears the bar fixed in §7 before any test result is read.
- G2. A fair before/after on Methods: v1 and v2 scored on the **same held-out running trials, from the same snapshot records** (Martin, 2026-11-15: option A).
- G3. Train/serve consistency: every shipped feature has an identical live equivalent computed by the daily run from the CT.gov API, checked by a parity test.
- G4. Edit-history features (date slips, enrollment cuts, status changes) measured as a research result on Methods.
- G5. AACT/CTTI and ClinicalTrials.gov terms checked and recorded before anything derived is committed (§10).

**Non-goals**
- Shipping edit-history features (the live run cannot see a record's history; §6.3).
- A survival / time-to-stop model using censored running trials (later; changes the meaning of the number on every surface).
- Changing what is predicted, the surfaces, or the wording rules. Surface changes are limited to Methods copy, the new factor labels and the credit line.
- Pre-2018 point-in-time data (no AACT archive is available before 2018-12 in our source).

**Anti-goals**
- A before/after that flatters v2 by comparing numbers from different tests.
- Reading test results before the shipping bar, split and eval sets are frozen (this document freezes them).
- Committing raw AACT data, or any table with NCT ids beyond what v1 already commits.
- Any change to the daily run beyond scoring with the new model and computing the new features from fields it already fetches.
- Any running cost, AWS call, or a daily-run network call that v1 does not already make.

## 3. Constraints

- $0, free data only. AACT archives through the existing account (credentials file read at runtime only; never printed, copied or committed; it is registered to Martin's personal address).
- Reuse the data already downloaded in `~/Desktop/event-signal-backtest/data/raw/aact/` (83 monthly `studies` extracts, 2018-12 to 2026-01; 2021-07, 2021-08, 2022-08 missing). Port the range reader (`history.py`: `_RangeFile`, signed URL, `monthly_archives`) into this repo; never import across repos.
- Storage: `pipeline/.cache/aact/` only (git-ignored). Raw table extracts are deleted once the compact panel is built.
- Committed artefacts as in v1: model file, card, held-out feature table (no NCT ids, no text), sponsor aggregate, factor labels, README.
- Same honesty rules as v1: features known at the snapshot date only, a leakage section, neutral wording, the `per_trial` switch.
- Pushing is via git bundle (HANDOFF §00). Branch `feat/stop-risk-v2` off `origin/main`.
- Time box: about 4 model-work days; past that, stop and ask Martin.

## 4. Approaches considered

**How training and test rows are built (Martin picked 1, 2026-11-15):**
1. **Cutoff date (chosen).** Treat one snapshot as "training day". Train on trials that had ended by then, one row per quarterly snapshot while each was running (weighted so every trial counts once); test on every trial running at the cutoff, as it looked that day, with the outcome read years later. Mirrors what the site does daily: learn from finished trials, score running ones. Cost: a smaller training set than v1, and trials that ended before 2018-12 contribute nothing.
2. **One row per trial at first sighting.** Simpler, but a trial first seen in 2018-12 may be six years old while a new one is seen in month one, so age and outcome get tangled. Dropped.
3. **Survival model including still-running trials.** More data and no start-year clamp, but the number becomes "chance of stopping within N years", touching every surface. Deferred.

**Data source for the extra tables:** the studies extracts already on disk lack interventions, sites, arms, outcomes, conditions, sponsors and design. Pull them with the ported range reader at **quarterly** snapshots (Claude's call: v1's features change slowly; monthly would multiply download time ~3x for little gain; the studies table stays monthly because it is already on disk and carries the fast-moving fields).

**Before/after (Martin picked A, 2026-11-15):** both models on the same test rows from the same snapshot records. The alternative (v1's published 0.682 next to v2's new number) mixes model quality with leakage. Dropped.

## 5. Data

### 5.1 Snapshots and tables
- **Monthly** (already on disk): `studies` (nct_id, last_update_posted_date, primary_completion_date, study_type, overall_status, phase, enrollment, enrollment_type). The pull also re-extracts `studies` at the quarterly dates with the extra columns the features need (start_date and its type, primary completion date type, source/sponsor class if present).
- **Quarterly** (pulled): `studies` (full, including `results_first_posted_date` and `primary_completion_date_type`), `interventions`, `facilities`, `design_groups`, `design_outcomes`, `conditions`, `browse_conditions` (MeSH terms and ancestors, for v1's condition categories), `sponsors`, `designs`. Quarter dates: the archive nearest to the first of Mar, Jun, Sep, Dec, from 2018-12 to 2025-12, plus 2026-01 (the outcome snapshot). About 30 archives × 9 tables.
- **Compact panel**: one Parquet per table type under `pipeline/.cache/aact/panel/`, rows keyed by (snapshot_date, nct_id), filtered to trials that ever pass the scope filter (§5.2), only the columns the features read. Raw extracts are deleted after each archive is folded in, so peak disk is one archive's tables.

### 5.2 Scope filter (same as v1, applied as of each snapshot)
Interventional; phase 1, 1/2, 2, 2/3, 3; at least one DRUG or BIOLOGICAL intervention; running status at that snapshot (not yet recruiting, recruiting, enrolling by invitation, active not recruiting). v1's start-date floor (2008) is dropped: a trial running in 2018 or later is in scope whatever its start year.

**Finished in all but status** is out of scope at that snapshot, exactly as the daily run leaves it unscored (`risk/apply.py` `_finished_reason`): results posted by the snapshot date, or active not recruiting with an ACTUAL primary completion date before the snapshot date. *(Claude's call after the builder check: otherwise the test set would include easy cases the site never scores and inflate both models' AUC.)* This needs `results_first_posted_date` (or equivalent) from the quarterly full `studies` pull, and `primary_completion_date_type`; both are added to §5.1's column list.

### 5.3 Label
Final status in the **2026-01** snapshot: TERMINATED → 1, COMPLETED → 0. Excluded and counted: WITHDRAWN, SUSPENDED, UNKNOWN, still running, and records missing from 2026-01. Same definition as v1 ("stops early after starting"), so the before/after compares like with like. *(Claude's call: keeping WITHDRAWN out keeps the definition identical to v1; point-in-time data would allow including it, which is a later decision because it changes the headline.)*

### 5.4 Normalization: one code path
An AACT adapter maps each snapshot's AACT rows into the **same `Tables` and `RiskFields`** that `normalize` produces from the CT.gov API (enum values such as "Phase 1/Phase 2" → `PHASE1, PHASE2`, "Industry" → `INDUSTRY`, "Placebo Comparator" → `PLACEBO_COMPARATOR`, browse_conditions mesh-list/mesh-ancestor → the condition-browse terms v1 reads). `risk/features.build` is then reused unchanged for v1 features; v2 features are added beside it. A mapping table for every enum lives in the adapter with a test per value seen in the archives; an unmapped value fails the build loudly.

## 6. Features

### 6.1 Kept from v1
All v1 features (card.json `features`), computed as of the snapshot, **except `start_year`** (Claude's call: trial age replaces it, and dropping it removes v1's 2019 clamp; start year can be re-added if the builder finds it adds over age, decided on the training folds only). Site and country counts are now legitimate (as listed at the snapshot), and the sponsor track record is counted as of the snapshot date (trials of the same sponsor that ended before it, from AACT history plus v1's registry pull for pre-2018 endings; builder's call on the exact source, recorded in the card).

### 6.2 New, point-in-time, live-computable (shippable)
Each uses only fields the daily run already fetches, evaluated at "as-of" = snapshot date (training) or run date (live):
- `planned_enrollment` (log-scaled) and `enrollment_anticipated` (1 when the type is ESTIMATED/ANTICIPATED). Actual enrollment while running is allowed: it is what the record says at that moment.
- `status_*`: one-hot of the running status at as-of.
- `age_months`: as-of minus start date (missing start → missing).
- `planned_duration_months`: primary completion date minus start, as stated at as-of.
- `pcd_overdue_months`: as-of minus primary completion date when that date has passed and the trial is still running (else 0).
- `months_since_update`: as-of minus last update posted date.

### 6.3 Edit-history (research only, not shipped)
From the monthly studies extracts up to as-of: number of primary-completion slips and total months slipped, enrollment cuts (planned enrollment reduced by ≥ 20%), status regressions (e.g. recruiting → not yet recruiting), measured over the preceding 12 months (builder may tune the window on training folds only). Reported on Methods as "what history would add" (AUC/Brier with and without), not shipped.

Why not shipped: the daily run sees only the current record. The data branch is force-pushed as one commit and its own history began 2026-11-05 with a hash per trial, not values; the official CT.gov v2 API has no history endpoint. A future option (recorded in §12): have the daily run keep per-trial values of the four tracked fields from now on, so history features become servable in a year or two.

### 6.4 Train/serve parity test
A hand-run script (`--parity`) takes trials running in the 2026-01 snapshot whose `last_update_posted_date` is before that snapshot's date and unchanged in today's live record, builds their features from AACT and from the live CT.gov API (through the daily run's code), and compares. Shippable features must match exactly, except as-of-relative features, which are compared with as-of set to the same date. Mismatch rate and any differing feature are written to the card; a mismatch above 1% of trials on any feature blocks shipping until fixed.

Exempt: the three sponsor features. Live scoring reads the committed `sponsor_history.csv` (counts as of training day), training counts as of each snapshot; this is v1's documented, deliberate train/serve difference (config/risk/README.md) and stays so. The parity test reports their mismatch rate for information only.

## 7. Evaluation (frozen here, before any test result is read)

### 7.1 Split
- **Cutoff C = the 2021-12-01 snapshot.**
- **Training set**: trials in scope at any quarterly snapshot before C whose final label (2026-01) is known *and* which had ended (completed or terminated) by C. One row per (trial, quarterly snapshot ≤ C while in scope); weight 1/k for a trial with k rows. Labels are read from the 2026-01 snapshot but, for these trials, are already settled by C, so the training set contains nothing a trainer at C could not have known.
- **Test set**: trials in scope at C, one row each, features as of C, label from 2026-01. Excluded and counted on Methods: still running, unknown, withdrawn, suspended. Rough size from the studies extracts (before the drug/biologic filter): 30,399 running at C; 11,898 completed and 3,161 terminated by 2026-01.
- **Disjointness**: no trial is in both (training trials ended before C; test trials were running at C).
- **Known bias, accepted and measured** *(Claude's call after the builder check)*: trials that ended by C, observed from 2018-12, over-represent quick endings; young trials (started 2020–21) that ended by C are mostly early stops. This is the same "recent start means stopped" effect v1 handled with its 2019 refit cut, here entering through age, planned duration and overdue completion. It is not patched, because every patch (minimum start date, first-seen-near-start rule) either uses information a trainer at C lacks or discards most long trials. The test set is unaffected by it (all trials running at C), so any harm shows up in the test AUC and Brier of both v2 and v1-recipe, which train on the same trials. The card reports the training set's start-year and age mix and a calibration curve by age band; Methods names the bias in one sentence. The shipped refit (window to 2026-01) has less of it than the C-recipe, so published accuracy is, if anything, conservative.
- **Shipped model**: the same recipe refit on all trials ended by 2026-01 with their snapshot rows. The card states that published accuracy is the recipe's accuracy at C.

### 7.2 Models compared on the test set
- **v2-baseline**: logistic regression on phase, sponsor class and age.
- **v2**: `HistGradientBoostingClassifier`, isotonic calibration from shuffled 5-fold out-of-fold scores, 20 bootstrap refits for ranges (as v1).
- **v1-recipe (primary "before")**: v1's exact features and code, trained on the **same training trials** fed their **final records** as a v1 trainer at C would have seen them (the last snapshot at or before C; never a later one, which would carry post-C edits that v2 does not get), then applied to the test rows' snapshot records. This is the like-for-like comparison: same trials, same test inputs, only the data and features differ.
- **v1-committed (secondary)**: the shipped v1 model applied to test rows for trials it never trained on (starts 2020 or later). Reported only.
- **v2 + history (research)**: v2 plus §6.3 features.
- Also reported: in-area subset (as v1), v2 without site features.

### 7.3 Shipping bar
- Within v2: boosted ships over v2-baseline only if test AUC ≥ baseline + 0.02 and Brier no worse (v1 rule).
- **v2 replaces v1** only if the v2 model chosen above has test AUC ≥ v1-recipe AUC + 0.02 **and** Brier no worse than v1-recipe, both on the §7.1 test set; and the parity test passes (§6.4). Otherwise v1 stays live and Methods reports the comparison as measured.
- The bar uses each ensemble's main fit, as v1 does.

### 7.4 CI check
As v1: the card holds every number; a pytest reloads the committed model and held-out table and recomputes the shipped model's and the in-area metrics. The held-out table is the §7.1 test rows (features and label only, no NCT ids).

## 8. Pipeline and artefacts

- `pipeline/src/trialradar/aact/` — ported range reader (signed URL, HTTP range file, single-table extract), archive listing, credential read at runtime from a path given on the command line (default the event-signal-backtest location), AACT→`Tables` adapter.
- `pipeline/scripts/build_aact_panel.py` — hand-run, resumable per archive; writes the compact panel; deletes raw extracts.
- `pipeline/scripts/train_stop_risk_v2.py` — hand-run, offline from the panel: builds rows, trains, evaluates every model in §7.2, applies the bar, writes artefacts. `--parity` runs §6.4 (network: CT.gov API only).
- Committed (in `config/risk/`, replacing v1's only if v2 ships; otherwise v2's card is committed as `card-v2.json` for the Methods comparison): `model.joblib`, `card.json` (now with a `comparison` block: v1-recipe, v1-committed, v2-baseline, v2, v2+history, test counts and exclusions, parity result, data source and terms), `heldout.parquet`, `sponsor_history.csv`, `factor_labels.csv` (new rows for §6.2 features), README.
- Typical stop rates (shown beside every estimate) are recomputed from the shipped refit's population, each trial weighted once, by phase (and sponsor class where it differs materially), following v1's rule that typical rates come from the shipped model's trials. *(Claude's call after the builder check.)* The numbers beside estimates will therefore change if v2 ships; the card records old and new (new in `typical`, v1's in `filter.typical_v1`, read from the `--v1-dir` card). A parity run's sibling `<stem>.meta.json` is copied into `filter.parity_meta`.
- Daily run: the `stop_risk` stage computes §6.2 features from the current record with as-of = run date, then scores as before. No new network calls; `risk.json` contract unchanged except new factor labels and model metadata.
- Factor wording for new features, describing the trial's own value: "Planned enrollment: 120", "Recruiting", "Started 31 months ago" (true for every status, so never "running"), "Primary completion date passed 6 months ago", "Last registry update: 14 months ago". Neutral, never "delayed" or "stale".

## 9. Methods (web)

The "How good is the stop-risk model?" section gains:
- the before/after table (§7.2 rows, same test set), with one plain sentence on why v1's previously published 0.682 was higher (measured on final records);
- what is now included (planned enrollment, status, age, overdue completion, time since update) and what history would add but is not used, and why;
- the split in words (trained on trials that had ended by December 2021, tested on the ones running then);
- the credit line (§10) with the snapshot range and processing date.
Copy follows v1's wording rules. Visual changes stay within the existing Figure Plate section.

## 10. Terms of use (checked 2026-11-15)

- **AACT** (https://aact.ctti-clinicaltrials.org/): no terms, licence or citation page found; the sign-up form shows no terms. Footer: "© 2026 Clinical Trials Transformation Initiative · A project of CTTI. Data derived from ClinicalTrials.gov."
- **CTTI citation policy** (https://ctti-clinicaltrials.org/?p=7671): acknowledge the "Clinical Trials Transformation Initiative" as the source and link to it.
- **ClinicalTrials.gov terms** (https://clinicaltrials.gov/about-site/terms-conditions, last updated 2023-01-31; text confirmed by Martin in a browser, 2026-11-15). Data are available to all at no charge. In any publication or distribution of the data you should: attribute the source as ClinicalTrials.gov; keep the data current; clearly display the date the data were processed by ClinicalTrials.gov; state any modifications made, with a complete description. You shall not assert proprietary rights or represent it as other than a U.S. Government database; no use of extracted email addresses for marketing. Some data may carry third-party copyright. The terms apply while any of the data is retained.
- How v2 meets them: Methods, the card and the README credit ClinicalTrials.gov (and AACT/CTTI); they show the snapshot range (2018-12 to 2026-01) and the training date; the README and Methods describe how the committed artefacts were derived (the model, a numeric held-out table without ids, per-sponsor counts are modifications, described in full there); the live site stays current through the daily run; no email addresses are read or used; no proprietary claim is made on the data (the repo licence covers code, not registry data, and the README says so).
- Conclusion: nothing found forbids committing a model, a numeric held-out table without ids, or per-sponsor counts derived from AACT. The plan credits AACT/CTTI and ClinicalTrials.gov (README, card, Methods) and states the snapshot dates. Raw AACT data is never committed or redistributed. This section is copied into `config/risk/README.md`.

## 11. Left to the builder
- Exact enum mappings in the adapter (tested, §5.4), quarter-date selection rule, panel layout.
- Feature encodings and the edit-history window, decided on training folds only.
- Whether start year adds over age (training folds only).
- Sponsor track-record source for pre-2018 endings.
- Factor label wording within §8's rule.

## 12. Open for later
- Daily run keeps per-trial values of tracked fields so history features become servable.
- Survival / time-to-stop model with censored running trials.
- Including WITHDRAWN in the label (changes the headline).
- Later cutoffs as more years of outcomes arrive (re-freeze before reading).
