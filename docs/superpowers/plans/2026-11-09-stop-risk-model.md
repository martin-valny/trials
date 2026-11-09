# Stop-Risk Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Estimate, for each running drug trial in the area, the chance it is terminated rather than completed, and show it on a target-page panel, a Watchlist page, the trial page and a Methods evaluation section.

**Architecture:** A new package `trialradar.risk` holds features, sponsor history, model fitting, explanation, evaluation and artefact I/O. A hand-run script (`pipeline/scripts/train_stop_risk.py`) pulls finished trials from the whole registry through the existing `CtGovClient` and `normalize`, trains, evaluates on a time split and writes committed artefacts to `config/risk/`. The daily run gains an optional `stop_risk` stage (R19: failure is a warning) that scores running trials and exports `risk.json`; the web reads it.

**Tech Stack:** Python 3 / polars / scikit-learn 1.9 / shap (new) / joblib; React 19 + TypeScript + Vite; vitest; Playwright.

**Spec:** `docs/superpowers/specs/2026-11-09-stop-risk-model-design.md` (approved 2026-11-09). Read it before any task.

## Global Constraints

- Label: `TERMINATED` = 1, `COMPLETED` = 0. Training excludes WITHDRAWN, UNKNOWN, SUSPENDED and running statuses.
- Training scope: interventional; phases PHASE1, PHASE2, PHASE3 (combined phases such as PHASE1/PHASE2 included, EARLY_PHASE1 excluded); at least one DRUG or BIOLOGICAL intervention; start date ≥ 2008-01-01.
- Features use only start-time facts. Never: `why_stopped`, `has_results`, enrollment (any type), actual completion dates or durations from them, `last_update_post_date`, site recruitment status, `overall_status`.
- Split: evaluation model trained on starts ≤ 2015-12-31; test on starts 2016-01-01..2019-12-31. Shipped model: same recipe refit on all labelled trials. Start year for live trials is clamped to the last training year.
- Candidate ships only if test AUC ≥ baseline AUC + 0.02 and Brier ≤ baseline Brier; else the baseline ships. Methods says which and why.
- Range: 20 bootstrap refits, 10th–90th percentile. Factors: top 3 contributions of the shipped model.
- Sponsor floor: fewer than 5 earlier finished trials → `sponsor_few_prior = 1`, rate imputed as the training mean.
- Site ablation: report test AUC without site/country features; if the drop exceeds 0.03, Methods names them as a possible leak.
- Copy (verbatim where quoted): panel heading "Running trials, estimated chance of stopping early"; standing note "Statistical estimate from public registry data. Not a statement about any sponsor or trial. The model is often wrong; see Methods for accuracy."; sponsor factor "Sponsor's earlier trials: {k} of {n} stopped early (registry)". Never "risk of failure", "likely to fail", "in trouble"; no red danger badges. The typical rate always sits beside an estimate.
- No people (investigators, contacts) are scored or named.
- `config/area.yaml` `risk.per_trial: false` omits `risk.json.trials`; every surface then shows target-level summaries only.
- Nothing under `pipeline/src` or `web/src` names a condition (existing test).
- scikit-learn pinned `>=1.9,<1.10`; the loader rejects a model whose card's sklearn minor version differs from the installed one.
- Real registry data is never committed, except `config/risk/sponsor_history.csv` (one row per sponsor, counts only) and `config/risk/heldout.parquet` (test-set features and labels, no free text, no NCT titles).
- Daily run makes no new network calls and never retrains.
- Never push; never use the Workflow tool. Sonnet implementer + Sonnet reviewer per task, Opus final whole-branch review. Do not touch port 4173.
- Web work stays inside DESIGN.md's Figure Plate system; finish review with real-data screenshots (light, dark, 375px) before UI is called done.

## Review Focus

1. **Leakage through a "harmless" feature** — any feature whose value differs between a trial's start and its end (site counts, outcome counts edited late, sponsor history computed with trials ending after the start). Expected: sponsor history counts only trials whose completion date is before the trial's start date; the site ablation runs. Test: `test_sponsor_history_ignores_later_trials` (Task 2), `test_site_ablation_reported` (Task 4).
2. **A running trial with missing fields** (no start date, no sponsor, no phase, no sites, phase EARLY_PHASE1 or NA). Expected: out of scope (listed "not scored" with a reason) when phase/type is out of scope; otherwise scored with imputed values, never a crash. Test: `test_score_running_missing_fields` (Task 6).
3. **Model file and installed library disagree** (minor-version bump, missing file, corrupt card). Expected: `stop_risk:` warning, no `risk.json`, pages say scores appear after the next update. Test: `test_stop_risk_failure_is_warning` (Task 6), `test_load_rejects_minor_version_mismatch` (Task 4).
4. **`per_trial: false`** reaching every surface. Expected: no trial-level numbers anywhere (panel, Watchlist, trial page), target summaries still shown. Tests: `test_per_trial_false_omits_trials` (Task 6), web `hides per-trial scores when trials block absent` (Tasks 8, 9).
5. **A target or disease with zero scored running trials**, and a disease filter that empties the panel. Expected: panel shows a one-line empty state, never "0 of 0" or NaN. Test: web `empty panel under disease filter` (Task 8).

---

## File Structure

