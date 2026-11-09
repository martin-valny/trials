# Stop-risk model ("Will this trial stop early?") — design

Status: approved by Martin, 2026-11-09. First of three linked pieces: **A** this model; **B** a target memo agent that cites it (separate spec); **C** a live Bedrock mode for B (separate spec, reopens the §5.2 "no AWS" ruling in HANDOFF).

## 1. Intent and why

Trial Radar today shows what exists; it never says *so what*. The reader set on 2026-11-08 is a pharma or biotech R&D / competitive-intelligence lead sizing up MS and MG targets. For each running drug trial in the area, this feature estimates the chance it ends **terminated or withdrawn** rather than completed, with the main factors and an uncertainty range, and shows how good the model is.

It serves two audiences at once (Martin, 2026-11-09: "ideally both"):
- the real reader gets a ranked watchlist of competitor trials that may be in trouble, and a health read on each target's live pipeline;
- the hiring panel (FDE role, AI prototyping in life sciences) sees a real ML model trained on the wider registry, tested on later years, calibrated, compared with a simple baseline, with leakage handled openly and an evaluation that runs in CI.

## 2. Goals, non-goals, anti-goals

**Goals**
- G1. A model trained on finished phase 1–3 drug and biologic trials from the **whole** ClinicalTrials.gov registry, applied to the area's running trials.
- G2. Per running trial: probability of stopping early, a range, the typical rate for comparable trials, and the top factors behind the score.
- G3. Three surfaces (Martin picked A, B, D from the mockups): a target-page panel, a Watchlist page, a Methods section on model quality.
- G4. An honest evaluation: time split, AUC, calibration, baseline comparison, in-area check; checked in CI against committed artefacts.
- G5. A one-line config switch that hides per-trial scores and keeps only target-level summaries.

**Non-goals**
- Predicting completion-date slips (needs record history we do not reliably have).
- Predicting whether the drug advances to the next phase or approval (needs drug identity across the whole registry; later upgrade).
- Point-in-time training from AACT archives (planned v2; see §4).
- The memo agent and anything LLM-based (pieces B and C).
- An overlay on the pipeline figure (mockup option C, not chosen).

**Anti-goals (would be a failure even if it works)**
- Test scores that look good because the model peeked at end-of-trial facts.
- Wording that reads as a verdict on a company ("likely to fail", "in trouble", red danger badges).
- A fancy model shipped when a simple baseline does as well.
- Naming or scoring people (investigators, contacts).
- The daily run calling anything new over the network or retraining.

## 3. Constraints

- $0 running cost, static site, no server, no secrets (PRODUCT.md). Training is a hand-run script; the daily run only applies a committed model.
- A new therapeutic area stays a config change only; nothing in source names a condition.
- Stack: Python pipeline (polars, scikit-learn already a dependency), React + TypeScript web, Figure Plate design system (DESIGN.md), premium finish bar. Real data is never committed; fixtures only.
- Honesty principles: name proxies, never claim unbuilt features, every view links to the CT.gov record.
- Legal and reputational framing agreed with Martin 2026-11-09: neutral wording always next to the typical rate; top factors shown; a standing note ("Statistical estimate from public registry data. Not a statement about any sponsor or trial. The model is often wrong; see Methods for accuracy."); no people; the per-trial switch (G5). Martin may check with Immunai before going public; the switch makes that cheap.

## 4. Approaches considered

1. **Same CT.gov API and the same normalization code (chosen).** A hand-run script pulls finished trials from the whole registry through the existing `ctgov` client and runs them through the existing `normalize` code, so training and live features are built by one code path. Cost: only each trial's *current* record is visible, so fields edited at the end of a trial must be excluded (§6.2); reported scores may still be slightly flattering. Chosen because it removes train/serve skew, needs no account, and ships soonest. The data source is a swappable part.
2. **AACT monthly archives (point-in-time).** Train on how each trial looked while running, which removes leakage properly and allows edit-history features. Needs an AACT account, multi-GB downloads, and a new loader on a different schema (skew risk); about 2–3x the work. Kept as v2; a before/after comparison would itself be a result.
3. **A published benchmark dataset.** Features and labels don't match our data, so it can't be applied cleanly, and the work wouldn't be ours. Dropped.

## 5. What Martin decided

- Build A then B (B uses A), then a Bedrock live mode for B. D (open Q&A) is dropped as a separate feature.
- Predict **stops early** (terminated or withdrawn vs completed), not slips or advancement.
- Data approach 1.
- Show **per-trial** scores publicly, with the framing in §3 and the switch.
- Surfaces: target-page panel (mockup A), Watchlist page (B), Methods evaluation (D). No pipeline-figure overlay.
- Sponsor track record is a feature and a shown factor (bare count wording); its aggregate table may be committed (§6.2).

## 6. The model

