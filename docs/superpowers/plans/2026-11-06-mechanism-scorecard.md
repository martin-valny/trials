# Mechanism × Disease Scorecard Implementation Plan

> **Superseded 2026-11-08** by `docs/superpowers/specs/2026-11-08-front-door-pipeline-design.md` §13. Task 1 (R21) is done; do not execute Tasks 2+.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/scorecard` page that shows, for every mechanism class × disease, how its trials went (phases, outcomes, stop reasons, disease-specific success, approval, genetics, crowding), with every number linked to its trials; plus the disease-specific success rule (R21) applied site-wide.

**Architecture:** Task 1 changes the success rule in the existing explorer stage and exports two per-trial fields the scorecard reuses. Two hand-run scripts write committed reference files (`indications.csv`, `genetics.csv`). A new pipeline stage `scorecard` aggregates the explorer document, the trial table and the reference files into `scorecard.json`; it never fails the run (R19). The web adds a pure `lib/scorecard.ts` and a Figure 3 page (grid + cell panel).

**Tech Stack:** Python 3.12, uv, polars, pytest, strict mypy, ruff; React 19 + TypeScript strict, vitest + Testing Library, Playwright. No new dependencies (HTTP in scripts uses the stdlib or what `map_mechanisms.py` already uses).

**Spec:** `docs/superpowers/specs/2026-11-06-mechanism-scorecard-design.md` (approved). Parent spec: `docs/superpowers/specs/2026-11-06-mechanisms-and-graph-design.md`.

## Prerequisites (do not start Task 2+ before these exist)

- The map-usability plan (`2026-11-06-phase1-map-usability.md`) is merged into `feat/explorer-figure-plate`.
- The mechanisms spec **phase 2** is built and merged: `config/mechanisms/{drugs.csv,overrides.csv,README.md}`, `pipeline/scripts/map_mechanisms.py`, per-trial `mechanisms`, `targets`, `modalities` in `explorer.json`, `ExplorerConfig.min_group` (default 10).
- The mechanisms spec **phase 3** (graph, `/mechanisms`) is built and merged (Martin: graph first).
- **Before Task 2, the executor re-reads the as-built phase 2 code** and corrects the "Consumes (phase 2)" names below if they differ (loader name, field names). This is the only place this plan guesses.

Task 1 depends only on the map-usability merge and may run before phase 2 if Martin asks.

## Global Constraints

- $0, no server, no secrets; the daily run never calls an outside service. Scripts that call ChEMBL / Open Targets run by hand and write committed files.
- Tests are offline: script tests use recorded HTTP fixtures; pipeline and web tests use small committed reference fixtures.
- New area = config only: no source file names a condition (existing test).
- Never commit real trial data. Reference files about drugs/targets are committed.
- R19: any scorecard failure → run warning `scorecard: <Exc>: <msg>`, no `scorecard.json` (a stale one removed), the page says "The scorecard appears after the next daily update." The run continues.
- R15: red (`--red`) only for succeeded trials. Premium design bar: Figure Plate tokens (`--ink --muted --rule --red --pale --plate`, Hanken Grotesk), no cards/gradients/glows/emoji, use `impeccable:impeccable` for UI tasks.
- `min_group` = 10 (from `ExplorerConfig.min_group`); below it the rate is `null` and the page says "too few to tell (n finished; needs ≥10)".
- Licences shown on the page and Methods: ChEMBL CC BY-SA 3.0, Open Targets CC0.
- Gates per task: `cd pipeline && uv run pytest -q && uv run ruff check . && uv run ruff format --check . && uv run mypy src scripts`; `cd web && npx vitest run && npm run lint && npx tsc --noEmit`; e2e: `cd web && npm run build && cp -r tests/fixtures/data dist/data && PW_CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run e2e`.
- After changing explorer/export output: `cd pipeline && uv run python scripts/make_web_fixtures.py`, commit the fixtures.
- Commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push (Martin pushes).

## Review Focus

1. **A trial with no disease label** can never succeed under R21 (nothing to share); it must not crash and must not appear in any scorecard cell. Test in Task 1 and Task 5.
2. **A trial with two mechanisms and two labels** appears in up to four cells; `succeeded` counts only in the cells of labels where the progression happened. Test in Task 5.
3. **Reference files missing or malformed** (`indications.csv`, `genetics.csv`, `stop_reasons.yaml`): the scorecard still builds without that part (approval/genetics shown as "not available"), with a `scorecard_reference:` warning; only an exception in aggregation drops the whole file. Test in Tasks 3, 4, 6.
4. **Explorer insufficient (fewer than 4 trials, empty `trials` list) or missing:** `scorecard.json` is written with empty `cells`, and the page shows an empty state, not an error. Test in Task 6 and Task 8.
5. **Long mechanism/disease names and many mechanisms at 375px:** the grid scrolls inside its own container, the page never scrolls horizontally. Test in Task 8 (e2e).

---

### Task 1: Disease-specific success (R21) and two per-trial fields — done in phase 2 plan Task 1

**Files:**
- Modify: `pipeline/src/trialradar/explorer/outcomes.py` (`label_outcomes`, `_label`)
- Modify: `pipeline/src/trialradar/explorer/build.py` (pass labels; `by_condition`; trial dict)
- Modify: `web/src/types.ts` (`ExplorerTrial`), `web/tests/explorer.test.ts` (factory)
- Test: `pipeline/tests/unit/test_explorer_outcomes.py`, `pipeline/tests/unit/test_explorer_build.py`
- Regenerate: `web/tests/fixtures/data/*`
- Docs: `docs/superpowers/HANDOFF.md` section 6 (add R21), `web/src/components/Methods.tsx` (success definition sentence), `README.md` if it states the definition

**Interfaces:**
- Produces:
  - `TrialLabels = dict[str, frozenset[str]]` (nct_id → condition labels) in `outcomes.py`
  - `success_labels(trial: pl.DataFrame, drugs: TrialDrugs, labels: TrialLabels) -> dict[str, frozenset[str]]` — for each completed, eligible trial, the labels in which one of its drugs later progressed; empty for every other trial.
  - `label_outcomes(trial, drugs, labels: TrialLabels) -> dict[str, Outcome]` — new required `labels` parameter; `"succeeded"` iff `success_labels` is non-empty, other buckets unchanged.
  - `explorer.json` trials gain `succeeded_in: string[]` (sorted) and `in_pool: boolean`. `ExplorerTrial` gains the same.
  - `by_condition[label].succeeded` counts pool trials whose `succeeded_in` contains that label.

Rule (R21): trial T (completed, can succeed, dated, ranked) succeeded in label L iff L ∈ labels(T) and some drug d of T has a later trial U (start(U) > start(T), rank(U) > rank(T), status(U) ≠ WITHDRAWN, L ∈ labels(U)), **and** d had no trial V with rank(V) ≥ PHASE3, start(V) < start(T) and L ∈ labels(V). The late-phase block is per label too (planner's call: "already late in this disease" is what blocks; flag in the review).

- [x] **Step 1: Update existing tests** in `test_explorer_outcomes.py`: `_trial` rows keep their shape; every `label_outcomes(t, drugs)` call becomes `label_outcomes(t, drugs, _labels(t, "MS"))` where `_labels` gives every trial `{"MS"}`. All existing assertions stay as they are.
- [x] **Step 2: Write failing tests:**

```python
def test_progression_in_other_disease_does_not_count() -> None:
    t = _trial([("A", ["PHASE2"], "COMPLETED", date(2015, 1, 1)),
                ("B", ["PHASE3"], "RECRUITING", date(2018, 1, 1))])
    out = label_outcomes(t, {"A": _fs("x"), "B": _fs("x")}, {"A": _fs("CIDP"), "B": _fs("MG")})
    assert out["A"] == "completed_unknown"

def test_multi_label_trial_succeeds_only_where_progressed() -> None:
    t = _trial([("A", ["PHASE2"], "COMPLETED", date(2015, 1, 1)),
                ("B", ["PHASE3"], "RECRUITING", date(2018, 1, 1))])
    sl = success_labels(t, {"A": _fs("x"), "B": _fs("x")}, {"A": _fs("MG", "CIDP"), "B": _fs("MG")})
    assert sl["A"] == _fs("MG")
    assert label_outcomes(t, {"A": _fs("x"), "B": _fs("x")}, {"A": _fs("MG", "CIDP"), "B": _fs("MG")})["A"] == "succeeded"

def test_late_phase_block_is_per_disease() -> None:
    # x already in Phase 3 for MS before A starts; A (CIDP Ph2) then x goes to Ph3 in CIDP -> succeeded
    t = _trial([("V", ["PHASE3"], "COMPLETED", date(2010, 1, 1)),
                ("A", ["PHASE2"], "COMPLETED", date(2015, 1, 1)),
                ("B", ["PHASE3"], "RECRUITING", date(2018, 1, 1))])
    out = label_outcomes(t, {k: _fs("x") for k in "VAB"}, {"V": _fs("MS"), "A": _fs("CIDP"), "B": _fs("CIDP")})
    assert out["A"] == "succeeded"

def test_unlabelled_trial_never_succeeds() -> None:
    t = _trial([("A", ["PHASE2"], "COMPLETED", date(2015, 1, 1)),
                ("B", ["PHASE3"], "RECRUITING", date(2018, 1, 1))])
    out = label_outcomes(t, {"A": _fs("x"), "B": _fs("x")}, {"A": _fs(), "B": _fs("MS")})
    assert out["A"] == "completed_unknown"
```
In `test_explorer_build.py`: add `"succeeded_in"`, `"in_pool"` to the expected key set; assert `by_condition` succeeded counts equal the number of pool trials whose `succeeded_in` contains the label.

- [x] **Step 3: Run** `cd pipeline && uv run pytest tests/unit/test_explorer_outcomes.py tests/unit/test_explorer_build.py -q` — expect FAIL (signature, missing keys).
- [x] **Step 4: Implement** `success_labels` and the new `label_outcomes` signature. The drug index entries gain the trial's label set: `(rank, start, status, labels)`. In `build.py` build `labels = {n: frozenset(full[n].condition_labels) for n in ids}`, pass it, compute `succeeded_in = success_labels(...)`, use it for `by_condition`, and add `succeeded_in` / `in_pool` to each trial dict. `neighbourhood_lift` keeps receiving `succeeded = outcome == "succeeded"`.
- [x] **Step 5: Run** the two test files — PASS. Regenerate fixtures; run the full pipeline gate.
- [x] **Step 6:** `types.ts` + test factory; web gate passes (map panels need no change: they read `outcome` and `stats`).
- [x] **Step 7: Docs.** HANDOFF section 6 gains R21 (text from spec 5.4) and marks the 2026-11-05 result "before R21, re-measure"; Methods' success sentence says "a later, higher-phase trial of the same drug **in the same disease**".
- [x] **Step 8: Real-data re-measure** (Martin's Mac, recipe in HANDOFF 00): rebuild the site from the snapshot, record pool, succeeded, rate, lift, baseline range and p-value in HANDOFF section 6 as a dated observation; if the verdict wording on Explore changes, screenshot it.
- [x] **Step 9: Commit** `feat(explorer): success counts only progression in the same disease (R21)`.

---

### Task 2: Stop-reason categories

**Files:**
- Create: `config/stop_reasons.yaml`, `pipeline/src/trialradar/scorecard/__init__.py`, `pipeline/src/trialradar/scorecard/stop_reasons.py`
- Modify: `pipeline/src/trialradar/config.py` (load path only if config loading is centralised there; otherwise the loader lives in `stop_reasons.py`)
- Test: `pipeline/tests/unit/test_scorecard_stop_reasons.py`

**Interfaces:**
- Produces: `StopReason = Literal["enrollment", "efficacy", "safety", "business", "covid", "other", "not_given"]`; `StopRules` (ordered list of `(category, compiled pattern)`); `load_stop_rules(path: Path) -> StopRules` (raises `ValueError` on unknown category or empty file); `classify_stop(why_stopped: str | None, rules: StopRules) -> StopReason`.

File format (rule order = priority, first match wins; case-insensitive, word-boundary regexes):
```yaml
rules:
  - category: covid
    patterns: ["covid", "sars-cov-2", "pandemic"]
  - category: safety
    patterns: ["safety", "adverse", "toxicit", "death"]
  - category: efficacy
    patterns: ["futility", "efficacy", "lack of (benefit|effect)", "primary endpoint not met"]
  - category: enrollment
    patterns: ["recruit", "enrol", "accrual"]
  - category: business
    patterns: ["business", "sponsor decision", "strategic", "commercial", "funding", "portfolio"]
```
(Starting keywords; the executor may extend them with the test examples.)

- [ ] **Step 1: Failing tests:** `classify_stop(None) == "not_given"`, `("") == "not_given"`, `"Slow recruitment" → enrollment`, `"Low accrual" → enrollment`, `"Futility at interim analysis" → efficacy`, `"Sponsor decision" → business`, `"Business reasons" → business`, `"COVID-19 pandemic halted enrollment" → covid` (covid before enrollment), `"Safety concerns" → safety`, `"PI left the institution" → other`; `load_stop_rules` raises on `category: weather`.
- [ ] **Step 2: Run** `uv run pytest tests/unit/test_scorecard_stop_reasons.py -q` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS; pipeline gate.
- [ ] **Step 5: Commit** `feat(scorecard): sort stop reasons by reviewable keyword rules`.

---

### Task 3: Indications — "approved for this disease" (broad)

**Files:**
- Modify: `pipeline/scripts/map_mechanisms.py` (new step after `drugs.csv`)
- Create: `config/mechanisms/indications.csv` (real output, committed after Martin reviews it), `pipeline/src/trialradar/scorecard/references.py`
- Modify: `config/mechanisms/README.md` (source, ChEMBL release, date, licence)
- Test: `pipeline/tests/unit/test_scorecard_references.py`, the mapping script's test file (recorded fixtures under `pipeline/tests/fixtures/http/chembl/`)

**Interfaces:**
- Consumes (phase 2, verify names): `map_mechanisms.py`'s ChEMBL client and its target + action-type → `mechanism_class` derivation; `overrides.csv` precedence; the area's condition terms from `AreaConfig.conditions` (label + terms).
- Produces:
  - `indications.csv` columns exactly: `mechanism_class,disease_label,drug,chembl_id,max_phase_for_indication,in_trials,source`
  - `Indication` (frozen dataclass with those fields; `max_phase_for_indication: int`, `in_trials: bool`)
  - `load_indications(path: Path, warnings: list[str]) -> dict[tuple[str, str], list[Indication]]` keyed by `(mechanism_class, disease_label)`; missing/invalid file → `{}` and a `scorecard_reference: indications: <reason>` warning.

Script step: for each mapped target + action type → ChEMBL `mechanism` filtered by `target_chembl_id` → molecules → `drug_indication` rows; an indication matches a disease label when its MeSH heading or EFO term casefold-contains one of that label's condition terms; keep the highest `max_phase_for_ind` per (molecule, label); `in_trials` = the molecule's preferred name or a synonym is in `drugs.csv`. Print a review table: per mechanism class × label, the approved drugs.

- [ ] **Step 1: Failing tests** (references): a 3-row fixture CSV loads into the expected dict; a file with a missing column yields `{}` and one warning containing `indications`; a missing file yields `{}` and one warning. Script test: with recorded fixtures for one target (e.g. FCGRT → efgartigimod with an MG indication at phase 4), the step writes one row `FcRn blocker,MG,efgartigimod alfa,<id>,4,true,chembl`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** the loader and the script step (record the fixtures once with the script's existing recording helper).
- [ ] **Step 4: Run** — PASS; pipeline gate.
- [ ] **Step 5: Real run** on Martin's Mac; Martin reviews the printed table; commit `indications.csv` + README.
- [ ] **Step 6: Commit** `feat(scorecard): approved-for-disease per mechanism from ChEMBL indications`.

---

### Task 4: Genetics from Open Targets

**Files:**
- Create: `pipeline/scripts/fetch_genetics.py`, `config/mechanisms/genetics.csv` (real output, committed after review)
- Modify: `config/area.yaml` (new block), `pipeline/src/trialradar/config.py` (`ScorecardConfig`), `pipeline/src/trialradar/scorecard/references.py`, `config/mechanisms/README.md`
- Test: `pipeline/tests/unit/test_scorecard_references.py`, `pipeline/tests/unit/test_fetch_genetics.py` (recorded fixtures under `pipeline/tests/fixtures/http/opentargets/`), the config tests

**Interfaces:**
- Produces:
  - `config/area.yaml`:
    ```yaml
    scorecard:
      efo:            # disease label -> Open Targets disease id(s)
        MS: ["EFO_0003885"]
    ```
    (the executor fills the other labels from the Open Targets search and lists them in the PR; a label with no id is allowed and shows "not available").
  - `ScorecardConfig(efo: dict[str, list[str]])` on `AreaConfig.scorecard`; validation: every key is an existing condition label.
  - `genetics.csv` columns exactly: `target,disease_label,ot_score,ot_genetic_score,release` (scores as floats in [0,1]; the max over the label's EFO ids).
  - `GeneticEvidence` dataclass; `load_genetics(path: Path, warnings: list[str]) -> dict[tuple[str, str], GeneticEvidence]` keyed by `(target, disease_label)`; same failure behaviour as `load_indications`.
- Script: targets from `drugs.csv` (gene symbols) → Ensembl ids via Open Targets search → `associatedDiseases` scores (overall + `genetic_association` datatype) for the label's EFO ids. GraphQL vs Parquet is the executor's choice (spec section 10). A pair with no association is **not written** (shown as "none recorded").

- [ ] **Step 1: Failing tests:** config rejects `scorecard.efo` with an unknown label; loader as in Task 3; script on recorded fixtures for MS4A1 × MS writes one row with both scores; a target with no association writes no row.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS; pipeline gate (config-swap test still green: no condition names in source).
- [ ] **Step 5: Real run**; Martin reviews; commit `genetics.csv` + README.
- [ ] **Step 6: Commit** `feat(scorecard): Open Targets genetic evidence per target and disease`.

---

### Task 5: Scorecard aggregation

**Files:**
- Create: `pipeline/src/trialradar/scorecard/build.py`
- Test: `pipeline/tests/unit/test_scorecard_build.py`

**Interfaces:**
- Consumes: explorer trial dicts (Task 1 fields `succeeded_in`, `in_pool`; phase 2 fields `mechanisms`, `targets`, `modalities`; existing `condition_labels`, `drugs`, `lead_sponsor`, `start_year`); the `trial` table columns `nct_id, phases, overall_status, why_stopped, start_date`; `has_results` from the explorer trial; Task 2 `classify_stop`; Task 3/4 dicts.
- Produces: `build_scorecard(explorer_trials: Sequence[Mapping[str, Any]], trial: pl.DataFrame, rules: StopRules, indications: Mapping[tuple[str, str], list[Indication]], genetics: Mapping[tuple[str, str], GeneticEvidence], min_group: int, labels: Sequence[str], day: date) -> dict[str, Any]` returning the `scorecard.json` document:

```
{ generated_for, min_group, coverage: {drug_trials, mapped_trials},
  diseases: [label...],                      # config order
  mechanisms: [class...],                     # by n_trials desc, "__unmapped__" last
  cells: [ { mechanism, disease, n_trials, n_drugs, n_sponsors,
             phases: {early1,p1,p2,p3,p4,na},
             outcomes: {completed_results, completed_no_results, terminated, withdrawn, suspended, running, unknown},
             stop_reasons: {enrollment, efficacy, safety, business, covid, other, not_given},
             pool_finished, pool_succeeded, success_rate,      # null if pool_finished < min_group
             running_now, started_last_2y,
             by_modality: {<modality>: {n_trials, running_now}},
             approved: [{drug, chembl_id, in_trials}], max_phase_for_disease,  # from indications
             genetics: [{target, ot_score, ot_genetic_score}],  # only targets with a row
             targets_without_genetics: [target],
             trials: [nct_id] } ] }
```
Rules: only drug-bearing trials; a trial with drugs but no mechanism goes to `__unmapped__`; a trial is in every (mechanism, label) pair it has; `pool_succeeded` counts it only if the cell's label ∈ `succeeded_in`; phases bucket = top phase; `running_now` = status in the explorer's running set; `started_last_2y` = start year ≥ `day.year - 1`; stop reasons only for terminated/withdrawn/suspended; `max_phase_for_disease` = max over `approved` rows' phase (or null); cells with zero trials are omitted; `trials` sorted.

- [ ] **Step 1: Failing tests** on a synthetic set of ~8 trial dicts + table:
  - two-mechanism, two-label trial appears in 4 cells; `pool_succeeded` = 1 only in the label in its `succeeded_in`;
  - unlabelled drug trial appears in no cell; drug-free trial appears nowhere; unmapped-drug trial appears under `__unmapped__`;
  - `success_rate is None` when `pool_finished == 9` with `min_group=10`, and `== 3/10` at 10 finished, 3 succeeded;
  - stop reasons count `"Slow recruitment"` under enrollment, and a COMPLETED trial's `why_stopped` is ignored;
  - `approved` lists an indication row with `in_trials=False`; missing indications/genetics give `approved == []`, `genetics == []`;
  - `coverage` counts; mechanisms ordering with `__unmapped__` last.
- [ ] **Step 2: Run** `uv run pytest tests/unit/test_scorecard_build.py -q` — FAIL.
- [ ] **Step 3: Implement** (polars or plain dicts; ~3k trials, plain Python is fine).
- [ ] **Step 4: Run** — PASS; pipeline gate.
- [ ] **Step 5: Commit** `feat(scorecard): aggregate mechanism x disease cells`.

---

### Task 6: Pipeline stage, export and fixtures

**Files:**
- Modify: `pipeline/src/trialradar/pipeline.py` (new `_scorecard(...)` after `_explorer`), `pipeline/src/trialradar/export.py` (write/remove `scorecard.json`, mirroring `explorer.json`), `pipeline/scripts/make_web_fixtures.py` (small committed reference fixtures so `scorecard.json` has a few cells)
- Create: `pipeline/tests/fixtures/references/{indications.csv,genetics.csv}` if the fixture script needs its own copies
- Test: `pipeline/tests/unit/test_pipeline*.py` / `test_export.py` (whichever cover `_explorer` and explorer export today), fixture staleness test
- Regenerate: `web/tests/fixtures/data/scorecard.json`

**Interfaces:**
- Consumes: Task 5 `build_scorecard`; Task 2–4 loaders; the explorer doc from `_explorer` (`None` when the explorer failed).
- Produces: `_scorecard(explorer_doc: dict[str, Any] | None, tables: Tables, cfg: AreaConfig, config_dir: Path, day: date) -> tuple[dict[str, Any] | None, list[str]]`; `export(..., scorecard: dict[str, Any] | None)` writes `scorecard.json` or removes a stale one.

- [ ] **Step 1: Failing tests:** consistency on the 14-trial integration set — for single-mechanism, single-label trials (unmapped row included), the sum over a disease's cells of `pool_finished` / `pool_succeeded` equals that disease's `by_condition` `finished` / `succeeded` restricted to the same trials; explorer doc `None` → scorecard `None`, warning `scorecard: explorer unavailable`, no file, stale file removed; `build_scorecard` raising → `scorecard: <Exc>: <msg>` warning, run status still success; missing `indications.csv` → file written, one `scorecard_reference:` warning; explorer with empty `trials` → file written with `cells == []`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**; extend `make_web_fixtures.py`; regenerate fixtures.
- [ ] **Step 4: Run** full pipeline gate (fixture staleness passes).
- [ ] **Step 5: Commit** `feat(scorecard): pipeline stage and scorecard.json export`.

---

### Task 7: Web types and pure logic

**Files:**
- Modify: `web/src/types.ts` (`Scorecard`, `ScorecardCell`), `web/src/data.ts` (loader mirroring the explorer one: missing file → `null`)
- Create: `web/src/lib/scorecard.ts`
- Test: `web/tests/scorecard.test.ts`

**Interfaces:**
- Produces (`lib/scorecard.ts`):
  - `type GridFilter = { modalities: Set<string> | "all"; runningOnly: boolean }`
  - `cellCount(cell: ScorecardCell, f: GridFilter): number` — `n_trials` or `running_now` when `f` is "all"; otherwise the sum over selected `by_modality` entries.
  - `gridRows(sc: Scorecard, f: GridFilter, topN: number): { shown: string[]; collapsed: string[] }` — mechanisms with any non-zero count, by count desc, `__unmapped__` always last and always shown; beyond `topN` go to `collapsed`.
  - `findCell(sc: Scorecard, mechanism: string, disease: string): ScorecardCell | null` (missing = zero).
  - `rateText(cell: ScorecardCell, minGroup: number): string` — `"30% (3 of 10)"` or `"too few to tell (9 finished; needs ≥10)"`.
  - `mechanismLabel(m: string): string` — `"__unmapped__"` → `"Unmapped drugs"`.
- [ ] **Step 1: Failing tests** for each function, including: modality filter excluding every modality of a cell gives 0; `__unmapped__` shown even when `topN` is 1; `rateText` both branches with the exact copy above.
- [ ] **Step 2: Run** `cd web && npx vitest run tests/scorecard.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS; web gate.
- [ ] **Step 5: Commit** `feat(web): scorecard types, loader and grid logic`.

---

### Task 8: `/scorecard` page — landscape grid (panel a)

**Files:**
- Create: `web/src/components/scorecard/{Scorecard.tsx,ScorecardGrid.tsx,scorecard.css}`
- Modify: `web/src/App.tsx` (route `/scorecard`, NavLink "Scorecard" after "Explore"), `DESIGN.md` (grid pattern)
- Test: `web/tests/Scorecard.test.tsx`, `web/e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: Task 7 functions; `GridFilter`.
- Produces: `<Scorecard />` page holding `{selected: {mechanism, disease} | null, filter: GridFilter}`; `<ScorecardGrid sc filter selected onSelect />`.

Grid per spec 6a: a `<table>` (rows mechanisms, columns diseases in config order), each cell a `<button>` with an accessible name like `"anti-CD20 × MS: 41 trials"`; outcome mark: finished in ink, running outline, succeeded red (R15); zero cells a quiet dot with name `"FcRn blocker × MS: no trials"`. Above: coverage line ("Mechanism known for N% of drug trials"), modality filter (reuse the map's `MultiSelect` from the map-usability work), "Running only" switch, "Show N more mechanisms" button for `collapsed`. Empty/missing states: missing file → "The scorecard appears after the next daily update."; `cells == []` → "No drug trials to score yet."

- [ ] **Step 1: Failing component tests:** renders a button named `/anti-CD20 × MS: \d+ trials/` from fixtures; clicking it calls `onSelect`; "Running only" changes the number in the name; missing scorecard shows the update message; empty cells show the empty message.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** with `impeccable:impeccable` inside the Figure Plate system; record the grid pattern in `DESIGN.md`.
- [ ] **Step 4: e2e** `test("scorecard grid at desktop and 375px")`: page loads, a cell is clickable, no horizontal page scroll at 375px (grid scrolls in its own container).
- [ ] **Step 5: Run** web gate + e2e — PASS.
- [ ] **Step 6: Commit** `feat(web): scorecard landscape grid`.

---

### Task 9: Cell panel (panel b), links, Methods

**Files:**
- Create: `web/src/components/scorecard/CellPanel.tsx`
- Modify: `Scorecard.tsx`, `scorecard.css`, `web/src/components/Methods.tsx`, the Explore filter model only if "Show on the map" needs an exact trial-list filter (builder's call per the builder check), the graph page's focus entry point if it exists
- Test: `web/tests/CellPanel.test.tsx`, `web/e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: `findCell`, `rateText`, `mechanismLabel`; routes `/trial/:nct`, `/explore`, `/mechanisms`.

Panel content and order exactly as spec 6b: title `"<mechanism> × <disease>"` + `"n trials · n drugs · n sponsors"`; How far it got; approved for this disease (drug names, "(not in tracked trials)" when `in_trials` false, source "ChEMBL, any regulator"); How they ended; Why stopped ("the trial's own stated reason"); Success rate via `rateText`; Right now (running, started in the last 2 years); Genetics per target (`"none recorded"` for `targets_without_genetics`; "not available" when the reference file was missing); Same mechanism elsewhere (the row's other diseases with counts and approval); Trials (links). A note: "Filters change the grid only; this panel shows every trial in the cell." and "Trials with several mechanisms or diseases count in each." Escape closes; bottom sheet at 375px. Methods gains: counting rules, R21, stop-reason rules (rendered from a short list kept in sync by a test against `config/stop_reasons.yaml` categories), sources and licences, what the scorecard cannot say.

- [ ] **Step 1: Failing tests:** panel shows `"too few to tell (2 finished; needs ≥10)"` for a small fixture cell; approval row shows a drug with "(not in tracked trials)"; every trial id is a link to `#/trial/<id>`; Escape closes and returns focus to the grid cell; "Same mechanism elsewhere" lists the other diseases.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** (impeccable; Figure Plate).
- [ ] **Step 4: e2e:** open a cell, follow a trial link, back; 375px bottom sheet visible and closable.
- [ ] **Step 5: Run** web gate + e2e — PASS.
- [ ] **Step 6: Commit** `feat(web): scorecard cell panel and methods`.

---

### Task 10: Finish — design review, real data, docs

**Files:** `README.md` ("coming next" → scorecard real), `docs/architecture.md` (scorecard stage), `docs/superpowers/HANDOFF.md` (state, R21, scorecard location), `DESIGN.md`.

- [ ] **Step 1:** Rebuild the real-data site locally (HANDOFF 00 recipe), open `/scorecard`; screenshot light, dark, 375px.
- [ ] **Step 2:** Impeccable finish review (`impeccable:impeccable-finish-reviewer`) against `DESIGN.md`; apply material fixes; re-screenshot.
- [ ] **Step 3:** Sanity checks on real data, written into the PR description: coverage %, the 5 largest cells, every cell with an approval, and spot checks that "approved" is right for 5 known pairs (e.g. FcRn blocker × MG, anti-CD20 × MS, complement C5 × NMOSD, S1P modulator × MS, anti-CD20 × NMOSD).
- [ ] **Step 4:** Docs updated; all gates + e2e green.
- [ ] **Step 5: Commit** `docs: scorecard in README, architecture, handoff`.