Pipeline (new package `pipeline/src/trialradar/risk/`):
- `scope.py` — status sets, phase/intervention scope predicates, labels.
- `fields.py` — raw-study fields not in `Tables` (arms, placebo arm, MeSH branches).
- `sponsors.py` — time-aware sponsor history.
- `features.py` — the feature frame (one code path for training and live).
- `model.py` — baseline/candidate recipes, bootstrap ensemble, prediction with range.
- `explain.py` — per-trial contributions → plain-word factors.
- `evaluate.py` — AUC, Brier, calibration bins.
- `artefacts.py` — save/load model + card, version check.
- `apply.py` — score running trials, build the `risk.json` document.
- `pipeline/scripts/train_stop_risk.py` — hand-run pull + train + evaluate + write.

Modified: `ctgov/client.py`, `ctgov/query.py`, `config.py`, `explorer/extras.py`, `pipeline.py`, `export.py`, `pyproject.toml`, `config/area.yaml`, integration test config, `scripts/make_web_fixtures.py`.

Config: `config/risk/{model.joblib,card.json,heldout.parquet,sponsor_history.csv,factor_labels.csv,README.md}`.

Web: `src/types.ts`, `src/data.ts`, `src/lib/risk.ts`, `src/components/risk/{RiskScale.tsx,RiskNote.tsx,risk.css}`, `src/components/target/TargetRisk.tsx`, `src/components/watchlist/WatchlistPage.tsx`, `src/App.tsx`, `src/components/SiteNav.tsx`, `src/components/Methods.tsx`, `src/components/TrialDetail.tsx`; tests alongside existing ones; `e2e/risk.spec.ts`.

---

### Task 1: Config, raw fields and a general registry query

**Files:**
- Modify: `pipeline/src/trialradar/config.py`, `pipeline/src/trialradar/ctgov/client.py`, `pipeline/src/trialradar/ctgov/query.py`, `pipeline/src/trialradar/explorer/extras.py`, `pipeline/pyproject.toml`, `config/area.yaml`
- Create: `pipeline/src/trialradar/risk/__init__.py`, `pipeline/src/trialradar/risk/scope.py`, `pipeline/src/trialradar/risk/fields.py`
- Test: `pipeline/tests/unit/test_config.py`, `test_ctgov_client.py`, `test_ctgov_query.py`, new `test_risk_scope.py`, `test_risk_fields.py`

**Interfaces:**
- Produces:
  - `class RiskConfig(_Strict)`: `enabled: bool = True`, `per_trial: bool = True`, `dir: Path = Path("risk")`; `AreaConfig.risk: RiskConfig = RiskConfig()`; `load_config` resolves `risk.dir` relative to the yaml like the other dirs.
  - `CtGovClient.iter_query(params: dict[str, str]) -> Iterator[dict]` (the paging loop, unchanged behaviour); `iter_studies(cfg)` becomes `iter_query(build_params(cfg))`.
  - `query.build_training_params(start_year: int) -> dict[str, str]`: interventional, phases PHASE1|PHASE2|PHASE3, `AREA[OverallStatus](COMPLETED OR TERMINATED)`, `AREA[InterventionType](DRUG OR BIOLOGICAL)`, `AREA[StartDate]RANGE[{y}-01-01,{y}-12-31]`, pageSize 1000, format json. No `query.cond`.
  - `scope.RUNNING = frozenset({"NOT_YET_RECRUITING","RECRUITING","ENROLLING_BY_INVITATION","ACTIVE_NOT_RECRUITING"})`; `scope.LABELS = {"COMPLETED": 0, "TERMINATED": 1}`; `scope.in_phase_scope(phases: list[str]) -> bool` (true iff any of PHASE1/2/3 present and EARLY_PHASE1 is not the only phase); `scope.has_drug(intervention_types: Iterable[str]) -> bool`.
  - `fields.RiskFields` (frozen dataclass): `nct_id: str`, `n_arms: int | None`, `placebo_arm: bool`, `branches: tuple[str, ...]` (MeSH browse-branch abbrevs from `derivedSection.conditionBrowseModule.browseBranches[].abbrev`, sorted, deduped); `fields.risk_fields(study: dict) -> RiskFields` (never raises on missing modules); placebo arm = any arm group of type `PLACEBO_COMPARATOR` or `SHAM_COMPARATOR`.
  - `StudyExtras` gains `risk: RiskFields | None = None`, filled by `_extras` via `risk_fields(study)`; `empty_extras` leaves it None.

