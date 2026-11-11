# Explorer (Figure Plate) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the home page a live 3D map of every tracked trial laid out by what it studies. Present it as "Figure 1" with panels a–d and overlays for outcomes, phase and disease. Add registry summaries to trial pages.

**Architecture:** A new `trialradar.explorer` package runs inside the daily pipeline, after the store write and before export:
- It reads extra fields straight from the relevant raw studies (no store schema change).
- It builds content-only features, lays them out with UMAP in 3D, aligns the layout to yesterday's, labels outcomes and computes the neighbourhood lift.
- `export` writes `explorer.json` and adds summaries and eligibility to `trials/<NCT>.json`.

The web app gets an `/explore` route (the new home) that draws the map on a Canvas 2D element. Filters, colouring and projection live in pure, tested functions.

**Tech Stack:**
- Pipeline: Python 3.12, uv, polars, numpy, scikit-learn (TF-IDF, nearest neighbours), umap-learn, scipy (Procrustes), pytest, ruff, mypy strict.
- Web: React 19 + TypeScript, Vite, vitest, Playwright, `@fontsource/hanken-grotesk`.

**Spec:** `docs/superpowers/specs/2026-11-05-explorer-figure-plate-design.md`. Also read `PRODUCT.md` and `docs/superpowers/HANDOFF.md` sections 2–4. The approved visual is `.impeccable/mocks/decision/model-pick.html` (synthetic data; dark palette in `plate-dark.html`).

## Global Constraints

- $0 running cost: no server, no secrets, no new paid service. Only first-party GitHub Actions.
- No source file may name a condition. `pipeline/tests/integration/test_config_swap.py` scans `pipeline/src` and `web/src` for area words. Disease labels come from `config/area.yaml`.
- Layout features use only disease, treatment type, molecule and population. Never use status, phases, dates, enrollment, results, why_stopped, sponsor, sites or outcomes.
- Success wording on screen: "Succeeded (drug moved to a later phase)". Never a bare "successful".
- "Succeeded" (spec 6.3) requires all of:
  - The trial is COMPLETED, in phase Early Phase 1 to Phase 2/3 (combined phases use the highest).
  - At least one experimental-arm drug or biologic had no tracked Phase 3/4 trial starting before this trial started.
  - That drug appears in a tracked trial of a later phase that started after this trial started and is not WITHDRAWN.
- Outcome codes:
  - `succeeded`
  - `stopped`: TERMINATED, WITHDRAWN or SUSPENDED.
  - `completed_unknown`: COMPLETED and not succeeded.
  - `running`: RECRUITING, NOT_YET_RECRUITING, ACTIVE_NOT_RECRUITING or ENROLLING_BY_INVITATION.
  - `unknown`: UNKNOWN or any other status.
- Lift (spec 6.4):
  - Pool: finished trials (COMPLETED or stopped) in Early Phase 1 to Phase 2/3.
  - Neighbours: k = 10 within the pool, in feature space, cosine distance, excluding neighbours that share any experimental-arm drug.
  - Baseline: 1,000 label permutations, fixed seed, 2.5–97.5% range.
  - Verdict: `insufficient` if `n_succeeded` < 30; `chance` if the lift is inside the range; else `clustered`.
- UMAP: 3 dims, cosine metric, fixed seed from config (default 42).
- Alignment: each day's coordinates are aligned to the previous day's by orthogonal Procrustes (rotation, reflection, scale) on shared trial ids. Previous coordinates live in `data/explorer/coords.parquet`. If none exist, keep the raw layout.
- `explorer.json` carries no summaries. The selected-trial panel lazy-loads `trials/<NCT>.json`.
- All JSON goes through `export._write_json` (compact, key-sorted, atomic). Arrays are sorted by `nct_id`.
- Colours: white plate, ink `#111`, the only accent `#c8102e` for succeeded. Dark mode uses the `plate-dark.html` palette (ground `#17191c`, ink `#eceae4`, accent `#ff8a3d`) via `prefers-color-scheme`.
- Fonts: Hanken Grotesk, self-hosted via `@fontsource/hanken-grotesk`. No Google Fonts request.
- Gates before every push:
  - `cd pipeline && uv run pytest -q && uv run ruff check . && uv run ruff format --check . && uv run mypy src scripts`
  - `cd web && npx vitest run && npm run lint && npx tsc --noEmit`
  - `npm run e2e` when UI flows change.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Work on branch `feat/explorer-figure-plate`. Never merge without Martin's say-so.

## Review Focus

