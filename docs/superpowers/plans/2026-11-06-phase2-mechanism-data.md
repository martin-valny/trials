# Phase 2 — Mechanism Data, Named Clusters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every experimental drug gets a ChEMBL-derived mechanism class, targets and modality from reviewed committed files. The map uses mechanism as a layout feature, names its clusters, and offers colour, filter and success breakdowns by mechanism and modality. Success is disease-specific (R21) from the start.

**Architecture:**
- A new importable package `trialradar.mechanisms` holds the ChEMBL client, the class derivation and the CSV I/O. A thin hand-run script `pipeline/scripts/map_mechanisms.py` writes `config/mechanisms/*`.
- The daily explorer stage only reads those files.
- Clusters are found by HDBSCAN on the 3D coordinates in the pipeline and named by rules.
- The web reads new per-trial fields and a `clusters` list from `explorer.json`.

**Tech Stack:** Python 3.12, uv, polars, httpx (already a dependency; `httpx.MockTransport` for offline script tests), scikit-learn `HDBSCAN` (≥1.3; locked 1.9); React 19 + TypeScript strict, vitest, Playwright. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-06-mechanisms-and-graph-design.md` §6 (phase 2), §2–3, §9. Compatibility contract: `docs/superpowers/plans/2026-11-06-mechanism-scorecard.md` consumes this phase's names. Keep them exactly as given here.

**Deferred to the phase 3 plan (graph):** the spec's §6.1 items 3–4 and 7 (Reactome pathways, `pathways.json`, the GO fallback, curated pathway links). Phase 2 writes only drug-level files.

**Parallel waves:** (1) Tasks 1, 2, 4. Task 4 builds on the fixture mapping files and the `io.py` contract, so if Task 2 is not merged yet, Task 4 takes the `io.py` interface from this plan. (2) Task 3 (needs 2) and Task 5 (needs 4). (3) Task 6. (4) Tasks 7 and 8 in parallel, since they touch different components; `explorer.ts` merges by hand. (5) Task 9.

## Global Constraints

- $0, no server, no secrets; **the daily run never calls ChEMBL**. Only `map_mechanisms.py` does, by hand.
- Tests are offline. Script tests use recorded ChEMBL JSON under `pipeline/tests/fixtures/chembl/` served through `httpx.MockTransport`.
- New area = config only: no source file names a condition (existing test). Mapping files are keyed by drug, not condition.
- Never commit real trial data. `config/mechanisms/*` is drug/target reference data and IS committed. Licence: ChEMBL CC BY-SA 3.0, credited in `config/mechanisms/README.md`, Methods and README.
- No guessing:
  - Name matching is exact, casefolded, against the ChEMBL `pref_name` or any synonym. No fuzzy matching.
  - Nothing is guessed from drug-name endings. Unmapped stays unmapped.
- R19: missing or invalid mapping files → mechanism parts skipped, an `explorer_mechanisms: <reason>` warning, and the run continues. Unmapped drugs present → one `mechanism_unmapped: <n> drugs (<m> trials)` warning.
- Outcomes never enter the layout (the existing no-leakage test extends to the `mechanism` block).
- Multi-mechanism counting (Martin): a trial counts in every group it touches. In Mechanism/Modality colour modes such a dot takes a neutral "multiple" colour.
- `min_group` = 10 (`ExplorerConfig.min_group`). Below it a group shows "too few to tell". No per-group p-values.
- Red (`--red`/succeeded colour) is only for succeeded trials (R15). Figure Plate design bar (premium, no "AI slop"). The impeccable *skill* is blocked by org policy, so style by hand against `DESIGN.md`. The `impeccable:impeccable-finish-reviewer` agent runs in Task 9.
- Names the scorecard plan consumes (do not rename):
  - files `config/mechanisms/{drugs.csv,overrides.csv,README.md}`; script `pipeline/scripts/map_mechanisms.py`;
  - per-trial `mechanisms`, `targets`, `modalities` in `explorer.json`; `ExplorerConfig.min_group`;
  - the ChEMBL client `trialradar.mechanisms.chembl.ChemblClient`; the derivation `trialradar.mechanisms.classify.mechanism_class`; `overrides.csv` wins.
- Gates per task: `cd pipeline && uv run pytest -q && uv run ruff check . && uv run ruff format --check . && uv run mypy src scripts`; `cd web && npx vitest run && npm run lint && npx tsc --noEmit`; e2e: `npm run build && cp -r tests/fixtures/data dist/data`, then Playwright with `PW_CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"` on a port other than 4173 (4173 is Martin's preview). After changing explorer output: `cd pipeline && uv run python scripts/make_web_fixtures.py`, then commit the fixtures.
- Commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push.

## Review Focus

1. **A drug ChEMBL knows only as a salt or prodrug** (e.g. fingolimod's mechanisms sit under related molecules): mechanisms are fetched with `parent_molecule_chembl_id=<parent>`, never by the searched id alone. Test in Task 2 with a recorded fingolimod fixture.
2. **"Select none" or a narrowed Mechanism/Modality filter with 56% drug-free trials:** drug-free and unmapped trials are matched by an explicit "No known mechanism" option (`__none__`). Narrowing to "anti-CD20" hides them; "Select all" shows them. Test in Task 7.
3. **Mapping files absent (fresh area) or malformed CSV:** the map still builds with empty mechanism fields and one warning. The `mechanism` feature block is all-zero. Test in Task 3.
4. **HDBSCAN finds no clusters or only noise** (tiny fixture sets, fewer than `min_cluster_size` trials): `clusters: []`, every `cluster: null`, and the web falls back to disease labels. Test in Task 5.
5. **A cluster whose members have no dominant anything:** it is labelled `"Mixed"` with no bracketed drug, never an empty or "undefined" label. Test in Task 5.

---

### Task 1: Disease-specific success (R21)

Execute **Task 1 of `docs/superpowers/plans/2026-11-06-mechanism-scorecard.md` verbatim** ("Disease-specific success (R21) and two per-trial fields": `success_labels`, `label_outcomes(trial, drugs, labels)`, `succeeded_in`, `in_pool`, docs, real-data re-measure). That task is the single source of its requirements. When it is done, tick it in that plan too, with a note "done in phase 2 plan Task 1".

**Interfaces:**
- Produces: `ExplorerTrial.succeeded_in: string[]`, `ExplorerTrial.in_pool: boolean` (Task 8 uses `in_pool`).

---

### Task 2: `trialradar.mechanisms` — ChEMBL client, class derivation, CSV I/O, and the script

**Files:**
- Create: `pipeline/src/trialradar/mechanisms/__init__.py`, `chembl.py`, `classify.py`, `io.py`
- Create: `pipeline/scripts/map_mechanisms.py`
- Create: `config/mechanisms/target_labels.csv` (seed, below), `config/mechanisms/overrides.csv` (header only), `config/mechanisms/README.md`
- Test: `pipeline/tests/unit/test_mechanisms_chembl.py`, `test_mechanisms_classify.py`, `test_mechanisms_io.py`; fixtures `pipeline/tests/fixtures/chembl/*.json` (recorded live with a small `--record` mode of the script, then trimmed)
- Modify: `.gitignore` (add `pipeline/.cache/`)

**Interfaces:**
- Produces:
  - `@dataclass(frozen=True) class DrugMapping: drug: str; status: Literal["mapped","unmapped","not_a_drug","manual"]; chembl_id: str | None; modality: str | None; mechanism_class: tuple[str, ...]; mechanism: tuple[str, ...]; action_type: tuple[str, ...]; targets: tuple[str, ...]`
  - `class ChemblClient(http: httpx.Client | None = None, cache_dir: Path | None = None)`, base `https://www.ebi.ac.uk/chembl/api/data`, JSON, polite (on-disk cache keyed by URL; retries like `ctgov.client` backoff). Methods:
    - `find_molecule(name: str) -> dict | None`: `molecule/search.json?q=<name>&limit=25`; keep only results whose casefolded `pref_name` or any `molecule_synonyms[].molecule_synonym` equals the casefolded name; prefer the one whose `molecule_hierarchy.parent_chembl_id` equals its own id; None if no exact match.
    - `parent_id(mol: dict) -> str` (`molecule_hierarchy.parent_chembl_id` or own id).
    - `mechanisms(parent_id: str) -> list[dict]`: `mechanism.json?parent_molecule_chembl_id=<id>&limit=100`, all pages.
    - `target(target_id: str) -> dict`: `target/<id>.json`.
    - `target_genes(target: dict) -> tuple[str, ...]`: each component's first `target_component_synonyms` entry with `syn_type == "GENE_SYMBOL"`, sorted, unique.
  - `classify.py`:
    - `MODALITY: dict[str, str]` from ChEMBL `molecule_type`: `"Small molecule"→"small molecule"`, `"Antibody"→"antibody"`, `"Protein"→"protein"`, `"Oligonucleotide"→"oligonucleotide"`, `"Cell"→"cell therapy"`, `"Gene"→"gene therapy"`, anything else → `"other"`.
    - `ACTION_WORD: dict[str, str]`: `INHIBITOR, NEGATIVE ALLOSTERIC MODULATOR, BLOCKER → "inhibitor"`; `ANTAGONIST → "antagonist"`; `AGONIST, PARTIAL AGONIST, POSITIVE ALLOSTERIC MODULATOR, MODULATOR, BINDING AGENT → "modulator"`; `ACTIVATOR, OPENER → "activator"`; `DISRUPTING AGENT, CROSS-LINKING AGENT, CHELATING AGENT, HYDROLYTIC ENZYME, RELEASING AGENT → "agent"`; `RNAI INHIBITOR, ANTISENSE INHIBITOR → "silencer"`; others → `action_type.lower()`.
    - `mechanism_class(target_label: str, action_type: str, modality: str | None) -> str`: antibodies and proteins whose action word is inhibitor/antagonist/agent/modulator-by-BINDING AGENT → `f"anti-{target_label}"`; otherwise `f"{target_label} {ACTION_WORD}"`. Examples (tests): `("CD20", "INHIBITOR", "antibody") → "anti-CD20"`; `("S1P receptor", "AGONIST", "small molecule") → "S1P receptor modulator"`; `("FcRn", "BINDING AGENT", "antibody") → "anti-FcRn"`; `("BTK", "INHIBITOR", "small molecule") → "BTK inhibitor"`.
    - `target_label(target: dict, genes: tuple[str, ...], labels: Mapping[str, str]) -> str`: the label for the ChEMBL target id, else for the gene tuple joined by `;`, else for any single gene in `labels` (`config/mechanisms/target_labels.csv`: `key,label`); else the ChEMBL target `pref_name` with a trailing " receptor family"/" family" collapsed to " receptor"/"".
  - `io.py`:
    - `DRUG_COLUMNS = ["drug","status","chembl_id","modality","mechanism_class","mechanism","action_type","targets"]`. Multi-valued cells are `;`-joined.
    - `write_drugs(path, rows: Iterable[DrugMapping]) -> None`; `read_mappings(dir: Path) -> dict[str, DrugMapping]`. This reads `drugs.csv`, then `overrides.csv` (same columns; a row there replaces the drug's row entirely). It raises `ValueError` on missing columns or a bad status.
  - Script `map_mechanisms.py <raw snapshot or dir> [--config] [--out config/mechanisms] [--cache pipeline/.cache/chembl] [--record DIR]`:
    - collects distinct cleaned experimental drug names with trial counts (reuse `top_drugs.py`'s path: `read_snapshot`, `filter_relevant`, `extract_extras`, `clean_drug_name`);
    - maps each one (molecule → parent → mechanisms → targets → genes → label → class; modality from the parent's `molecule_type`);
    - writes `drugs.csv` sorted by drug, never touching `overrides.csv`;
    - prints a coverage report: drugs mapped/unmapped, trial-weighted coverage, and the 40 most frequent unmapped drugs with counts.
- Seed `target_labels.csv` (key = gene symbol, or genes `;`-joined):
  `MS4A1,CD20` · `CD52,CD52` · `ITGA4,α4-integrin` · `FCGRT,FcRn` · `IL6R,IL-6R` · `C5,C5` · `BTK,BTK` · `S1PR1,S1P receptor` · `S1PR1;S1PR5,S1P receptor` · `S1PR1;S1PR2;S1PR3;S1PR4;S1PR5,S1P receptor` · `DHODH,DHODH` · `CD19,CD19` · `TNFRSF13B,TACI` · `IFNAR1;IFNAR2,IFN-α/β receptor` · `NFE2L2,NRF2` · `CHRNA1,AChR`.

- [ ] **Step 1: Record fixtures** (network, Martin's Mac): `uv run python scripts/map_mechanisms.py <snapshot> --record tests/fixtures/chembl/ --only fingolimod,ocrelizumab,efgartigimod,placebo-like-unknown-name`. Trim each JSON to the fields used; commit.
- [ ] **Step 2: Failing tests:**
  - classify examples above;
  - `MODALITY` mapping for every listed type;
  - `find_molecule("Fingolimod")` returns the exact-match molecule and ignores fuzzy hits;
  - `mechanisms(parent)` for fingolimod yields `S1P receptor modulator` (Review Focus 1) via the mocked transport;
  - an unknown name maps to `status="unmapped"` with empty fields;
  - `read_mappings` override wins, bad status raises, `;`-split round-trips through `write_drugs`.
- [ ] **Step 3: Run** `cd pipeline && uv run pytest tests/unit/test_mechanisms_*.py -q`: FAIL. **Step 4: Implement.** **Step 5: Run**: PASS; full pipeline gate.
- [ ] **Step 6:** `README.md` in `config/mechanisms/`: what each file is, how to re-run the script, ChEMBL release (from `status.json`) and date, licence CC BY-SA 3.0, and "overrides.csv is hand-written and always wins".
- [ ] **Step 7: Commit** `feat(mechanisms): ChEMBL mapping library and map_mechanisms script`.

---

### Task 3: Run the mapping on real data and prepare Martin's review sheet

**Files:**
- Create: `config/mechanisms/drugs.csv` (real script output), `config/mechanisms/overrides.csv` rows for the obvious gaps
- Create: `docs/superpowers/research/2026-11-06-mechanism-review-sheet.md` (for Martin)

- [ ] **Step 1:** Download the snapshot (HANDOFF §00 recipe, into the session scratchpad, never the repo). Run `map_mechanisms.py`. Save the coverage report.
- [ ] **Step 2:** Add `overrides.csv` rows for frequent unmapped names that are clearly brand names, codes or combination products of known drugs. Each row's `status` is `manual`. Placebo-like and non-drug entries get `not_a_drug`. Re-run until drugs covering **≥ 80% of drug-bearing trials** are `mapped`, `manual` or `not_a_drug` (spec 6.1 target). If that is unreachable, record the reached figure and continue.
- [ ] **Step 3:** Write the review sheet: a table of the 60 drugs with most trials (drug · trials · class · targets · modality · status), and the full list of distinct `mechanism_class` values with trial counts. Put any class that looks wrong at the top. Execution continues; Martin's corrections become `overrides.csv` rows later.
- [ ] **Step 4: Commit** `data(mechanisms): first ChEMBL mapping (coverage N%)`. The message states the coverage figure.

---

### Task 4: Pipeline — load mappings, per-trial fields, `min_group`

**Files:**
- Modify: `pipeline/src/trialradar/config.py` (`AreaConfig.mechanisms_dir: Path = Path("mechanisms")`, resolved like `aliases_dir`; `ExplorerConfig.min_group: int = 10`, validated ≥ 1)
- Create: `pipeline/src/trialradar/explorer/mechanisms.py`
- Modify: `pipeline/src/trialradar/explorer/build.py` (trial dict, `method.min_group`)
- Create: `pipeline/tests/fixtures/mechanisms/{drugs.csv,overrides.csv}` (tiny: dimethyl fumarate → NRF2 activator, small molecule; "example drug" → anti-CD20, antibody)
- Modify: `pipeline/scripts/make_web_fixtures.py` (use the fixture mechanisms dir via `cfg.model_copy(update={"mechanisms_dir": ...})`)
- Modify: `web/src/types.ts`, `web/tests/explorer.test.ts` factory
- Test: `pipeline/tests/unit/test_explorer_mechanisms.py`, `test_explorer_build.py`

**Interfaces:**
- Consumes: `trialradar.mechanisms.io.read_mappings`.
- Produces:
  - `@dataclass(frozen=True) class TrialMechanisms: mechanisms: tuple[str, ...]; targets: tuple[str, ...]; modalities: tuple[str, ...]`
  - `trial_mechanisms(drugs: TrialDrugs, mappings: Mapping[str, DrugMapping]) -> dict[str, TrialMechanisms]`: the sorted union over a trial's drugs. `not_a_drug` and `unmapped` contribute nothing.
  - `load_trial_mechanisms(cfg: AreaConfig, drugs: TrialDrugs, warnings: list[str]) -> dict[str, TrialMechanisms]`: on a missing dir or `ValueError`, every trial gets empty fields and warnings gain `explorer_mechanisms: <reason>`. If any drug in `drugs` has no row at all or is `unmapped`, warnings gain `mechanism_unmapped: <n> drugs (<m> trials)`.
  - `explorer.json` trials gain `mechanisms: string[]`, `targets: string[]`, `modalities: string[]`. `method` gains `min_group`. `ExplorerTrial` and `ExplorerFile["method"]` gain the same.
- [ ] **Step 1: Failing tests:** union and sorting; `not_a_drug` contributes nothing; missing dir → empty fields and one warning (Review Focus 3); malformed CSV → same; unmapped warning text with counts; the build adds the three keys and `method.min_group == 10`.
- [ ] **Step 2: Run**: FAIL. **Step 3: Implement.** **Step 4: Run**: PASS. Regenerate fixtures; full gates (pipeline + web).
- [ ] **Step 5: Commit** `feat(explorer): per-trial mechanisms, targets and modalities`.

---

### Task 5: Mechanism layout feature and the cluster report

**Files:**
- Modify: `pipeline/src/trialradar/explorer/features.py` (`_BLOCKS` gains `"mechanism"` after `"molecule"`; `build_features(..., mechanisms: Mapping[str, TrialMechanisms])`)
- Modify: `build.py` (`FEATURES` list, pass mechanisms), `config.py` (weights `Literal` gains `"mechanism"`, default 1.0), `config/area.yaml` (`mechanism:` weight)
- Create: `pipeline/scripts/cluster_report.py`
- Test: `pipeline/tests/unit/test_explorer_features.py` (block present, zero rows for drug-free trials, no-leakage test covers it)

**Interfaces:**
- Block content: TF-IDF over tokens `f"class:{c}"` for each mechanism class and `f"target:{g}"` for each target gene, L2-normalised like the other blocks.
- `cluster_report.py <site explorer.json | raw snapshot> --weight-mechanism W [--k 14]`: rebuilds the layout with the given mechanism weight and prints one row per KMeans(k) cluster (size, top disease %, top intervention type %, top mechanism %, top 3 drugs). The scratch analysis done in the brainstorm is the model.
- [ ] **Steps 1–4:** TDD on the feature block (as in the file list). Then the full gate.
- [ ] **Step 5: Choose the weight on real data:** run `cluster_report.py` at weights 0, 0.5, 1.0 and 1.5. Pick the smallest weight at which the big MS drug clusters split by mechanism class without dissolving disease separation (the top disease share of each cluster stays ≥ 0.6). Record all four tables in `docs/superpowers/research/2026-11-06-mechanism-weight.md` and set the chosen weight in `area.yaml`.
- [ ] **Step 6: Commit** `feat(explorer): mechanism layout feature (weight W, see research note)`.

---

### Task 6: Named clusters

**Files:**
- Create: `pipeline/src/trialradar/explorer/clusters.py`
- Modify: `config.py` (`ClusterConfig` under `ExplorerConfig.clusters`), `config/area.yaml`, `ConditionSpec.short: str | None = None` + `short: MS` for Multiple sclerosis in `area.yaml`
- Modify: `build.py` (`clusters` list, per-trial `cluster`), `web/src/types.ts`
- Test: `pipeline/tests/unit/test_explorer_clusters.py`

**Interfaces:**
- `ClusterConfig`: `min_cluster_size: int = 25`, `min_samples: int = 10`, `disease_share: float = 0.6`, `mechanism_share: float = 0.4`, `type_share: float = 0.5`, `drug_share: float = 0.15`.
- `find_clusters(coords: np.ndarray, cfg: ClusterConfig) -> np.ndarray` (labels, −1 = noise; `sklearn.cluster.HDBSCAN`). Fewer than `min_cluster_size` rows → all −1.
- `name_cluster(members: Sequence[Mapping[str, Any]], shorts: Mapping[str, str], cfg: ClusterConfig) -> str`. `members` are explorer trial dicts.
  - Disease part: if the top `condition_labels[0]` share is ≥ `disease_share`, use its short (or the label). Elif the top two together are ≥ `disease_share`, use `"A + B"`. Else `"Mixed diseases"`.
  - Middle: among drug-bearing members, if one mechanism class is in ≥ `mechanism_share`, use it. Else, if one intervention type is in ≥ `type_share` of all members, use its plural word: `BEHAVIORAL→behavioural`, `DEVICE→devices`, `PROCEDURE→procedures`, `DIETARY_SUPPLEMENT→supplements`, `DIAGNOSTIC_TEST→diagnostics`, `RADIATION→radiation`, `GENETIC→genetic`, `BIOLOGICAL→biologics`, `DRUG→drugs`, `OTHER→other interventions`, `COMBINATION_PRODUCT→combination products`. Else `"mixed"`.
  - Suffix: `" (<drug>)"` when the top drug is in ≥ `drug_share` of members.
  - Result `f"{disease} · {middle}{suffix}"`. If both parts are mixed, `"Mixed"` (Review Focus 5).
- `explorer.json` gains `clusters: [{id: int, label: str, n: int, x, y, z}]`. The anchor is the member nearest the cluster's coordinate-wise median, rounded like the trial coords. Each trial gains `cluster: number | null`.
- [ ] **Step 1: Failing tests:**
  - a synthetic 3-blob coordinate set yields 3 clusters, noise yields null;
  - fewer rows than `min_cluster_size` gives `[]` (Review Focus 4);
  - naming examples: `"MS · anti-CD20 (ocrelizumab)"`, `"MS · behavioural"`, `"NMOSD + CIDP · mixed"`, `"Mixed"`;
  - the anchor is a member.
- [ ] **Step 2: Run**: FAIL. **Step 3: Implement.** **Step 4: Run**: PASS. Regenerate fixtures; full gates. Add `cluster` and `clusters` to `types.ts`.
- [ ] **Step 5:** On real data, print the cluster labels with sizes. If more than a quarter are `"Mixed"` or labels repeat heavily, tune `min_cluster_size` (state the value and why in the commit message).
- [ ] **Step 6: Commit** `feat(explorer): named clusters`.

---

### Task 7: Web — colour, filters, labels and popup by mechanism and modality

**Files:**
- Modify: `web/src/lib/explorer.ts` (palettes, `colorFor`, `Filters`, `allFilters`/`filtersFor`, `matches`, `filterCounts`, `popupLines`), `Toolbar.tsx`, `LegendBar.tsx`, `Explore.tsx`, `PlateCanvas.tsx` (label source), `SelectedTrial.tsx`, `explore.css`
- Test: `web/tests/explorer.test.ts`, `Explore.test.tsx`, `ExplorePanels.test.tsx`, `PlateCanvas.test.tsx`, `web/e2e/smoke.spec.ts`

**Interfaces:**
- `ColorMode` gains `"mechanism" | "modality"`. Colour modes are Outcome · Phase · Disease · Mechanism · Modality.
- Mechanism colours:
  - the 6 most common classes (by trial count over the whole file) take the editorial series in order (`LIGHT/DARK_PALETTE.diseases` values);
  - other classes take `palette.otherCategory` (light `#9aa5b1`, dark `#6c7680`);
  - trials with more than one class take `palette.multiple` (light `#5b6268`, dark `#b9bdc2`);
  - no mechanism takes `palette.unknown`.
- Modality colours: small molecule, antibody, protein, oligonucleotide, cell therapy, gene therapy, other → the series in that order, then `otherCategory`. Multiple → `multiple`.
- `Filters` gains `mechanisms: Set<string>` and `modalities: Set<string>`. Each includes the sentinel `"__none__"` ("No known mechanism" / "No known modality"). `matches`: a trial with empty `mechanisms` passes iff `"__none__"` is in the set; otherwise it passes iff any of its classes is in the set. Same for modalities (Review Focus 2).
- Toolbar gains **Mechanism** (searchable `MultiSelect`, options by trial count desc, `__none__` last) and **Modality** dropdowns, after Treatment.
- Labels switch in panel a, next to Play: "Labels: Clusters · Diseases · Off". Default Clusters when `clusters.length > 0`, else Diseases (Review Focus 4). Cluster labels use the existing placement and leaders (`placeLabels`, phone `columnLabels`).
- Hover card line 2 and panel d add `mechanisms` (first, `+n`) and modality.
- [ ] **Steps 1–4:** TDD on the pure functions first:
  - colour assignment, including multiple and none;
  - `matches` with `__none__`;
  - filter counts;
  - popup text.
  Then component tests: dropdowns present, Labels switch, default Diseases when no clusters. Then implement. Then the gates.
- [ ] **Step 5: e2e:** Mechanism → Select none → "No trials match"; select only a class from the fixture ("anti-CD20") → count equals the fixture trials with that class; Labels → Off removes labels (pixel-count check as in R16).
- [ ] **Step 6:** Real-data screenshots (light, dark, 375px; Mechanism and Modality modes; Labels Clusters) into the session scratchpad. Look critically and fix what reads badly.
- [ ] **Step 7: Commit** `feat(explore): colour, filter and label by mechanism and modality`.

---

### Task 8: Success by disease, modality and mechanism

**Files:**
- Modify: `web/src/components/explore/PanelSuccess.tsx`, `web/src/lib/explorer.ts`
- Test: `web/tests/ExplorePanels.test.tsx`, `web/tests/explorer.test.ts`

**Interfaces:**
- `successGroups(trials: ExplorerTrial[], by: "disease" | "modality" | "mechanism", minGroup: number, topN = 8): { group: string; finished: number; succeeded: number; rate: number | null }[]`.
  - Pool = `in_pool` trials (Task 1). Succeeded = `outcome === "succeeded"`.
  - A trial counts in each group it touches.
  - `rate` is null when `finished < minGroup`.
  - Sorted by finished desc. Disease order stays the area order.
- Panel b gains a segmented switch **By disease · By modality · By mechanism** (default By disease, today's view).
  - Rows render in today's bar style.
  - Rows below `min_group` say "too few to tell (n finished; needs ≥10)".
  - Under the mechanism and modality views, a note: "Trials with several mechanisms count in each."
  - The headline verdict sentence is unchanged.
- [ ] **Steps 1–4:** TDD:
  - grouping and multi-membership;
  - the threshold at 9 vs 10 finished;
  - the disease view equals `stats.by_condition` for the fixture;
  - switch rendering.
  Then implement. Then the gates.
- [ ] **Step 5: Commit** `feat(explore): success by modality and mechanism`.

---

### Task 9: Finish — real data, design review, docs

**Files:** `README.md` (mechanism data now real; ChEMBL credit), `web/src/components/Methods.tsx` (sources, licence, coverage figure, weight choice, counting rule, R21 sentence if Task 1 did not already), `DESIGN.md`, `.impeccable/design.json`, `docs/superpowers/HANDOFF.md` (session state, R21 re-measure, next step = phase 3 plan), `docs/superpowers/specs/2026-11-06-mechanisms-and-graph-design.md` §10 item list if a call changed.

- [ ] **Step 1:** Rebuild the real-data preview (HANDOFF §00) and copy it into `web/dist/data` so Martin's :4173 preview shows it. Take screenshots (light, dark, 1100px, 375px; every colour mode; Labels Clusters; panel b by mechanism; Mechanism dropdown open).
- [ ] **Step 2:** Dispatch the `impeccable:impeccable-finish-reviewer` agent on the screenshots against `DESIGN.md`. Apply its material fixes and re-shoot.
- [ ] **Step 3:** Docs as listed. HANDOFF gets the coverage figure, the chosen weight, the R21 numbers, and a pointer to the review sheet for Martin.
- [ ] **Step 4:** Full gates; report counts.
- [ ] **Step 5: Commit** `docs: phase 2 mechanism data — methods, design, handoff`.