- [ ] **Step 1: Write failing tests**: `test_risk_config_defaults_and_resolves_dir` (yaml without `risk` → enabled, per_trial true, dir resolved to `<yaml dir>/risk`); `test_build_training_params_2014` (asserts the exact `filter.advanced` string contains `RANGE[2014-01-01,2014-12-31]`, no `query.cond`); `test_iter_query_pages_and_dedupes` (reuse the existing paging test fixtures through `iter_query`); `test_in_phase_scope` (`["PHASE2","PHASE3"]`→True, `["EARLY_PHASE1"]`→False, `["PHASE4"]`→False, `[]`→False, `["NA"]`→False); `test_risk_fields_from_make_study` (two arms incl. `PLACEBO_COMPARATOR` → `n_arms == 2`, `placebo_arm`; branches `("BC10","BXM")` from a study with those abbrevs, unsorted and duplicated in input); `test_risk_fields_missing_modules` (empty `protocolSection` → `n_arms is None`, `placebo_arm is False`, `branches == ()`).
- [ ] **Step 2: Run** `cd pipeline && uv run pytest tests/unit/test_config.py tests/unit/test_ctgov_query.py tests/unit/test_ctgov_client.py tests/unit/test_risk_scope.py tests/unit/test_risk_fields.py -q` → new tests FAIL.
- [ ] **Step 3: Implement** the interfaces above. Pin `scikit-learn>=1.9,<1.10`; add `shap` and `joblib` to dependencies; `uv lock`. Add to `config/area.yaml`: `risk: {enabled: true, per_trial: true, dir: risk}`.
- [ ] **Step 4: Run** the Step 2 command plus the full suite `uv run pytest -q && uv run ruff check . && uv run ruff format --check . && uv run mypy src` → all PASS (existing extras tests unchanged).
- [ ] **Step 5: Commit** `feat(risk): config, raw risk fields, general registry query`.

### Task 2: Sponsor history and the feature frame

**Files:**
- Create: `pipeline/src/trialradar/risk/sponsors.py`, `pipeline/src/trialradar/risk/features.py`
- Test: `pipeline/tests/unit/test_risk_sponsors.py`, `test_risk_features.py`

**Interfaces:**
- Consumes: `Tables` (`trial`, `intervention`, `sponsor`, `site`, `outcome`, `condition`), `RiskFields`, `scope.*`.
- Produces:
  - `SPONSOR_FLOOR = 5`.
  - `sponsors.history_rows(trial: pl.DataFrame) -> pl.DataFrame` with columns `sponsor: str, end_date: date, stopped: int` from labelled trials (end date = `completion_date`, falling back to `primary_completion_date`; rows without a date or sponsor dropped).
  - `sponsors.prior_counts(trials: pl.DataFrame, history: pl.DataFrame) -> pl.DataFrame` — input `nct_id, lead_sponsor, start_date`; output `nct_id, sponsor_prior_n: int, sponsor_prior_stopped: int`, counting only history rows of the same sponsor with `end_date < start_date` (a trial never counts itself).
  - `sponsors.aggregate(history: pl.DataFrame, as_of: date) -> pl.DataFrame` — one row per sponsor: `sponsor, earlier, stopped, as_of` (the committed `sponsor_history.csv` format).
  - `sponsors.live_counts(trials: pl.DataFrame, table: pl.DataFrame) -> pl.DataFrame` — same output as `prior_counts`, read from the aggregate table (unknown sponsor → 0, 0).
  - `features.FEATURES: tuple[str, ...]` — the ordered column list (below); `features.SITE_FEATURES = ("n_sites", "n_countries", "multi_region")`.
  - `features.build(tables: Tables, fields: Mapping[str, RiskFields], sponsor_counts: pl.DataFrame, *, max_start_year: int | None = None) -> pl.DataFrame` — columns `nct_id` + `FEATURES`, one row per trial in `tables.trial`; numeric only (one-hot / multi-hot as ints, nulls allowed — HistGradientBoosting handles them; the logistic recipe imputes).
- Feature set (exact names): `phase_1`, `phase_2`, `phase_3` (multi-hot), `randomized`, `masking_level` (NONE=0, SINGLE=1, DOUBLE=2, TRIPLE=3, QUADRUPLE=4, else null), `n_arms`, `placebo_arm`, `sponsor_industry`, `sponsor_academic` (from `sponsor_class`: INDUSTRY; NIH/FED/OTHER_GOV/OTHER treated as academic/other per a mapping the implementer records in the module docstring), `n_collaborators`, `n_sites`, `n_countries`, `multi_region` (sites in >1 of a fixed continent map), `n_primary_outcomes`, `n_secondary_outcomes`, `n_conditions`, `branch_<ABBREV>` for each MeSH branch abbrev in a fixed list held in `features.BRANCHES` (the ~25 CT.gov browse branches), `has_biological`, `n_experimental_interventions` (DRUG+BIOLOGICAL count), `start_year` (clamped to `max_start_year` when given), `sponsor_prior_n`, `sponsor_prior_rate` (stopped / n, null when `n < SPONSOR_FLOOR`), `sponsor_few_prior` (1 when `n < SPONSOR_FLOOR`).

- [ ] **Step 1: Write failing tests**: `test_sponsor_history_ignores_later_trials` (sponsor S: trial A ends 2012 terminated, trial B ends 2016 completed, trial C starts 2014 → `sponsor_prior_n == 1`, `sponsor_prior_stopped == 1`); `test_prior_counts_excludes_self`; `test_aggregate_one_row_per_sponsor` (columns exactly `sponsor, earlier, stopped, as_of`); `test_live_counts_unknown_sponsor_zero`; `test_build_columns_exact` (`list(frame.columns) == ["nct_id", *FEATURES]`); `test_build_never_reads_end_facts` (two trials identical except enrollment, why_stopped, completion dates, status, last update → identical feature rows); `test_sponsor_floor` (n=4 → `sponsor_prior_rate` null and `sponsor_few_prior == 1`; n=5 → rate set, flag 0); `test_start_year_clamped` (start 2024, `max_start_year=2023` → 2023); `test_build_missing_everything` (trial with no sites, sponsor, start date, fields → one row, no exception).
- [ ] **Step 2: Run** `uv run pytest tests/unit/test_risk_sponsors.py tests/unit/test_risk_features.py -q` → FAIL.
- [ ] **Step 3: Implement** `sponsors.py` and `features.py` per the interfaces (`prior_counts` via a polars join on sponsor then filter `end_date < start_date`, group by `nct_id`).
- [ ] **Step 4: Run** Step 2 command + full gates → PASS.
- [ ] **Step 5: Commit** `feat(risk): sponsor history and feature frame`.