1. **A trial with no experimental arm groups, or no drug interventions.** Experimental drugs fall back to all DRUG/BIOLOGICAL interventions minus excluded terms. With none at all, the trial can still be placed but can never be `succeeded`. (Tests in Task 2 and Task 4.)
2. **Missing or odd eligibility values** ("N/A", "", "18 Years", "6 Months", "3 Weeks", absent sex). Age parses to years or null. Population flags tolerate nulls without crashing the feature builder. (Task 2.)
3. **A tiny area or a first run** (fewer than 15 trials, so UMAP's `n_neighbors` would exceed n; no previous coords; zero succeeded). The explorer step must not fail the run:
   - Fewer than 4 trials: write `explorer.json` with an empty `trials` list and verdict `insufficient`.
   - Otherwise, clamp `n_neighbors` to `n - 1`. (Tasks 6–8.)
4. **The page with no `explorer.json`** (old site before the first new run) or with zero trials after filtering. The Explore page shows an explanation and a reset, never a blank canvas or a crash. (Tasks 10–11.)
5. **Phone width and reduced motion.** No horizontal scroll at 375px on `#/explore`. No auto-rotation when `prefers-reduced-motion: reduce`. (Task 13.)

---

### Task 1: Explorer config and per-study condition labels

**Files:**
- Modify: `pipeline/src/trialradar/config.py`, `pipeline/src/trialradar/relevance.py`, `config/area.yaml`
- Test: `pipeline/tests/unit/test_config.py`, `pipeline/tests/unit/test_relevance.py`

**Interfaces:**
- Produces:
  - `class ExplorerConfig(_Strict)`, with fields and defaults:
    - `weights: dict[Literal["disease","treatment_type","molecule","population"], float]`, default each 1.0. Missing keys fill with 1.0, and all weights must be ≥ 0.
    - `exclude_terms: list[str]`, default `[]`.
    - `n_neighbors: int = 15`, `min_dist: float = 0.1`, `seed: int = 42`, `k: int = 10`, `permutations: int = 1000`, `min_successes: int = 30`.
  - `AreaConfig.explorer: ExplorerConfig = ExplorerConfig()`
  - `relevance.condition_labels(study: dict[str, Any], cfg: AreaConfig) -> list[str]`: the config labels whose synonyms match the study's conditions, keywords or MeSH terms (same text sources and matching as `is_relevant`, per label). Returned in config order.

- [ ] **Step 1: Write failing tests.**
  - `test_explorer_defaults_when_block_absent`: loading a YAML without `explorer` gives `cfg.explorer.k == 10` and `cfg.explorer.weights["molecule"] == 1.0`.
  - `test_explorer_rejects_negative_weight`: raises `ConfigError`.
  - `test_condition_labels_matches_per_label`: a study with condition "Neuromyelitis Optica" under a two-label test config returns only that label.
  - `test_condition_labels_empty_when_no_match`.
- [ ] **Step 2: Run** `cd pipeline && uv run pytest tests/unit/test_config.py tests/unit/test_relevance.py -q`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** `ExplorerConfig` and `condition_labels`. Build one compiled pattern per label, reusing `_texts` and the escaping rules from `_pattern`.
- [ ] **Step 4: Add an `explorer:` block to `config/area.yaml`.**
  - Set weights to disease 1.0, treatment_type 0.6, molecule 1.0, population 0.4.
  - Set `exclude_terms` to: placebo, sham, saline, vehicle, standard of care, best supportive care, usual care, no intervention, observation.
- [ ] **Step 5: Run** the tests plus `test_config_swap.py`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(explorer): config block and per-label condition matching`.

### Task 2: Study extras from raw records

**Files:**
- Create: `pipeline/src/trialradar/explorer/__init__.py`, `pipeline/src/trialradar/explorer/extras.py`
- Test: `pipeline/tests/unit/test_explorer_extras.py` (build studies with the existing `make_study` helper in `tests/conftest.py`, extending it with optional kwargs where needed)

**Interfaces:**
- Consumes: `condition_labels` (Task 1), `norm_text` (textnorm).
- Produces:
  - `@dataclass(frozen=True) class StudyExtras`, fields:
    - `nct_id: str`, `brief_summary: str | None`
    - `sex: Literal["ALL","FEMALE","MALE"] | None`, `min_age_years: float | None`, `max_age_years: float | None`, `has_results: bool`
    - `experimental_drugs: tuple[str, ...]` (raw names, deduped, order kept), `mesh_terms: tuple[str, ...]`, `condition_labels: tuple[str, ...]`
  - `parse_age_years(text: str | None) -> float | None`: units Years / Months / Weeks / Days. "N/A", empty or unparseable → None.
  - `extract_extras(relevant: Sequence[dict[str, Any]], cfg: AreaConfig) -> dict[str, StudyExtras]`
  - Experimental drugs come from `armGroups` with `type == "EXPERIMENTAL"`. Their `interventionNames` look like `"Drug: X"` or `"Biological: X"`; strip the prefix and keep only Drug/Biological. If no experimental arm yields a drug, fall back to all DRUG/BIOLOGICAL entries in `interventions`.
  - MeSH terms come from `derivedSection.conditionBrowseModule.meshes[].term`. `has_results` comes from the study's top-level `hasResults`.

- [ ] **Step 1: Write failing tests.**
  - `test_parse_age_years`, parametrized:
    - "18 Years" → 18.0
    - "6 Months" → 0.5
    - "3 Weeks" → 3/52
    - "N/A" → None
    - None → None
  - `test_experimental_arm_drugs_only`: arms EXPERIMENTAL with "Drug: A" and ACTIVE_COMPARATOR with "Drug: B" → `("A",)`.
  - `test_fallback_to_interventions_when_no_arms`: no armGroups and interventions DRUG "A" and DEVICE "D" → `("A",)`.
  - `test_summary_sex_results`: the fields come through, and a missing sex gives None.
- [ ] **Step 2: Run** `uv run pytest tests/unit/test_explorer_extras.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** `extras.py`.
- [ ] **Step 4: Run** the tests. Expected: PASS. Also run `uv run mypy src`.
- [ ] **Step 5: Commit** `feat(explorer): extract summary, eligibility, arms and MeSH from raw studies`.

### Task 3: Drug name cleaning and seed aliases

**Files:**
- Create: `pipeline/src/trialradar/explorer/drugs.py`, `pipeline/scripts/top_drugs.py`
- Modify: `config/aliases/intervention.csv`
- Test: `pipeline/tests/unit/test_explorer_drugs.py`

**Interfaces:**
- Consumes: `load_aliases`/`apply_alias` (textnorm), `ExplorerConfig.exclude_terms`.
- Produces: `clean_drug_name(name: str, aliases: Mapping[str, str], exclude_terms: Sequence[str]) -> str | None`. Steps:
  1. Apply the alias.
  2. Casefold.
  3. Drop bracketed text.
  4. Strip doses (`\d+(\.\d+)?\s*(mg|g|mcg|µg|ug|ml|iu|units?|mg/kg|%)`), routes (oral, iv, intravenous, subcutaneous, sc, im, intramuscular, infusion, injection, tablets?, capsules?) and salt suffixes (hydrochloride, hcl, sodium, acetate, sulfate, phosphate, maleate, fumarate).
  5. Collapse whitespace.
  6. Apply the alias again.

  The result is None when empty or when it contains any exclude term.

- [ ] **Step 1: Write failing tests** (parametrized `test_clean_drug_name`):
  - "Fingolimod hydrochloride 0.5 mg oral" → "fingolimod"
  - "Placebo" → None
  - "Ocrevus" with alias {"ocrevus": "ocrelizumab"} → "ocrelizumab"
  - "Rituximab (MabThera) 1000 mg IV" → "rituximab"
  - "" → None
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** `drugs.py`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Write `scripts/top_drugs.py`.**
  - It reads a raw snapshot `.jsonl.gz` (path argument), applies `filter_relevant`, `extract_extras` and `clean_drug_name`, and prints the 60 most frequent cleaned names with counts.
  - Run it on `raw/` from `gh release download snapshots-2026-11 -p '2026-11-05.jsonl.gz' -D /tmp/snap`.
  - Using the output, add `raw,normalized` rows to `config/aliases/intervention.csv` for brand, code-name and spelling variants of the ~30 most frequent drugs. Every row must be a verifiable synonym (INN ↔ brand ↔ sponsor code). Do not guess.
- [ ] **Step 6: Run** the full pipeline tests. Expected: PASS. An alias edit must not create change rows; existing tests cover this.
- [ ] **Step 7: Commit** `feat(explorer): drug name cleaning and seed intervention aliases`.

### Task 4: Outcome labels

**Files:**
- Create: `pipeline/src/trialradar/explorer/outcomes.py`
- Test: `pipeline/tests/unit/test_explorer_outcomes.py`

**Interfaces:**
- Consumes: `Tables.trial` (`nct_id`, `phases`, `overall_status`, `start_date`), `StudyExtras.experimental_drugs`, `clean_drug_name`.
- Produces:
  - `Outcome = Literal["succeeded","stopped","completed_unknown","running","unknown"]`
  - `PHASE_RANK = {"EARLY_PHASE1":0,"PHASE1":1,"PHASE2":2,"PHASE3":3,"PHASE4":4}`; NA has no rank.
  - `top_phase(phases: Sequence[str]) -> str | None`: the highest-ranked phase, else "NA" if present, else None.
  - `TrialDrugs = dict[str, frozenset[str]]`: nct_id → cleaned experimental drugs.
  - `label_outcomes(trial: pl.DataFrame, drugs: TrialDrugs) -> dict[str, Outcome]`, implementing Global Constraints exactly.
  - `in_pool(top: str | None, outcome: Outcome) -> bool`: true when `top` is in EARLY_PHASE1..PHASE3 and the outcome is in {succeeded, stopped, completed_unknown}.

- [ ] **Step 1: Write failing tests.**
  - `test_phase2_completed_drug_later_in_phase3_succeeds`
  - `test_comparator_drug_does_not_count`: the drug sits only in a comparator, so it is absent from `drugs`.
  - `test_already_late_phase_drug_does_not_count`: the drug had a PHASE3 trial starting earlier, so the trial is `completed_unknown`.
  - `test_later_trial_must_start_after`
  - `test_withdrawn_later_trial_ignored`
  - `test_phase3_never_succeeds`
  - `test_combined_phase2_phase3_uses_phase3`: a later trial must therefore be PHASE4.
  - `test_status_buckets`: TERMINATED, WITHDRAWN and SUSPENDED → stopped; RECRUITING → running; UNKNOWN → unknown.
  - `test_missing_start_date_never_succeeds`
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** `outcomes.py`. Build an index drug → list of (rank, start_date, status) once, so labelling is O(trials × drugs).
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(explorer): outcome labels with experimental-arm drug progression`.

### Task 5: Content-only feature matrix

**Files:**
- Create: `pipeline/src/trialradar/explorer/features.py`
- Modify: `pipeline/pyproject.toml` (add `numpy`, `scipy`, `scikit-learn`), `pipeline/uv.lock` via `uv add`
- Test: `pipeline/tests/unit/test_explorer_features.py`

**Interfaces:**
- Consumes: `StudyExtras`, `TrialDrugs`, `ExplorerConfig.weights`, and the intervention types from `Tables.intervention` (`nct_id`, `type`) only.
- Produces: `@dataclass(frozen=True) class Features` with:
  - `ids: list[str]` (sorted nct_ids)
  - `matrix: scipy.sparse.csr_matrix` (L2-normalised rows)
  - `block_slices: dict[str, slice]`

  And `build_features(ids: Sequence[str], extras: Mapping[str, StudyExtras], drugs: TrialDrugs, intervention_types: Mapping[str, frozenset[str]], weights: Mapping[str, float]) -> Features`. The blocks:
  - **disease:** multi-hot `condition_labels` plus TF-IDF of `mesh_terms` (each term one token).
  - **treatment_type:** multi-hot.
  - **molecule:** TF-IDF of drugs (each drug one token).
  - **population:** paediatric (min age < 18), adult (range overlaps 18–64), older (max ≥ 65 or no max), female-only, male-only. A null age range counts as adult.

  Each block is row-L2-normalised, multiplied by `sqrt(weight)`, and the blocks are concatenated.

- [ ] **Step 1: Write failing tests.**
  - `test_signature_has_no_outcome_inputs`: `inspect.signature(build_features)` parameters are exactly `{"ids","extras","drugs","intervention_types","weights"}`. Also, a monkeypatched `StudyExtras` with `has_results` flipped yields an identical matrix (`has_results` must be unused).
  - `test_same_drug_trials_are_closer`: cosine similarity of two trials sharing a drug is greater than that of trials that don't.
  - `test_zero_weight_removes_block_influence`: molecule weight 0 makes trials that differ only by drug identical.
  - `test_null_eligibility_ok`
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** `features.py` (scikit-learn `TfidfVectorizer(analyzer=lambda x: x)` on token lists).
- [ ] **Step 4: Run.** Expected: PASS. Run `uv run mypy src`; add `[[tool.mypy.overrides]]` `ignore_missing_imports` for `sklearn.*`, `scipy.*` and `umap.*` only.
- [ ] **Step 5: Commit** `feat(explorer): content-only feature matrix`.

### Task 6: 3D layout and day-to-day alignment

**Files:**
- Create: `pipeline/src/trialradar/explorer/layout.py`
- Modify: `pipeline/pyproject.toml` (add `umap-learn`)
- Test: `pipeline/tests/unit/test_explorer_layout.py`

**Interfaces:**
- Consumes: `Features`.
- Produces:
  - `embed(features: Features, n_neighbors: int, min_dist: float, seed: int) -> np.ndarray`, shape (n, 3), float64.
    - n < 4 → zeros (n, 3).
    - Otherwise UMAP(metric="cosine", n_components=3, random_state=seed, n_neighbors=min(n_neighbors, n-1)).
    - Then centre and scale so the max norm is 1.
  - `align(ids: Sequence[str], coords: np.ndarray, previous: Mapping[str, tuple[float,float,float]]) -> np.ndarray`
    - Orthogonal Procrustes (`scipy.linalg.orthogonal_procrustes`, plus uniform scale) fitted on the shared ids, applied to all rows.
    - Fewer than 4 shared ids → return `coords` unchanged.

- [ ] **Step 1: Write failing tests.**
  - `test_embed_shape_and_scale`: 40 synthetic rows in two separated groups → shape (40, 3), max norm ≈ 1, and group centroids more than 0.5 apart.
  - `test_embed_tiny_input`: n = 3 → zeros.
  - `test_align_recovers_rotation`: rotate and reflect a point set, then align back to the original → max abs error < 1e-6.
  - `test_align_without_overlap_is_identity`
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** `layout.py`.
- [ ] **Step 4: Run.** Expected: PASS. Note the wall time for 3,000 synthetic rows in a scratch run; it must be under 60 s on a laptop.
- [ ] **Step 5: Commit** `feat(explorer): UMAP 3D layout with Procrustes alignment`.

### Task 7: Neighbourhood lift

**Files:**
- Create: `pipeline/src/trialradar/explorer/stats.py`
- Test: `pipeline/tests/unit/test_explorer_stats.py`

**Interfaces:**
- Consumes: `Features.matrix`, `TrialDrugs`, outcome labels and pool membership.
- Produces:
  - `@dataclass(frozen=True) class LiftResult`, fields:
    - `verdict: Literal["insufficient","chance","clustered"]`
    - `lift: float | None`, `baseline_mean: float | None`, `baseline_range: tuple[float,float] | None`
    - `n_pool: int`, `n_succeeded: int`, `success_rate: float | None`
  - `neighbourhood_lift(matrix, ids, succeeded: Sequence[bool], pool: Sequence[bool], drugs: TrialDrugs, k: int, permutations: int, seed: int, min_successes: int) -> LiftResult`. The algorithm:
    1. Restrict to pool rows.
    2. Compute each row's nearest neighbours (cosine, `NearestNeighbors`), using `k + extra` candidates.
    3. Drop self and any candidate sharing a drug, then keep the first `k`.
    4. Lift = mean over succeeded rows of (succeeded share among kept neighbours) ÷ pool success rate.
    5. Compute the neighbour lists once. For the baseline, permute the `succeeded` vector within the pool `permutations` times (`numpy.random.default_rng(seed)`) and recompute.
    6. Verdict: `insufficient` if `n_succeeded < min_successes`; `chance` if `lo <= lift <= hi`; else `clustered`.

- [ ] **Step 1: Write failing tests.**
  - `test_planted_cluster_is_clustered`: 200 rows; 40 succeeded rows near each other, each with a different drug → `clustered`, lift > 1.5.
  - `test_random_labels_are_chance`: verdict `chance`.
  - `test_same_drug_neighbours_excluded`: succeeded rows that are close only because they share a drug, otherwise spread out → not `clustered`.
  - `test_insufficient_below_min`: 29 successes → `insufficient`, lift None.
  - `test_deterministic_with_seed`
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** `stats.py`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(explorer): neighbourhood lift with permutation baseline`.

### Task 8: Build, export and wire into the pipeline

**Files:**
- Create: `pipeline/src/trialradar/explorer/build.py`
- Modify:
  - `pipeline/src/trialradar/export.py`: `export` gains keyword-only `extras: Mapping[str, StudyExtras] | None = None` and `explorer: dict[str, Any] | None = None`. It writes `explorer.json` when `explorer` is given; trial docs gain `brief_summary`, `eligibility: {sex, min_age_years, max_age_years}` and `has_results` (null/false when extras are absent).
  - `pipeline/src/trialradar/store.py`: `Store.load_explorer_coords() -> dict[str, tuple[float,float,float]]` and `Store.save_explorer_coords(df: pl.DataFrame) -> None` (atomic write of `root/explorer/coords.parquet`; schema `nct_id` Utf8, `x`/`y`/`z` Float64). `wipe()` also removes `explorer/`.
  - `pipeline/src/trialradar/pipeline.py`: in `run` and `rebuild`, compute extras right after `_prepare` and build the explorer in a new `_stage("explorer")` after `_persist`. Pass both to `export`; save coords after export succeeds. In `rebuild`, only the last replayed day builds the explorer.
  - `pipeline/scripts/make_web_fixtures.py`: only if needed; the regeneration is the output.
  - `web/tests/fixtures/data/**`: regenerated.
- Test: `pipeline/tests/unit/test_explorer_build.py`, `pipeline/tests/unit/test_export.py`, `pipeline/tests/integration/test_pipeline.py`

**Interfaces:**
- Consumes: Tasks 1–7.
- Produces:
  - `build_explorer(tables: Tables, extras: Mapping[str, StudyExtras], cfg: AreaConfig, aliases: Mapping[str, str], previous: Mapping[str, tuple[float,float,float]], day: date) -> tuple[dict[str, Any], pl.DataFrame]`. It returns the `explorer.json` document (spec 6.5) and the coords frame.
  - `explorer.json` keys, exactly:
    - Top level: `generated_for`, `method{algorithm,dims,seed,features,k}`, `stats{verdict,lift,baseline_mean,baseline_range,n_pool,n_succeeded,success_rate,by_condition[{label,finished,succeeded}]}`, `trials[]`.
    - Each trial: `nct_id, x, y, z, title, condition_labels, phase, outcome, has_results, treatment_types, drugs, enrollment, lead_sponsor, start_year`. Here `phase` is `top_phase`; `drugs` are the cleaned experimental drugs, sorted; coordinates are rounded to 4 decimals.
  - `by_condition` counts pool trials per config label, in config order.

- [ ] **Step 1: Write failing tests.**
  - `test_build_explorer_contract`: on the integration dataset, the keys equal the spec list, trials are sorted, and every outcome is in the enum.
  - `test_export_trial_doc_has_summary`
  - `test_run_writes_explorer_and_coords`: the integration `Env.run` produces `site/explorer.json` and `store/explorer/coords.parquet`.
  - `test_second_day_is_aligned`: day-2 coords for unchanged trials are within 0.05 of day 1.
  - `test_explorer_failure_is_isolated`: monkeypatch `build_explorer` to raise. The run status is `failed`, the store holds the new data, and the previous site files are unchanged. This mirrors the existing export-failure semantics; reuse that test's pattern.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** `build.py` and the export, store and pipeline changes.
- [ ] **Step 4: Regenerate fixtures** with `cd pipeline && uv run python scripts/make_web_fixtures.py`.
- [ ] **Step 5: Run** all pipeline gates. Expected: PASS, including `test_web_fixtures.py` and `test_config_swap.py`.
- [ ] **Step 6: Run on real data.** Run `uv run trialradar rebuild --raw-dir /tmp/snap --data-dir /tmp/store --site-dir /tmp/site` (`--force` if needed) on the downloaded snapshot. Record the explorer stage duration, `n_pool`, `n_succeeded`, verdict and lift from stderr or `explorer.json` for the PR description.
- [ ] **Step 7: Commit** `feat(explorer): build and export explorer.json, daily alignment`.

### Task 9: Web data layer and pure explorer logic

**Files:**
- Modify: `web/src/types.ts` (add `ExplorerFile`, `ExplorerTrial`, `ExplorerStats`, `Outcome`; extend `TrialFile` with `brief_summary`, `eligibility`, `has_results`), `web/src/data.ts` (`loadExplorer(): Promise<ExplorerFile | null>`)
- Create: `web/src/lib/explorer.ts`
- Test: `web/tests/explorer.test.ts`

**Interfaces:**
- Produces, from `lib/explorer.ts`:
  - `type ColorMode = "outcome" | "phase" | "disease"`
  - `interface Filters { conditions: Set<string>; phases: Set<string>; outcomes: Set<Outcome>; treatmentTypes: Set<string>; query: string }`
  - `allFilters(f: ExplorerFile): Filters`
  - `matches(t: ExplorerTrial, f: Filters): boolean`. The query matches nct_id, title, drugs or sponsor, case-insensitive. A trial with several labels matches if any label is on.
  - `colorFor(t: ExplorerTrial, mode: ColorMode, palette: Palette, conditionOrder: string[]): string`
  - `interface Palette { succeeded: string; stopped: string; completed_unknown: string; running: string; unknown: string; phases: Record<string,string>; diseases: string[] }`
  - `LIGHT_PALETTE`, `DARK_PALETTE`, with values from the mockups.
  - `project(points: {x,y,z}[], angle: number, tilt: number, w: number, h: number, zoom: number): {sx,sy,depth,f}[]`
  - `nearestIndex(projected, x, y, maxPx = 12): number | -1`
  - `liftSentence(s: ExplorerStats): string`, exact copy:
    - insufficient: "Too few successes in this area to measure clustering yet."
    - chance: "Successful trials cluster no more than chance would."
    - clustered: "Successful trials' neighbours succeed {lift}× more often than chance (shuffled: {lo}–{hi}×)." Numbers have 1 decimal.

- [ ] **Step 1: Write failing tests** for `matches` (each filter and the query), `colorFor` (each mode), `project` (the identity case maps the origin to the centre), `nearestIndex` (a miss beyond 12px gives -1) and `liftSentence` (all three verdicts, exact strings).
- [ ] **Step 2: Run** `cd web && npx vitest run tests/explorer.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the code.
- [ ] **Step 4: Run.** Expected: PASS. Then run `npx tsc --noEmit`.
- [ ] **Step 5: Commit** `feat(web): explorer types, loader and pure logic`.

### Task 10: Explore page shell and the 3D canvas (panel a)

Before writing UI, write the Impeccable direction contract.
- Run `"<impeccable>/scripts/impeccable" surface-brief write web/src/components/explore/Explore.tsx <body-file>`.
- The body has the six blocks THESIS, OWN-WORLD, STORY, FIRST VIEWPORT, FORM, FINISH, as in Impeccable `reference/new-work.md` section 5.
- FORM: `seed:60730230eacb10e5`, "IMPECCABLE'S PICK, The Figure Plate".
- Read `reference/craft-floor.md` before the first UI edit.

**Files:**
- Create: `web/src/components/explore/Explore.tsx`, `web/src/components/explore/PlateCanvas.tsx`, `web/src/components/explore/explore.css`
- Modify:
  - `web/src/App.tsx`: route `/explore`; `/` and `*` redirect to `/explore`; nav order Explore, Changes, Trials, Methods; the brand links to `/explore`.
  - `web/src/main.tsx`: import `@fontsource/hanken-grotesk/{400,500,700,800}.css`.
  - `web/package.json`: add `@fontsource/hanken-grotesk`.
- Test: `web/tests/Explore.test.tsx`

**Interfaces:**
- Consumes: `loadExplorer`, `loadMeta`, `lib/explorer`.
- Produces:
  - `<PlateCanvas trials={ExplorerTrial[]} visible={(t)=>boolean} color={(t)=>string} selected={string|null} onSelect={(nct: string|null)=>void} reducedMotion={boolean} />`
    - It auto-rotates unless `reducedMotion`, drags to rotate, and clicks or taps to select.
    - Filtered-out dots draw at 0.08 alpha. Dot radius = (1.6 + sqrt(enrollment)/7) × perspective.
    - It has an accessible name, "3D map of N trials".
    - If `getContext` returns null, it renders a fallback paragraph linking to `#/trials`.
  - Dark mode via `@media (prefers-color-scheme: dark)` tokens in `explore.css`, plus `DARK_PALETTE` for the canvas.
  - A visually hidden summary next to the canvas ("N trials; X succeeded, Y stopped early…"), updated with the filters.
  - `Explore` owns `Filters`, `ColorMode` and `selected`, and lays out the plate grid as in the mockup (title row; panel a spans two rows on the left; b and c on the right; legend bar below).
- States:
  - Loading: a skeleton plate.
  - Missing file: "The map appears after the next daily update." with a link to Trials.
  - Zero matches: "No trials match these filters." plus a Reset button.

- [ ] **Step 1: Write failing tests.**
  - `renders figure title from meta area`: the title contains "Figure 1 |".
  - `missing explorer shows explanation`
  - `zero matches shows reset and reset restores`
  - `canvas fallback when no 2d context`: jsdom returns null from getContext.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** the code. The draw loop uses `requestAnimationFrame` and is cancelled on unmount. Depth-sort each frame. Read reduced motion from `matchMedia('(prefers-reduced-motion: reduce)')`.
- [ ] **Step 4: Run** `npx vitest run && npm run lint && npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Look at it.**
  - `npm run build && cp -r tests/fixtures/data dist/data && npx vite preview`.
  - Screenshot `#/explore` at 1440×900 and 375×812 with Playwright or headless Chrome. Compare against `model-pick.html`: composition, title, panel letters, colours.
- [ ] **Step 6: Commit** `feat(web): explore route and 3D plate canvas`.

### Task 11: Panels b, c, legend bar and selected trial (d)

**Files:**
- Create: `web/src/components/explore/PanelSuccess.tsx`, `PanelPhase.tsx`, `LegendBar.tsx`, `SelectedTrial.tsx`
- Modify: `web/src/components/explore/Explore.tsx`, `explore.css`
- Test: `web/tests/ExplorePanels.test.tsx`

**Interfaces:**
- Consumes: `ExplorerStats`, `liftSentence`, `Filters`, `loadTrial`.
- Produces:
  - **`PanelSuccess` (b):** one bar per `by_condition` row, width succeeded/finished, with an average tick at `success_rate`. Under the bars: `liftSentence(stats)`, then "Succeeded = drug moved to a later phase. How this is measured" linking to `#/methods#map`.
  - **`PanelPhase` (c):** counts per `phase` over visible trials, with the succeeded share highlighted in the accent colour.
  - **`LegendBar`:**
    - Colour toggle (Outcome / Phase / Disease) as `aria-pressed` buttons.
    - Toggles for disease labels, phases, outcomes (with text labels and counts) and treatment types.
    - A search input with label "Find a trial".
    - A visible count: "Showing N of M trials".
    - A "View as list" link to `#/trials`.
  - **`SelectedTrial` (d):**
    - The one-line facts: nct · drugs · phase · outcome label text · enrollment · sponsor.
    - The first two sentences of `brief_summary`, lazy-loaded via `loadTrial` and labelled "From the registry".
    - Links: "Trial page" (`#/trial/:nct`) and "ClinicalTrials.gov".
    - An `aria-live="polite"` region.

- [ ] **Step 1: Write failing tests.**
  - `success panel shows lift sentence and definition link`
  - `toggling a disease updates the visible count`
  - `search narrows to matching drug`
  - `selecting a trial loads its summary`: mock `loadTrial`.
  - `outcome legend shows text labels not only colour`
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** the code.
- [ ] **Step 4: Run** the web gates. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): plate panels, legend filters and selected trial`.

### Task 12: Trial detail summary and the Methods map section

**Files:**
- Modify: `web/src/components/TrialDetail.tsx`, `web/src/components/Methods.tsx`, `web/src/styles.css` (only what these need)
- Test: `web/tests/TrialDetail.test.tsx`, `web/tests/Methods.test.tsx`

**Interfaces:**
- **TrialDetail:** a "Summary" section, captioned "From the registry", showing `brief_summary`. It also shows "Eligibility: {sex}, {min}–{max} years" (omitting unknown parts) and "Results posted" with a link to `source_url + "#results"` when `has_results`.
- **Methods:** a section with `id="map"` headed "How the map is made". It covers, in plain language:
  - Which four feature groups are used and which fields are excluded.
  - UMAP in 3D and the daily alignment.
  - The exact success definition, with its three limits (spec 6.3).
  - The neighbourhood statistic: same-drug neighbours are excluded, and why.

- [ ] **Step 1: Write failing tests.**
  - `trial detail shows registry summary and eligibility`
  - `results link shown only when has_results`
  - `methods has map section with success definition`
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** the code.
- [ ] **Step 4: Run** the web gates. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): registry summaries on trial pages and map methods`.