### 6.1 Training set (proposal; builder may tune the exact filter and must record it)
- Interventional; phase 1, 1/2, 2, 2/3, 3; at least one intervention of type DRUG or BIOLOGICAL.
- Status COMPLETED (label 0), TERMINATED (label 1). Excluded: WITHDRAWN, UNKNOWN, SUSPENDED, all running statuses. *(Claude's call after the builder check.)* Withdrawn trials never enrolled, so their records list few or no sites: keeping them would let site counts give the label away. SUSPENDED is ambiguous as an outcome and is left out here, although `explorer/outcomes.py` counts it as stopped for the success proxy; the two definitions serve different questions and Methods says so. The headline therefore reads "stops early after starting".
- Site and country counts stay as features, but the training script reports test AUC with and without them; if removing them drops AUC by more than 0.03, Methods names them as a possible leak (terminated trials may list fewer sites).
- Start date 2008 or later (earlier records are sparse and registration practice changed).
- Whole registry, no relevance filter. The existing client caps at 100 pages of 1,000; the pull must split the query (e.g. by start year) to get past it.
- The pulled raw studies are cached locally (git-ignored), not committed.

### 6.2 Features: only what is known at the start
Allowed (from normalized tables, raw study where needed):
- phase; allocation, masking, number of arms (design);
- planned design scale only where the record still states it as planned (see the enrollment rule below);
- sponsor class (industry, academic, other), whether there is more than one sponsor or collaborator;
- number of sites and of countries at the time of the record, region mix;
- number of primary and secondary outcomes;
- condition category (broad, e.g. via MeSH tree or a small mapping), number of conditions;
- intervention type mix, number of experimental interventions, placebo arm present;
- start year;
- **sponsor track record, time-aware**: the share of this sponsor's earlier trials (finished before this trial started) that stopped early, with a count; computed only from trials that ended before the start date. Martin, 2026-11-09: keep it. Live scoring reads a committed **aggregate** table (one row per normalized sponsor: earlier trials, stopped, as-of date; no trial records), an explicit exception to "never commit real data" limited to these counts. As a factor it is worded as a bare count, e.g. "Sponsor's earlier trials: 9 of 40 stopped early (registry)", never as a judgement; the per-trial switch hides it with everything else. Sponsors with fewer than 5 earlier trials get a neutral "few earlier trials" value rather than a noisy rate (builder may tune the floor).

Excluded because they are set or changed at the end of a trial: `why_stopped`, results posted, actual enrollment (`enrollment_type = ACTUAL`), actual completion dates and any duration derived from them, last-update dates, site recruitment statuses, overall status itself.

**Enrollment rule:** a finished trial's record carries actual enrollment, which is small exactly because the trial stopped. Enrollment is therefore excluded from v1. This is the single biggest cost of approach 1 and is named on Methods; v2 (AACT) restores planned enrollment.

### 6.3 Model, baseline, uncertainty
- Baseline: logistic regression on phase, sponsor class and start year.
- Candidate: scikit-learn `HistGradientBoostingClassifier` (no new dependency), calibrated (isotonic or Platt on a calibration fold).
- Ship the candidate only if its test AUC beats the baseline by a margin fixed before looking (proposal: 0.02) and calibration is no worse; otherwise ship the baseline and say so on Methods.
- Range per trial: a bootstrap ensemble (proposal: 20 refits); the range is the members' 10th–90th percentile spread placed around the shipped estimate p: lo = p − (median − q10), hi = p + (q90 − median), clipped to [0, 1] (Ruling 11).
- Factors per trial: the top three contributions to that trial's score, faithful to the shipped model (coefficients times values for logistic; TreeSHAP or an equivalent exact method for boosting; a new dependency such as `shap` is acceptable if needed). Each factor is turned into plain words by a small hand-kept label file. The words describe the trial's own value ("Sites planned: 112", "Phase 3 trial", "Registry files it under: Neoplasms"); the contribution's sign only sets raises/lowers (finish review, 2026-11-09).
- Typical rate: the observed stop rate in the training set for the same phase (and sponsor class if it differs materially), shown next to every score.

### 6.4 Evaluation
- Time split: train on trials started up to 2015; test on trials started 2016–2019 that have finished. Later start years are left out because their finished set is biased toward short, early-stopped trials; Methods says so.
- Metrics on the test set: AUC (baseline and shipped model), a calibration curve and Brier score, and the same for the in-area subset (neuroimmunology trials in the test set) with its small n stated.
- Compare against published registry-based termination models where Methods cites them (builder to find and verify one or two sources; never cite unverified).
- **CI evaluation**: the training script writes a model card (metrics, filter, feature list, versions, dates) and a small committed held-out feature table (test-set features and labels only, no free text). A pytest loads the committed model and table, recomputes the metrics and fails if they differ from the model card beyond rounding, or if the model file and card disagree on version. This catches silent drift from code or library changes without network access.

### 6.4a Which model ships *(Claude's call after the builder check)*
Two artefacts from one recipe: the **evaluation model** (trained on starts up to 2015) produces every number on Methods and is the one the CI check reloads; the **shipped model** is the same recipe refit on all finished trials up to the training date and scores live trials. The model card records both and Methods says the published accuracy is the recipe's accuracy on later years, measured on the earlier fit. Live trials started after the last training year get the last year's value for the start-year feature (clamped), stated in the card.

### 6.4b Library versions *(Claude's call)*
scikit-learn is pinned to a minor version in `pyproject.toml`; the loader accepts patch-level differences and fails (R19 warning, no `risk.json`) on a minor or major mismatch. The CI evaluation test catches any behavioural drift a patch bump causes.

### 6.5 Artefacts and pipeline
- `pipeline/scripts/train_stop_risk.py` (hand-run, needs network): pull, normalize, build features, train, evaluate, write artefacts.
- Committed under `config/risk/` (or a similar path, builder's call): model file, model card JSON, held-out table, factor label CSV, README (how to retrain, what is excluded and why).
- Model file format: whatever loads safely and reproducibly; scikit-learn version pinned in the card; loading a different version fails loudly.
- The daily run gains a `stop_risk` stage after normalization: it builds features for the area's running trials in scope, applies the model, and writes `risk.json` through `export`. Like the explorer stages (R19), a failure is a run warning, the site ships without `risk.json` and the pages say scores appear after the next update.
- Stage order *(Claude's call)*: `stop_risk` runs after `pipeline_figure` and reads its row assignment for the `targets` block. Per-trial scores do not depend on it: if the pipeline figure is missing, `risk.json` ships without `targets` and the target panel is absent anyway. Running trials not in any row still appear on the Watchlist with target "—" and a "No target row" filter value.
- Scope of scored trials: running (not yet recruiting, recruiting, enrolling by invitation, active not recruiting) phase 1–3 trials with a drug or biologic. Others are listed as "not scored" with the reason where they would otherwise appear.

### 6.6 `risk.json` (contract sketch)
- `model`: version, trained date, test AUC (model and baseline), in-area AUC and n, calibration points, Brier, which model shipped and why, feature list, exclusions, `per_trial` (bool from config).
- `trials`: per NCT, `drug` (the figure row's canonical name, in registry casing when it is just the registered name lower-cased; else the first experimental drug or biologic as registered), `p`, `lo`, `hi`, `typical`, `typical_basis` (e.g. "phase 3 drug trials"), `factors` (up to three: label, direction). When `per_trial` is false, this block is omitted. Running-status trials that are finished in all but status (active, not recruiting with an actual primary completion date in the past, or results posted) go to `not_scored` with the reason "primary completion reached" / "results posted".
- `targets`: per pipeline row (and per row × disease), counts of scored running trials, median `p` and the typical rate, so target-level summaries survive with the switch off.

## 7. Surfaces (web)

Design inside DESIGN.md's Figure Plate system; mockups in `.superpowers/brainstorm/` (risk-placement.html) are direction, not spec. Wording rules apply everywhere: "Estimated chance of stopping early", never "risk of failure"; the typical rate always beside the number; the standing note on each surface; every trial links to its CT.gov record and its trial page.

- **Target page, new panel "Running trials, estimated chance of stopping early"** (mockup A): one row per scored running trial (drug, phase, company), a 0–60% scale with the typical-rate tick and the range, the estimate in words and numbers, factors on demand. Respects the disease filter the page already carries. With the switch off: the target-level summary only.
- **Watchlist page** (new route, in the nav): all scored running trials ranked by estimate, columns trial, target and disease, estimate vs typical, main factors; filters by disease, company and target; sorts by estimate and by difference from typical. With the switch off: the page lists targets with their summaries instead of trials.
- **Methods, new section "How good is the stop-risk model?"**: what it predicts, training set and time split, the calibration chart, AUC table (baseline, shipped, in-area), what is excluded and why (enrollment named), the leakage caveat, the published comparison, how to read a score, and that the model is retrained by hand (date shown).
- Trial page: the estimate and factors for that trial, linking to Methods (small, consistent with the panel).

## 8. Config

`config/area.yaml` gains a `risk` block: `enabled`, `per_trial` (the switch, default true), and anything the builder needs for scope. Nothing in source names a condition.

## 9. Left to the builder

- Exact filters, feature encoding and the condition-category mapping, within §6.2's rule (start-time facts only) — record every choice in the model card and README.
- The baseline-beating margin if 0.02 proves unsuitable (must be fixed before reading the test result and recorded).
- Model file format and paths.
- Visual detail of the three surfaces inside the Figure Plate system, with the usual finish review and real-data screenshots (light, dark, 375px).
- How to split the registry pull to stay under the client's page cap.

## 10. Open for later
- v2: AACT point-in-time features (planned enrollment, edit history) and a before/after comparison.
- Advancement model (drug moves on) once drug identity is mapped beyond the area.
- Piece B (memo agent) consumes `risk.json`.