### Task 3: Model recipes, explanations, evaluation

**Files:**
- Create: `pipeline/src/trialradar/risk/model.py`, `explain.py`, `evaluate.py`
- Test: `pipeline/tests/unit/test_risk_model.py`, `test_risk_explain.py`, `test_risk_evaluate.py`

**Interfaces:**
- Consumes: feature frames from Task 2 (numeric matrix `X: np.ndarray`, column names `FEATURES`), labels `y: np.ndarray`.
- Produces:
  - `BASELINE_FEATURES = ("phase_1","phase_2","phase_3","sponsor_industry","sponsor_academic","start_year")`.
  - `model.Recipe = Literal["baseline", "boosted"]`.
  - `model.fit(recipe: Recipe, X: np.ndarray, y: np.ndarray, columns: Sequence[str], *, seed: int = 42) -> Fitted` — baseline: median-impute + standardise + `LogisticRegression` on `BASELINE_FEATURES` only; boosted: `HistGradientBoostingClassifier(random_state=seed)` wrapped in `CalibratedClassifierCV(method="isotonic", cv=5)`.
  - `model.Ensemble` dataclass: `recipe: Recipe`, `columns: tuple[str, ...]`, `main: Fitted`, `members: tuple[Fitted, ...]` (20); `model.fit_ensemble(recipe, X, y, columns, *, n_boot: int = 20, seed: int = 42) -> Ensemble`; `Ensemble.predict(X) -> tuple[np.ndarray, np.ndarray, np.ndarray]` = (p from `main`, 10th pct, 90th pct of members), each clipped to [0, 1], and `p` always inside [lo, hi] (widen the band if needed).
  - `explain.contributions(ens: Ensemble, X: np.ndarray) -> np.ndarray` (n × len(columns)): baseline → coefficient × standardised value (zeros for unused columns); boosted → `shap.TreeExplainer` on the uncalibrated booster (document that it explains the pre-calibration margin).
  - `explain.top_factors(contrib_row, x_row, columns, labels: Mapping[str, FactorLabel], k: int = 3) -> list[dict]` → `[{"label": str, "dir": "up" | "down"}]`, ordered by |contribution|, skipping zero contributions; `FactorLabel` from `factor_labels.csv` (`feature, up, down` templates; `{value}` placeholder). The sponsor factor uses the exact copy in Global Constraints, filled from `sponsor_prior_stopped` and `sponsor_prior_n`; when `sponsor_few_prior` it reads "Sponsor has few earlier finished trials".
  - `evaluate.metrics(y: np.ndarray, p: np.ndarray, *, bins: int = 10) -> dict` → `{"auc": float, "brier": float, "n": int, "positives": int, "calibration": [{"p": float, "observed": float, "n": int}, ...]}` (quantile bins; empty bins dropped; AUC null when one class only).

- [ ] **Step 1: Write failing tests** on a synthetic dataset (seeded numpy, 2,000 rows, label driven by two features): `test_baseline_uses_only_baseline_features` (permuting a non-baseline column leaves baseline predictions unchanged); `test_boosted_beats_chance_on_signal` (AUC > 0.7); `test_ensemble_range_contains_p` (all `lo <= p <= hi`, values in [0,1]); `test_ensemble_deterministic_with_seed`; `test_top_factors_order_and_direction` (planted strongest feature first, `dir` sign matches); `test_sponsor_factor_copy` (renders exactly "Sponsor's earlier trials: 9 of 40 stopped early (registry)"); `test_metrics_known_values` (perfect separation → auc 1.0; constant p=0.5 → brier 0.25; single-class y → auc None); `test_calibration_bins_sum_to_n`.
- [ ] **Step 2: Run** `uv run pytest tests/unit/test_risk_model.py tests/unit/test_risk_explain.py tests/unit/test_risk_evaluate.py -q` → FAIL.
- [ ] **Step 3: Implement** per interfaces.
- [ ] **Step 4: Run** Step 2 + full gates → PASS.
- [ ] **Step 5: Commit** `feat(risk): recipes, bootstrap range, factors, metrics`.

### Task 4: Artefacts, training script, CI evaluation check