### Task 13: End-to-end, responsive, reduced motion

**Files:**
- Modify: `web/e2e/smoke.spec.ts`
- Test: same file

- [ ] **Step 1: Write the failing e2e tests.**
  - Update `feed -> trial -> methods`: `/` now redirects to `#/explore`; navigate to Changes via the nav first.
  - `explore selects a trial and opens its page`: click the canvas centre, retrying positions until the selected-trial panel shows an NCT id, then follow "Trial page".
  - `explore filters change count`
  - Add `#/explore` to `no horizontal scroll`.
  - `reduced motion keeps the map still`: with `page.emulateMedia({reducedMotion:"reduce"})`, two canvas screenshots 500 ms apart are identical.
- [ ] **Step 2: Run** `npm run e2e`. Expected: the new tests FAIL until the fixes are in.
- [ ] **Step 3: Fix** whatever the e2e tests surface.
- [ ] **Step 4: Run** `npm run e2e`. Expected: all pass at desktop and 375px.
- [ ] **Step 5: Commit** `test(web): explore e2e, phone width and reduced motion`.

### Task 14: Finish review, design record and docs

**Files:**
- Create: `DESIGN.md` (plus its sidecar), via the `impeccable:impeccable-documenter` agent
- Modify: `README.md` (home page and explorer, honest limits), `docs/architecture.md` (explorer stage in the diagram), `docs/superpowers/HANDOFF.md` (section 6 resolved; new state), `.gitignore` (ignore `.impeccable/mocks/` and `.impeccable/review/` if they don't ignore themselves)

- [ ] **Step 1: Run the detector.** Run `"<impeccable>/scripts/impeccable" detect --json web/src/components/explore web/src/components/TrialDetail.tsx web/src/components/Methods.tsx` and fix the findings.
- [ ] **Step 2: Capture screenshots.** Take `desktop.png` (1440 wide) and `mobile.png` (390 wide) of `#/explore`, light and dark, into `.impeccable/review/`.
- [ ] **Step 3: Finish review.** Dispatch `impeccable:impeccable-finish-reviewer` with the surface brief, `model-pick.html` and the screenshots. Fix the material findings, then recapture once.
- [ ] **Step 4: Design record.** Dispatch `impeccable:impeccable-documenter` to write `DESIGN.md` from the shipped build.
- [ ] **Step 5: Update docs.** Update the README, architecture and HANDOFF. The README states the success proxy and its limits and calls the pathway graph "coming next".
- [ ] **Step 6: Run** all gates (pipeline, web, e2e). Expected: PASS.
- [ ] **Step 7: Commit** `docs: explorer design record, README and handoff`.
- [ ] **Step 8: Offer the PR.** Ask Martin whether to open the PR. Don't open it unasked.