**Files:**
- Create: `pipeline/src/trialradar/risk/artefacts.py`, `pipeline/scripts/train_stop_risk.py`, `config/risk/factor_labels.csv`, `config/risk/README.md`
- Test: `pipeline/tests/unit/test_risk_artefacts.py`, `pipeline/tests/unit/test_train_stop_risk.py`, `pipeline/tests/unit/test_risk_card.py`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - `artefacts.Card` (pydantic, strict): `version: str` (`"stop-risk-<YYYYMMDD>"`), `trained_on: date`, `sklearn: str`, `shipped: Recipe`, `shipped_reason: str`, `filter: dict`, `features: list[str]`, `excluded: list[str]`, `split: {"train_end": "2015-12-31", "test": ["2016-01-01","2019-12-31"]}`, `metrics: {"baseline": Metrics, "boosted": Metrics, "boosted_no_sites": Metrics, "in_area": Metrics | None}`, `site_leak_flag: bool`, `typical: list[{"phase": str, "sponsor": "industry" | "other" | "all", "rate": float, "n": int}]`, `max_start_year: int`, `sponsor_floor: int`, `n_train: int`, `n_test: int`.
  - `artefacts.save(dir: Path, eval_ens: Ensemble, shipped: Ensemble, card: Card, heldout: pl.DataFrame, sponsor_table: pl.DataFrame) -> None` → writes `model.joblib` (dict with `"eval"` and `"shipped"` ensembles), `card.json`, `heldout.parquet` (FEATURES + `label` + `in_area`; no NCT ids), `sponsor_history.csv`.
  - `artefacts.load(dir: Path) -> Loaded` (`eval`, `shipped`, `card`, `sponsor_table`, `factor_labels`); raises `RiskArtefactError` on a missing file, a card/model version mismatch, or `sklearn` minor version ≠ installed minor.
  - `artefacts.typical_rate(card: Card, phases: list[str], sponsor_class: str | None) -> tuple[float, str]` → (rate, basis text like "phase 3 drug trials, industry"); uses the sponsor split only when its rate differs from the phase-only rate by ≥ 0.05 and n ≥ 200.
  - Script CLI: `uv run python scripts/train_stop_risk.py --cache <dir> --out ../config/risk [--years 2008-2025] [--offline]` — pulls per start year via `build_training_params(y)` into `<cache>/<year>.jsonl.gz` (skips a cached year; `--offline` never fetches), normalizes with `normalize(studies, cfg.aliases_dir)`, `risk_fields` per study, filters `in_phase_scope` + `has_drug`, labels, builds features (training: `prior_counts`; shipped refit and sponsor table: `aggregate(history, as_of=today)`), fits baseline / boosted / boosted-without-`SITE_FEATURES` on the train split, evaluates on test (and the `in_area` subset: test trials whose conditions match `config/area.yaml` synonyms through the existing relevance filter), picks the shipped recipe by the Global Constraints rule, refits it on all labelled trials, computes `typical`, writes artefacts, prints a summary table.
  - `config/risk/factor_labels.csv`: one row per feature in `FEATURES` (columns `feature,up,down`), plain words (e.g. `n_countries,"Many countries ({value})","Few countries ({value})"`). A test asserts every `FEATURES` entry has a row.
  - CI check `test_risk_card.py::test_committed_metrics_reproduce`: if `config/risk/card.json` exists, load artefacts, predict `eval` on `heldout.parquet`, recompute `metrics` (overall and in-area) and assert AUC and Brier equal the card's within 1e-6; `test_committed_card_matches_model_version`. Skips with a reason only while `config/risk/` has no card (before Task 5).

- [ ] **Step 1: Write failing tests**: `test_save_load_roundtrip` (tmp dir, synthetic ensembles); `test_load_rejects_minor_version_mismatch` (card `sklearn` "1.8.0" → `RiskArtefactError`); `test_load_missing_file_raises`; `test_typical_rate_split_rule`; `test_factor_labels_cover_features`; `test_train_script_offline_on_fixture` (write a cache dir from `make_study` with ~400 synthetic studies across 2008–2019 with a planted signal; run `main(["--cache", d, "--out", out, "--offline", "--years", "2008-2019"])`; assert all six files exist, card `n_test > 0`, `shipped in {"baseline","boosted"}`, `shipped_reason` non-empty); `test_site_ablation_reported` (card has `boosted_no_sites` metrics and `site_leak_flag` is a bool); `test_heldout_has_no_ids_or_text` (columns ⊆ FEATURES ∪ {label, in_area}); `test_committed_metrics_reproduce`, `test_committed_card_matches_model_version` (skip while absent).
- [ ] **Step 2: Run** `uv run pytest tests/unit/test_risk_artefacts.py tests/unit/test_train_stop_risk.py tests/unit/test_risk_card.py -q` → FAIL (card tests SKIP).
- [ ] **Step 3: Implement** `artefacts.py`, the script (`main(argv) -> int`), `factor_labels.csv`, and `config/risk/README.md` (what it predicts, training filter, excluded fields and why — enrollment named first —, the two models, how to retrain, the sponsor-table exception to "never commit real data").
- [ ] **Step 4: Run** Step 2 + full gates → PASS.
- [ ] **Step 5: Commit** `feat(risk): artefacts, training script, CI metric check`.

### Task 5: Real training run (network; checkpoint with Martin)

**Files:**
- Create (generated): `config/risk/{model.joblib,card.json,heldout.parquet,sponsor_history.csv}`
- Modify: `config/risk/README.md` (actual numbers)

- [ ] **Step 1: Run** under `caffeinate -dims`: `cd pipeline && uv run python scripts/train_stop_risk.py --cache <session scratch>/risk-cache --out ../config/risk`. If a year's query exceeds the client's 100-page cap, split that year by half-year in `build_training_params` (add `half: Literal[1, 2] | None = None`) with a test, and rerun. On this Mac, set `SSL_CERT_FILE` to the system roots if TLS fails (as `config/mechanisms/README.md` describes).
- [ ] **Step 2: Verify** `uv run pytest tests/unit/test_risk_card.py -q` → 2 PASS (no skips). Check sizes: `model.joblib` + `heldout.parquet` + `sponsor_history.csv` together under 15 MB; if over, reduce `heldout.parquet` to the needed columns at float32 and record it.
- [ ] **Step 3: Report to the controller** the printed summary (n train/test, AUCs baseline / boosted / no-sites / in-area with n, Brier, which recipe shipped and why, site-leak flag). **The controller shows Martin these numbers before Task 6** (if the in-area n is too small to say anything, Methods says so; if the boosted recipe lost, the baseline ships — both are acceptable outcomes, not failures).
- [ ] **Step 4: Commit** `data(risk): first trained stop-risk model` (artefacts + README numbers).

### Task 6: Daily `stop_risk` stage, `risk.json`, fixtures

**Files:**
- Create: `pipeline/src/trialradar/risk/apply.py`, `pipeline/tests/fixtures/risk/` (tiny synthetic artefacts, generated by a test helper `tests/risk_fixture.py::write_fixture_artefacts(dir)` and committed)
- Modify: `pipeline/src/trialradar/pipeline.py` (run and rebuild), `pipeline/src/trialradar/export.py`, integration test config (add `risk.dir` → fixture dir), `pipeline/scripts/make_web_fixtures.py` (nothing else; it runs the real pipeline), `web/tests/fixtures/data/` (regenerated)
- Test: `pipeline/tests/unit/test_risk_apply.py`, `pipeline/tests/unit/test_export.py`, `pipeline/tests/integration/test_pipeline.py`, `test_rebuild.py`, `test_config_swap.py`

**Interfaces:**
- Consumes: `artefacts.load`, `features.build` (live: `sponsors.live_counts`, `max_start_year=card.max_start_year`), `explain.*`, `StudyExtras.risk`, the pipeline-figure doc (`rows[].id`, `rows[].marks[].n`, `rows[].marks[].dz`).
- Produces:
  - `apply.build_risk_doc(tables: Tables, extras: Mapping[str, StudyExtras], cfg: AreaConfig, loaded: Loaded, figure: dict | None, day: date) -> dict` — the `risk.json` document:
    ```json
    {
      "generated_for": "YYYY-MM-DD",
      "model": {"version": "...", "trained_on": "...", "shipped": "boosted", "shipped_reason": "...",
                "metrics": {"baseline": {...}, "boosted": {...}, "boosted_no_sites": {...}, "in_area": {...}|null},
                "site_leak_flag": false, "split": {...}, "features": [...], "excluded": [...],
                "n_train": 0, "n_test": 0, "per_trial": true},
      "trials": {"NCT…": {"p": 0.18, "lo": 0.10, "hi": 0.29, "typical": 0.19,
                          "basis": "phase 3 drug trials", "factors": [{"label": "...", "dir": "up"}]}},
      "not_scored": {"NCT…": "phase 4"},
      "targets": {"<row id>": {"all": {"n": 7, "median": 0.18, "typical": 0.21},
                               "by_disease": {"MG": {"n": 4, "median": 0.16, "typical": 0.20}}}}
    }
    ```
    Probabilities rounded to 3 decimals. `trials` key omitted when `cfg.risk.per_trial` is false. `targets` omitted when `figure` is None. `not_scored` covers running trials in the area outside scope, with reasons `"phase not 1–3"` or `"no drug or biologic"`. A scored trial's `typical`/`basis` from `typical_rate`.
  - `pipeline._stop_risk(tables, extras, cfg, figure, *, day=None) -> tuple[dict | None, list[str]]` — runs after `_pipeline_figure` in both `run` and rebuild; disabled config → `(None, [])`; any exception → `(None, ["stop_risk: <Exc>"])`.
  - `export(..., risk: dict | None = None)` writes `risk.json`, otherwise unlinks a stale one.

- [ ] **Step 1: Write failing tests**: `test_build_risk_doc_scores_running_only` (fixture tables: one RECRUITING phase 2 drug trial → in `trials`; one COMPLETED → absent; one RECRUITING phase 4 → `not_scored` "phase not 1–3"); `test_score_running_missing_fields` (running phase 2 drug trial with no sponsor, sites or start date → scored, finite `p`); `test_per_trial_false_omits_trials` (no `trials` key, `targets` present); `test_targets_from_figure_marks` (two scored trials in row `fcrn`, one with `dz: ["MG"]` → `targets.fcrn.all.n == 2`, `by_disease.MG.n == 1`); `test_no_figure_no_targets`; `test_export_writes_and_removes_risk_json`; integration `test_stop_risk_failure_is_warning` (point `risk.dir` at an empty dir → run succeeds, warning starts `stop_risk:`, no `risk.json`); `test_rebuild_writes_risk_json`; config-swap test still passes (no condition names).
- [ ] **Step 2: Run** `uv run pytest tests/unit/test_risk_apply.py tests/unit/test_export.py tests/integration -q` → FAIL.
- [ ] **Step 3: Implement** `apply.py`, `_stop_risk`, the export parameter, both call sites; generate and commit `tests/fixtures/risk/`; point the integration config at it.
- [ ] **Step 4: Run** full pipeline gates; then `uv run python scripts/make_web_fixtures.py` and confirm `web/tests/fixtures/data/risk.json` exists and `cd ../web && npx vitest run` still passes (`test_web_fixtures.py` too).
- [ ] **Step 5: Commit** `feat(risk): daily stop_risk stage and risk.json`.

### Task 7: Web data layer

**Files:**
- Modify: `web/src/types.ts`, `web/src/data.ts`
- Create: `web/src/lib/risk.ts`, `web/tests/risk.test.ts`

**Interfaces:**
- Produces:
  - Types `RiskFile`, `RiskModelInfo`, `RiskMetrics`, `RiskTrial`, `RiskTargetSummary` mirroring Task 6's document (`trials?` and `targets?` optional).
  - `loadRisk(): Promise<RiskFile | null>` (`risk.json`, null on 404).
  - `lib/risk.ts`: `formatPct(p: number): string` ("18%"; "<1%" below 0.005); `formatRange(lo, hi): string` ("10–29"); `vsTypical(p, typical): "above" | "near" | "below"` (near = within ±0.03); `scaleMax = 0.6` and `scalePos(p): number` (0..1, clamped); `rankTrials(file, filter: {disease?: string[]; company?: string[]; target?: string[]}, sort: "estimate" | "difference", rows: PipelineFile | null): WatchRow[]` where `WatchRow = {nct, p, lo, hi, typical, basis, factors, target: string | null, diseases: string[], company: string | null, phase: string, title: string}` (target/disease/company joined from `pipeline.json` marks and sponsors; trials outside any row get `target: null`); `targetSummary(file, rowId, disease?: string): RiskTargetSummary | null`.

- [ ] **Step 1: Write failing tests** in `web/tests/risk.test.ts`: formatting cases (`0.183→"18%"`, `0.001→"<1%"`); `vsTypical(0.25, 0.19) === "above"`, `(0.20, 0.19) === "near"`; `rankTrials` sorts by `p` desc and by `p - typical` desc; filter by disease using the fixture; untargeted trial has `target === null`; `rankTrials` returns `[]` when `trials` is absent.
- [ ] **Step 2: Run** `cd web && npx vitest run tests/risk.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run && npx eslint . && npx tsc --noEmit` → PASS.
- [ ] **Step 5: Commit** `feat(web): risk data layer`.

### Task 8: Target-page panel and trial-page note

**Files:**
- Create: `web/src/components/risk/RiskScale.tsx`, `web/src/components/risk/RiskNote.tsx`, `web/src/components/risk/risk.css`, `web/src/components/target/TargetRisk.tsx`
- Modify: `web/src/components/target/TargetPage.tsx` (new section after the existing panels, labelled "e"), `web/src/components/TrialDetail.tsx`
- Test: `web/tests/TargetPage.test.tsx`, `web/tests/TrialDetail.test.tsx`

**Interfaces:**
- Consumes: Task 7.
- Produces: `<RiskScale p lo hi typical />` (0–60% hairline scale, typical tick in ink, estimate mark in outcome-running blue with its range; text equivalent for screen readers: "Estimated 18% (10–29); typical 19%"); `<RiskNote />` (the standing note, verbatim, with a link to `/methods#stop-risk`); `<TargetRisk rowId disease? />`.
- Panel content: heading "Running trials, estimated chance of stopping early"; subline "{target} · {disease or 'All diseases'} · {n} running. Tick = typical for {basis}."; one row per scored trial (drug · phase · company, scale, "18% (10–29)"); "Main factors" disclosure per row listing up to 3 factors; `RiskNote`. Without `trials`: one line "Median estimate {x}% across {n} running trials; typical {y}%." Empty: "No running trials with an estimate{ for this disease}." No data file: the panel is absent.
- Trial page: under the status block, "Estimated chance of stopping early: 18% (10–29), typical 19% for phase 3 drug trials", factors, `RiskNote`; "Not scored: phase not 1–3" for `not_scored`; nothing when `trials` absent.

- [ ] **Step 1: Write failing tests**: `renders the risk panel with heading and rows` (fixture row with scored trials); `empty panel under disease filter` (disease with none → the empty sentence, no "NaN", no "0 of 0"); `hides per-trial scores when trials block absent` (summary line only, no per-trial rows); `panel absent without risk.json`; trial page shows estimate and note; trial page shows "Not scored" reason; copy test: none of "risk of failure", "likely to fail", "in trouble" appear in rendered text (extend `plainWords.test.tsx`).
- [ ] **Step 2: Run** `npx vitest run tests/TargetPage.test.tsx tests/TrialDetail.test.tsx tests/plainWords.test.tsx` → FAIL.
- [ ] **Step 3: Implement** inside the Figure Plate system (DESIGN.md tokens; no new colours; light and dark; ≥ 44px touch targets on phones; scale readable at 375px).
- [ ] **Step 4: Run** full web gates → PASS.
- [ ] **Step 5: Commit** `feat(web): target risk panel and trial-page estimate`.

### Task 9: Watchlist page

**Files:**
- Create: `web/src/components/watchlist/WatchlistPage.tsx`, `web/src/components/watchlist/watchlist.css`, `web/tests/Watchlist.test.tsx`, `web/e2e/risk.spec.ts`
- Modify: `web/src/App.tsx` (route `/watchlist`), `web/src/components/SiteNav.tsx` (both nav lists: Pipeline · Watchlist · Approaches · Changes · Trials · Methods), `web/tests/AppRoutes.test.tsx`

**Interfaces:**
- Consumes: Tasks 7–8 (`rankTrials`, `RiskScale`, `RiskNote`).
- Page: title "Watchlist"; lede "{n} running drug trials, ranked by estimated chance of stopping early."; `RiskNote`; controls (reuse the existing dropdown/MultiSelect components): Disease, Company, Target (incl. "No target row"), Sort (Estimate | Above typical by most); table columns Trial (NCT link to `/trial/:nct` + CT.gov link, phase · company), Target · Disease (target links to `/target/:slug`), Estimate vs typical (`RiskScale` + numbers), Main factors (up to 3). URL keeps filters (`?disease=&company=&target=&sort=`), consistent with the rest of the app's hand-offs. Phone: rows become stacked cards. Without `trials`: a list of targets with their summaries, linking to target pages. No `risk.json`: "Estimates appear after the next daily update."

- [ ] **Step 1: Write failing tests**: renders ranked rows from fixture in `p` order; sort switch reorders by difference; disease filter narrows and is in the URL; "No target row" filter shows untargeted trials; `hides per-trial scores when trials block absent` (target list instead); missing file message; nav contains "Watchlist" between Pipeline and Approaches. E2E `risk.spec.ts`: desktop and 375px — `/watchlist` loads, first row has an estimate and the note; a target page shows the panel; no horizontal scroll at 375px.
- [ ] **Step 2: Run** `npx vitest run tests/Watchlist.test.tsx tests/AppRoutes.test.tsx` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** full web gates and `PW_CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run e2e` on a scratch build/port (never 4173) → PASS.
- [ ] **Step 5: Commit** `feat(web): Watchlist page`.

### Task 10: Methods section "How good is the stop-risk model?"

**Files:**
- Modify: `web/src/components/Methods.tsx` (new `<section id="stop-risk">` after "Advanced to next phase"), `web/tests/Methods.test.tsx`

**Content (rendered from `risk.json.model`; no hard-coded numbers):** what it predicts (terminated vs completed after starting; withdrawn and suspended left out, and why this differs from the success proxy); training set and filter; the time split and why later years are left out of the test; a calibration chart (inline SVG, predicted vs observed, diagonal reference, Figure Plate styling, text alternative); AUC/Brier table: baseline, boosted, boosted without site features, neuroimmunology only (with n, and "too few to judge" when `in_area` is null or n < 100); which model shipped and `shipped_reason`; what is excluded and why, enrollment first; the leakage caveat (current records only; reported accuracy may be slightly flattering; the site-leak sentence when `site_leak_flag`); one or two published registry-based termination models for comparison (the implementer finds and verifies them with a search; if none can be verified, the sentence is omitted, never invented); how to read a score (estimate beside typical; the range); the sponsor-history factor and its floor; retrained by hand, last trained `{trained_on}`; the two-models note (accuracy measured on the earlier fit, live scores from the refit).

- [ ] **Step 1: Write failing tests**: section renders the AUC rows with fixture values; shows "too few to judge" when `in_area` null; shows site-leak sentence only when flagged; calibration chart has an accessible description; no numbers render when `risk.json` absent (section says estimates appear after the next update).
- [ ] **Step 2: Run** `npx vitest run tests/Methods.test.tsx` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** full web gates → PASS.
- [ ] **Step 5: Commit** `feat(web): Methods stop-risk evaluation`.

### Task 11: Real-data preview, finish review, docs, final review

**Files:**
- Modify: `README.md` (status line, routes, a "Stop-risk estimates" section, remove "does not predict anything yet"), `DESIGN.md` (panel e, Watchlist, Methods chart), `PRODUCT.md` (capabilities), `docs/architecture.md` (stop_risk stage, risk.json), `docs/superpowers/HANDOFF.md` (§00 session entry)

- [ ] **Step 1: Build the real-data preview** per HANDOFF §00 "Real-data preview" on port 4174 (never 4173); confirm `risk.json` exists and report: scored trials n, not-scored n, the five highest estimates with their factors, and the target summaries for the top 5 rows.
- [ ] **Step 2: Screenshots** (fresh page per view) of `/watchlist`, one target page, a trial page and `/methods#stop-risk` at 1280 and 375, light and dark, into the session scratch.
- [ ] **Step 3: Design finish review** with the `impeccable:impeccable-finish-reviewer` agent on those screenshots; apply material fixes; recapture.
- [ ] **Step 4: Update the docs** listed above with real numbers from Step 1 and the card.
- [ ] **Step 5: Final whole-branch review** (Opus) over the branch diff against the spec; apply fixes; scoped re-review; all gates (pytest, ruff, mypy, vitest, eslint, tsc, e2e) green.
- [ ] **Step 6: Commit** `docs: stop-risk model shipped`. Do not push; tell Martin the branch is ready for him to push.
