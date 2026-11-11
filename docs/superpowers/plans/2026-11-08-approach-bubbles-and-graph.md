# Approach Bubbles and the Mechanism Graph — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every trial lands in one or more of seven approach bubbles, or visibly in Unclassified. `/mechanisms` shows the bubbles as a rail. The Targeted drugs bubble opens into a drug → target → pathway graph; every other bubble opens into a tree of group → kind → trials. Group success is credited to the drug that moved on (option 1b).

**Architecture:**
- A new package `trialradar.approaches` reads two hand-written CSVs (`config/approaches/`) and sorts each experimental intervention into a kind or into Targeted.
- The explorer stage adds per-trial `approaches`, `kinds`, `unsorted` and `succeeded_by`, plus file-level `approaches`, `kinds` and `drug_index`.
- A new hand-run script `map_pathways.py` writes Reactome / GO / curated pathway reference data.
- A new pipeline stage builds `mechanisms.json`, the graph, with a seeded layout.
- The web derives rail counts and trees from `explorer.json`, so filters apply. It draws the graph from `mechanisms.json`.

**Tech Stack:** Python 3.12, uv, polars, numpy, httpx (script only, `httpx.MockTransport` in tests); React 19 + TypeScript strict, vitest, Playwright. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-08-approach-bubbles-design.md` (approved 2026-11-08), which amends `docs/superpowers/specs/2026-11-06-mechanisms-and-graph-design.md` §6.1 items 3, 4, 7 and §7 (graph content and behaviour; still binding where not amended). Visual system: `DESIGN.md`. Mapping inputs: `docs/superpowers/research/2026-11-07-mapping-gaps-report.md`, `docs/superpowers/research/2026-11-07-proposed-overrides.csv`.

**Parallel waves:**
1. Tasks 1, 2 and 3 touch disjoint files.
2. Task 4 needs 1–3. Task 6 needs only Task 1.
3. Task 5 needs 4. Task 7 needs 4 and 6.
4. Task 8 needs 5.
5. Task 9 needs 7 and 8.
6. Task 10.
7. Task 11.

## Global Constraints

- $0, no server, no secrets.
  - **The daily run never calls ChEMBL, Reactome or QuickGO.** Only `map_mechanisms.py` and `map_pathways.py` do, by hand.
  - Downloads are cached under `pipeline/.cache/` (git-ignored).
- Tests are offline. Script tests use recorded fixtures through `httpx.MockTransport` or small committed files.
- No guessing:
  - Nothing is classified from a name ending.
  - Keyword rules are reviewed phrases matched as whole words, casefolded.
  - Unmatched stays visible ("Not yet sorted").
- R19: a missing or invalid `config/approaches/*` or pathway file → those parts are skipped with a warning (`approaches: <reason>`, `mechanism_graph: <reason>`), and the run continues.
- The R18 pool and R21 trial outcome are **unchanged**.
  - Supplement, genetic and combination-product names never enter `experimental_drugs`, the pool, success or the `molecule` feature.
  - Outcomes never enter the layout (the no-leakage test holds).
- **1b:** a pool trial counts in the denominator of every group it touches. It counts as succeeded in group G only if a drug in its `succeeded_by` belongs to G. The disease grouping keeps `succeeded_in`.
- `min_group` = 10 (`ExplorerConfig.min_group`): below it, "too few to tell". No per-group p-values.
- Red is only for succeeded (R15). Figure Plate design bar from `DESIGN.md`: premium, no "AI slop", no glows on black, and "lights up" = full ink against faded context. The impeccable *skill* is blocked by org policy, so style by hand. The `impeccable:impeccable-finish-reviewer` agent reviews in Task 10.
- Approach keys and labels, verbatim:
  - `targeted` Targeted drugs
  - `cell` Cell & transplant
  - `plasma` Antibody & plasma
  - `tolerisation` Tolerisation
  - `diffuse` Broad immunomodulators
  - `nondrug` Non-drug care
  - `unclassified` Unclassified
- Names the scorecard plan consumes: `config/mechanisms/{drugs.csv,overrides.csv}`, per-trial `mechanisms`/`targets`/`modalities`, `ExplorerConfig.min_group`. Keep them. `mechanisms` now holds molecular classes only.
- Never commit real trial data. `config/approaches/*` and the pathway files are reference data and are committed with source and licence in their README:
  - Reactome CC BY 4.0
  - GO CC BY 4.0
  - ChEMBL CC BY-SA 3.0
  - MeSH public domain
  - NCIt CC BY 4.0
- Gates per task:
  - `cd pipeline && uv run pytest -q && uv run ruff check . && uv run ruff format --check . && uv run mypy src scripts`
  - `cd web && npx vitest run && npm run lint && npx tsc --noEmit`
  - e2e when web changed: `cd web && npm run build && rm -rf dist/data && cp -r tests/fixtures/data dist/data && PW_CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npx playwright test`, on a port other than 4173.
  - After changing explorer output, regenerate and commit fixtures: `cd pipeline && uv run python scripts/make_web_fixtures.py`.
- Real data for checks: `gh release download snapshots-2026-11 -R martin-valny/trials -D <scratch>/raw`. Never commit it. On this Mac, scripts calling HTTPS need `SSL_CERT_FILE` (see `config/mechanisms/README.md`).
- Commit on `feat/explorer-figure-plate` (or a task branch merged into it), with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. **Never push, never bypass the sandbox.**

## Review Focus

1. **A trial whose only experimental intervention is "standard therapy" (type OTHER) or a bare arm label:** it is in Unclassified › Not yet sorted with the name listed, never missing from the rail total. Test: Task 2, `test_other_type_falls_to_not_yet_sorted`.
2. **A drug row with a molecular class but no gene target** (cladribine `DNA inhibitor`): Targeted, and in the graph as a non-gene target node with no pathway. Tests: Task 2, `test_molecular_without_targets_is_targeted`; Task 7, `test_class_target_node_without_pathway`.
3. **An aHSCT + cyclophosphamide trial that succeeded only because cyclophosphamide progressed:** a success for alkylating agents / Targeted, not for aHSCT / Cell. Tests: Task 4, `test_succeeded_by_lists_only_progressing_drugs`; Task 5, `successGroups credits only the winning drug's groups`.
4. **`config/approaches/` missing in a fresh area:** the map builds, every trial has `approaches: []`, one `approaches:` warning, and the rail shows "Approaches appear after the next update". Tests: Task 4, `test_missing_approach_files_degrade`; Task 8, an empty-state test.
5. **Filters narrowing to zero trials in the selected approach:** the rail shows 0 rows, not a blank; the canvas says "No trials match these filters"; nothing throws. Test: Task 8, `MechanismsPage shows the empty message when filters exclude all`.

---

### Task 1: Mapping data — apply the proposals, write `config/approaches/`

**Files:**
- Modify: `config/mechanisms/overrides.csv`, `config/mechanisms/README.md`
- Create: `config/approaches/kinds.csv`, `config/approaches/nondrug_rules.csv`, `config/approaches/README.md`

**Interfaces:**
- Produces:
  - `kinds.csv` columns `kind,approach,group,label,rationale,source_url`;
  - `nondrug_rules.csv` columns `pattern,types,kind`;
  - the kind keys below, which Tasks 2 and 4 rely on.

- [ ] **Step 1: Merge the proposals into `overrides.csv`** with a scratch script (not committed). Rules:
  - Take rows from `2026-11-07-proposed-overrides.csv` with `confidence` ∈ {high, medium}.
  - Drop the `confidence` column. Keep `source`.
  - A proposal replaces an existing override row for the same drug.
  - Vaccines become `not_a_drug`, with `mechanism_class`, `mechanism` and `targets` emptied and `source` prefixed "vaccine-response study (Martin 2026-11-08: vaccines are not_a_drug); ". This covers every row whose `mechanism_class` is `vaccine`, and COVID-vaccine rows (bnt162, mrna-1273, ad26.cov2.s and variants).
  - Rewrite no-target classes to kind keys:

| proposal class | kind key |
|---|---|
| immunoglobulin (IVIG/SCIG) | `immunoglobulin` |
| mesenchymal stem cells | `msc` |
| glatiramer (immunomodulator) | `glatiramer` |
| aHSCT | `ahsct` |
| T-cell vaccination | `t_cell_vaccination` |
| antioxidant (lipoic acid) | `lipoic_acid` |
| anti-thymocyte globulin | `atg` |
| tolerogenic dendritic cells | `tolerogenic_dc` |
| EBV-specific T cells | `virus_specific_t` |
| gold nanocrystals (nanocatalyst) | `gold_nanocrystals` |
| AChR peptide tolerisation, AChR peptide vaccine | `achr_peptide` |
| NK cell therapy | `nk_cells` |
| high-dose biotin | `high_dose_biotin` |
| myelin peptide tolerisation | `myelin_peptide` |
| TCR peptide vaccine | `tcr_peptide` |
| helminth therapy | `helminth` |

  Multi-part classes keep their molecular part (`DNA inhibitor;atg`). `MuSK CAAR-T` is molecular: set `targets` to `MUSK`.
  - Any no-target non-`not_a_drug` class left after this is listed in the commit message and given a kind row in Step 2.

- [ ] **Step 2: Write `config/approaches/kinds.csv`.**
  - One row per kind key above.
  - The required fallback and unclassified keys:
    - `type:BEHAVIORAL` → nondrug / Behavioural & psychological / other behavioural
    - `type:DEVICE` → nondrug / Devices & neuromodulation / other device
    - `type:PROCEDURE` → nondrug / Procedures / other procedure
    - `type:RADIATION` → nondrug / Procedures / radiation
    - `type:DIETARY_SUPPLEMENT` → nondrug / Diet & supplements / other supplement
    - `type:DIAGNOSTIC_TEST` → unclassified / Not a treatment / diagnostic test
    - `not_a_treatment` → unclassified / Not a treatment / not a treatment
    - `type:OTHER`, `type:GENETIC`, `type:COMBINATION_PRODUCT`, `type:DRUG`, `type:BIOLOGICAL` → unclassified / Not yet sorted / (label per type)
  - Keyword kinds under `nondrug`:
    - Rehabilitation & exercise: `exercise`, `physiotherapy`, `cognitive_rehab`
    - Behavioural & psychological: `cbt`, `mindfulness`, `education`
    - Devices & neuromodulation: `tms`, `tdcs`, `wearable`
    - Diet & supplements: `diet`
    - Procedures
  - Keyword kinds under `plasma`: `plasma_exchange`, `immunoadsorption`.
  - Under `cell`: `ahsct` (also matched by keyword).
  - Groups:
    - `cell`: Haematopoietic reset, Mesenchymal cells, Immune cells
    - `plasma`: Immunoglobulin replacement, Removal, Polyclonal depletion
    - `tolerisation`: Antigen-specific tolerisation, Microbial
    - `diffuse`: one group per product family
  - `rationale`: one short sentence, starting with what is *proposed* (for example "Proposed paracrine immunomodulation; no single molecular target"). Empty for `type:*` and `not_a_treatment`.
  - `source_url`: a MeSH, NCIt, review or label URL; required for every non-`type:` kind.

- [ ] **Step 3: Write `nondrug_rules.csv` from the real snapshot.**
  - List the 200 most frequent experimental-arm non-drug intervention names, with type (scratch script reading the snapshot through `extract_extras` after Task 3, or directly from `armsInterventionsModule` if Task 3 is not merged).
  - Write whole-word phrases (`plasma exchange`, `plasmapheresis`, `immunoadsorption`, `autologous hematopoietic stem cell`, `ahsct`, `exercise`, `aerobic training`, `resistance training`, `physiotherapy`, `physical therapy`, `cognitive rehabilitation`, `cognitive behavioral`, `mindfulness`, `transcranial magnetic`, `tms`, `tdcs`, `transcranial direct current`, `diet`, `ketogenic`, `fasting`, …).
  - `types` is empty unless a phrase is ambiguous across types.
  - Print the per-kind counts the rules produce and put them in the commit message.

- [ ] **Step 4: Write `config/approaches/README.md`.** Cover:
  - what each file is and who edits it;
  - the sorting order (drug mapping → keyword → type fallback);
  - the seven approaches;
  - sources and licences for rationales (MeSH public domain, NCIt CC BY 4.0).

  In `config/mechanisms/README.md`:
  - restate "Current state": high + medium proposals applied 2026-11-08, vaccines `not_a_drug`, low rows unmapped;
  - kind keys in `mechanism_class` are defined in `config/approaches/kinds.csv`.

- [ ] **Step 5: Re-run coverage.**
  - Run `cd pipeline && uv run python scripts/map_mechanisms.py <scratch>/raw/ --only <every proposal drug name, comma-joined>`. If ChEMBL is unreachable (HTTP 500), skip it; the overrides alone carry the change.
  - Run the coverage report.
  - Record the new "drug-bearing trials whose drugs are all sorted" figure in the commit message and in `config/mechanisms/README.md`.
  - Expected: about 84%. The figure is lower than 84.6% because vaccines now count as `not_a_drug`, which still counts as sorted, so it should be close.

- [ ] **Step 6: Gates.** Pipeline gates pass (the existing mapping loader tests read `overrides.csv` only through fixtures; `test_mechanisms_io` must still pass on the real file if such a test exists).

- [ ] **Step 7: Commit** `feat(mechanisms): apply reviewed mapping proposals; add config/approaches`.

---

### Task 2: `trialradar.approaches` — read the config and sort an intervention

**Files:**
- Create: `pipeline/src/trialradar/approaches/__init__.py`, `pipeline/src/trialradar/approaches/io.py`, `pipeline/src/trialradar/approaches/sort.py`
- Create: `pipeline/tests/unit/test_approaches_io.py`, `pipeline/tests/unit/test_approaches_sort.py`, `pipeline/tests/fixtures/approaches/kinds.csv`, `pipeline/tests/fixtures/approaches/nondrug_rules.csv`
- Modify: `pipeline/src/trialradar/config.py` (add `approaches_dir: Path = Path("approaches")`, resolved like `mechanisms_dir`); `config/area.yaml` only if the existing config needs it explicit.

**Interfaces:**
- Consumes: `trialradar.mechanisms.io.DrugMapping`, `split_cell`.
- Produces:
```python
# io.py
APPROACHES: tuple[str, ...] = ("targeted", "cell", "plasma", "tolerisation", "diffuse", "nondrug", "unclassified")
APPROACH_LABELS: dict[str, str]  # verbatim labels from Global Constraints
REQUIRED_KINDS: frozenset[str]   # the type:* keys and "not_a_treatment" from Task 1 Step 2
NOT_YET_SORTED = "Not yet sorted"; NOT_A_TREATMENT = "Not a treatment"  # unclassified group names

@dataclass(frozen=True)
class Kind: key: str; approach: str; group: str; label: str; rationale: str; source_url: str
@dataclass(frozen=True)
class Rule: pattern: str; types: frozenset[str]; kind: str
@dataclass(frozen=True)
class ApproachConfig: kinds: dict[str, Kind]; rules: tuple[Rule, ...]

def read_approaches(dir: Path) -> ApproachConfig  # ValueError on any problem below
def check_collisions(cfg: ApproachConfig, molecular_classes: Iterable[str]) -> None  # ValueError

# sort.py
@dataclass(frozen=True)
class Intervention: type: str; name: str; description: str = ""   # name = cleaned, casefolded
@dataclass(frozen=True)
class Sorted: molecular: tuple[str, ...]; kinds: tuple[str, ...]; unsorted: bool
@dataclass(frozen=True)
class TrialApproaches:
    approaches: tuple[str, ...]; kinds: tuple[str, ...]; mechanisms: tuple[str, ...]; unsorted: tuple[str, ...]

def sort_intervention(iv: Intervention, mappings: Mapping[str, DrugMapping], cfg: ApproachConfig) -> Sorted
def trial_approaches(ivs: Sequence[Intervention], mappings: Mapping[str, DrugMapping], cfg: ApproachConfig) -> TrialApproaches
```

The sorting order in `sort_intervention` is the spec §6.2:
1. A mapping row for `iv.name` with status `not_a_drug` → `kinds=("not_a_treatment",)`.
2. A mapping row with status `mapped` or `manual` and a non-empty `mechanism_class` → each part goes to `kinds` if it is a key in `cfg.kinds`, else to `molecular`.
3. Otherwise (no row, `unmapped`, or a resolved row with an empty class), every rule whose `pattern` matches as a whole word in `iv.name` or the first sentence of `iv.description`, and whose `types` is empty or contains `iv.type`, adds its kind.
4. Nothing yet → `type:<iv.type>` if that key exists, else `type:OTHER`.

`unsorted` is True when every kind came from step 4 and lands in group `Not yet sorted`.

`trial_approaches` works as follows:
- `approaches` = `"targeted"` if any `molecular`, plus each non-unclassified kind's approach, sorted in `APPROACHES` order.
- When that is empty, `approaches = ("unclassified",)` and `kinds` keeps the unclassified kinds. Otherwise unclassified kinds are dropped from `kinds`.
- `mechanisms` = the sorted union of `molecular`.
- `unsorted` = the sorted names of interventions with `unsorted` True.

- [ ] **Step 1: Write failing tests** in `test_approaches_io.py`:
  - `test_reads_fixture_config`: kinds and rules count; `cfg.kinds["msc"].approach == "cell"`.
  - `test_missing_file_raises`: `ValueError` mentioning the file.
  - `test_unknown_approach_raises`.
  - `test_rule_with_unknown_kind_raises`.
  - `test_missing_required_kind_raises`: drop `type:OTHER` → `ValueError` names it.
  - `test_kind_without_source_url_raises`: for non-`type:` kinds other than `not_a_treatment`.
  - `test_collision_with_molecular_class_raises`: `check_collisions(cfg, {"msc"})` raises.

  In `test_approaches_sort.py`, using a small mapping dict built with `DrugMapping`:
  - `test_molecular_row_is_targeted`: ocrelizumab `anti-CD20` → `Sorted(("anti-CD20",), (), False)`.
  - `test_molecular_without_targets_is_targeted`: cladribine `DNA inhibitor`, `targets=()` → molecular.
  - `test_kind_row_goes_to_kind`: `msc` row → `kinds == ("msc",)`.
  - `test_split_class_goes_to_both`: `("DNA inhibitor", "atg")` → molecular and kind.
  - `test_not_a_drug_is_not_a_treatment`.
  - `test_keyword_sorts_unmapped_biological`: `Intervention("BIOLOGICAL", "autologous hematopoietic stem cell transplantation")` with no mapping row → `("ahsct",)`.
  - `test_keyword_whole_word_only`: `"tmsx"` does not match `tms`.
  - `test_keyword_in_description_first_sentence`.
  - `test_keyword_respects_types`.
  - `test_behavioral_falls_back_to_type`: `("BEHAVIORAL", "group sessions")` → `("type:BEHAVIORAL",)`, `unsorted False`.
  - `test_other_type_falls_to_not_yet_sorted`: `("OTHER", "standard therapy")` → `("type:OTHER",)`, `unsorted True`.
  - `test_unknown_type_uses_type_other`.
  - `test_trial_in_two_bubbles`: rituximab + IVIG → `approaches == ("targeted", "plasma")`.
  - `test_unclassified_only_when_nothing_else`: OTHER + an exercise → `("nondrug",)`, unclassified kind dropped, the OTHER name still in `unsorted`.
  - `test_only_not_a_drug_is_not_a_treatment`: approaches `("unclassified",)`, kinds `("not_a_treatment",)`.

- [ ] **Step 2: Run** `cd pipeline && uv run pytest tests/unit/test_approaches_io.py tests/unit/test_approaches_sort.py -q`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement `io.py` and `sort.py`** with the signatures above. Whole-word matching: `re.search(rf"(?<!\w){re.escape(pattern)}(?!\w)", text)` on casefolded text. First sentence: text up to the first `. `, `.\n` or end.
- [ ] **Step 4: Run the tests and the full pipeline gates.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(approaches): config reader and intervention sorting`.

---

### Task 3: Experimental interventions in extras; wider mapping input

**Files:**
- Modify: `pipeline/src/trialradar/explorer/extras.py`, `pipeline/scripts/map_mechanisms.py`
- Test: `pipeline/tests/unit/test_explorer_extras.py`, the existing map_mechanisms script tests (`pipeline/tests/unit/` file covering `trial_drugs`)

**Interfaces:**
- Produces:
```python
# extras.py
MAPPING_TYPES: frozenset[str] = frozenset({"DRUG", "BIOLOGICAL", "DIETARY_SUPPLEMENT", "GENETIC", "COMBINATION_PRODUCT"})
@dataclass(frozen=True)
class ExperimentalIntervention: type: str; name: str; description: str   # raw name, CT.gov type enum
StudyExtras.experimental_interventions: tuple[ExperimentalIntervention, ...]   # new field, default ()
# map_mechanisms.py
def trial_drugs(snapshot: Path, config: Path, types: frozenset[str] = MAPPING_TYPES) -> dict[str, frozenset[str]]
```

`experimental_interventions` uses the same arm rule as `_experimental_drugs`:
- Take the interventions named in arms of type EXPERIMENTAL. Resolve each `"Type: Name"` entry to the `interventions` item with the same name, to get its type and description. If no item matches, the prefix gives the type: upper-case it and replace spaces with `_`.
- When there are no arm groups, take all interventions.
- Dedupe by `norm_text(name)`.
- `experimental_drugs` is unchanged.

- [ ] **Step 1: Failing tests** in `test_explorer_extras.py`:
  - `test_experimental_interventions_include_non_drug_types`: an arm listing `Behavioral: Exercise` and `Drug: Ocrelizumab` → two items with types `BEHAVIORAL`, `DRUG` and the description from `interventions`.
  - `test_experimental_interventions_skip_comparator_arms`: a PLACEBO_COMPARATOR arm's interventions are absent.
  - `test_experimental_interventions_without_arms`.
  - `test_experimental_drugs_unchanged`: a supplement is not in `experimental_drugs`.

  In the script test:
  - `test_trial_drugs_includes_supplements`: a Dietary Supplement name appears with the default `types`;
  - with `types=frozenset({"DRUG","BIOLOGICAL"})` it does not.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** `empty_extras` gets `()` for the new field. Update `trial_drugs` to clean `experimental_interventions` names whose type is in `types`. Keep `--only` behaviour.
- [ ] **Step 4: Run the pipeline gates.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(explorer): experimental interventions of every type; supplements reach the mapping`.

---

### Task 4: Per-trial approaches, success attribution and export

**Files:**
- Modify: `pipeline/src/trialradar/explorer/build.py`, `pipeline/src/trialradar/explorer/mechanisms.py`, `pipeline/src/trialradar/explorer/outcomes.py`
- Create: `pipeline/src/trialradar/explorer/approaches.py`
- Test: `pipeline/tests/unit/test_explorer_approaches.py`, `pipeline/tests/unit/test_explorer_outcomes.py`, `pipeline/tests/unit/test_explorer_build.py`, `pipeline/tests/unit/test_explorer_mechanisms.py`
- Regenerate: `web/tests/fixtures/data/*` via `make_web_fixtures.py` (add a small `config/approaches` fixture to the integration config, so the fixtures carry approaches)

**Interfaces:**
- Consumes: Task 2 (`read_approaches`, `check_collisions`, `trial_approaches`, `Intervention`), Task 3 (`StudyExtras.experimental_interventions`, `MAPPING_TYPES`), `clean_drug_name`.
- Produces:
```python
# outcomes.py
def success_drugs(trial: pl.DataFrame, drugs: TrialDrugs, labels: TrialLabels) -> dict[str, frozenset[str]]
    # per trial: the drugs that progressed under R21 in any of its labels; empty when not succeeded
# mechanisms.py
def trial_mechanisms(drugs: TrialDrugs, mappings: Mapping[str, DrugMapping], kind_keys: frozenset[str] = frozenset()) -> dict[str, TrialMechanisms]
    # kind keys never appear in .mechanisms
# explorer/approaches.py
def load_trial_approaches(cfg: AreaConfig, full: Mapping[str, StudyExtras], aliases: Mapping[str, str],
                          warnings: list[str]) -> tuple[dict[str, TrialApproaches], ApproachConfig | None]
def drug_index(names: Iterable[str], mappings: Mapping[str, DrugMapping], acfg: ApproachConfig | None) -> dict[str, dict[str, list[str]]]
```

`explorer.json` additions:
- Per trial: `approaches: string[]`, `kinds: string[]`, `unsorted: string[]`, `succeeded_by: string[]` (sorted drug names).
- File level:
  - `approaches: [{key, label}]` in `APPROACHES` order;
  - `kinds: {key: {approach, group, label, rationale, source_url}}`;
  - `drug_index: {drug: {mechanisms: [...], modalities: [...], kinds: [...], approaches: [...]}}` for every name in any trial's `drugs` or mapping-type interventions.
- Per-group counts are derived in the web so that filters apply. This is the plan's call, replacing spec §6.4's exported counts.
- `trial_mechanisms` gets the mapping-type names (drugs + supplements/genetic/combination), so a supplement with a mechanism reaches `mechanisms`/`targets`. `experimental_drugs`, the pool, success and the `molecule` feature still use drugs only.

- [ ] **Step 1: Failing tests:**
  - `test_succeeded_by_lists_only_progressing_drugs`: trial T (completed, Phase 2, drugs {`ahsct-x`, `cyclophosphamide`}); a later Phase 3 trial with `cyclophosphamide` only, same label → `success_drugs()[T] == {"cyclophosphamide"}`, and `success_labels` is unchanged.
  - `test_mechanisms_exclude_kind_keys`: an `msc` row → `mechanisms == ()`.
  - `test_supplement_mechanism_reaches_trial`: a vitamin D supplement with `VDR` → in `mechanisms` and `targets`, not in `drugs`, and `in_pool` is unchanged.
  - `test_missing_approach_files_degrade`: an empty `approaches_dir` → every trial `approaches == []`, `kinds == []`, exactly one warning starting `approaches:`, and the file-level `approaches == []`.
  - `test_collision_degrades`: a kind key equal to a molecular class in use → an `approaches:` warning, and degradation as above.
  - `test_explorer_trial_has_approach_fields`: a build on the integration fixture has the four per-trial fields and the three file-level fields; every trial has a non-empty `approaches` (Unclassified counts).
  - `test_drug_index_covers_trial_drugs`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `success_drugs` refactors `_success_labels` to also collect the winning drugs, sharing one pass.
  - `load_trial_approaches`:
    - reads `cfg.approaches_dir`;
    - runs `check_collisions` against the molecular classes used by resolved rows;
    - builds `Intervention(type, clean_drug_name(name, aliases, exclude_terms) or skip, description)` per experimental intervention;
    - calls `trial_approaches`;
    - on `OSError`/`ValueError`, adds one warning and returns empty results and `None`.
  - Add the `approaches_dir` fixture to the integration config.
- [ ] **Step 4: Run the full pipeline gates and regenerate the web fixtures.** Expected: PASS, with fixture JSON changes containing the new fields.
- [ ] **Step 5: Real-data check.** Rebuild on the snapshot (HANDOFF §00 "Recreating the real-data preview"). Print the trial count per approach and per kind, and the share in `unclassified`. Put them in the commit message. If more than 15% of trials are Unclassified › Not yet sorted, add keyword rules in `nondrug_rules.csv` for the top names and re-run, once.
- [ ] **Step 6: Commit** `feat(explorer): per-trial approaches and kinds, success credited to the drug that moved on`.

---

### Task 5: Map — Approach colour, filter, panel b, hover and Methods

**Files:**
- Modify: `web/src/types.ts`, `web/src/lib/explorer.ts`, `web/src/components/explore/{Explore,Toolbar,LegendBar,PanelSuccess,HoverCard,SelectedTrial}.tsx`, `web/src/components/Methods.tsx`, `DESIGN.md`
- Test: `web/tests/Explore.test.tsx`, `web/tests/ExplorePanels.test.tsx`, `web/tests/Methods.test.tsx`, plus a new `web/tests/explorer-approaches.test.ts` for the pure functions, and `web/e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: Task 4's JSON fields.
- Produces (in `explorer.ts`, used by Tasks 8–9):
```ts
export type ColorMode = "outcome" | "phase" | "disease" | "mechanism" | "modality" | "approach";
export type SetKey = ... | "approaches";
export type SuccessBy = "disease" | "modality" | "mechanism" | "approach";
export interface DrugInfo { mechanisms: string[]; modalities: string[]; kinds: string[]; approaches: string[] }
export function groupsOf(t: ExplorerTrial, by: SuccessBy): string[];
export function wonIn(t: ExplorerTrial, by: SuccessBy, group: string, drugIndex: Record<string, DrugInfo>): boolean;
export function successGroups(trials, by, minGroup, topN?, order?, drugIndex?: Record<string, DrugInfo>): SuccessGroup[];
export const approachLabel: (key: string, f: ExplorerFile) => string;
```
- `ExplorerTrial` gains `approaches`, `kinds`, `unsorted`, `succeeded_by`.
- `ExplorerFile` gains `approaches: {key: string; label: string}[]`, `kinds: Record<string, KindInfo>` (`KindInfo {approach, group, label, rationale, source_url}`) and `drug_index: Record<string, DrugInfo>`.
- `normalizeFile` defaults all of them to empty.

- [ ] **Step 1: Failing vitest tests:**
  - `successGroups credits only the winning drug's groups`: trial in_pool, outcome succeeded, `mechanisms ["alkylating agent"]`, `kinds ["ahsct"]`, `approaches ["targeted","cell"]`, `succeeded_by ["cyclophosphamide"]`, and drug_index mapping cyclophosphamide → targeted / alkylating agent. By approach: targeted 1/1 succeeded, cell 1 finished 0 succeeded. By mechanism: alkylating agent 1/1.
  - `disease grouping still uses succeeded_in`.
  - `approach colour mode colours by approach with "multiple" for two`.
  - `Approach filter: select none, then Cell & transplant shows only cell trials`.
  - `hover card and panel d show approach and kind`.
  - `Methods describes treatments without a molecular target`: the heading "Treatments without a molecular target"; the text names Open Targets' exclusion, ChEMBL's no-target records, MeSH E02, the seven approach labels, and that success is credited to the drug that moved on.
- [ ] **Step 2: Run** `cd web && npx vitest run`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Approach colours: a 7-entry categorical palette inside `DESIGN.md`'s rules, red excluded. Unclassified takes the neutral fill.
  - Panel b: a "By approach" switch next to By modality / By mechanism. Panel b's existing mechanism and modality groupings now pass `drug_index` (1b).
  - Methods:
    - a new section per spec §7.4, wording plain;
    - restate coverage as the two numbers;
    - one sentence explaining 1b;
    - cite Sorensen & Sellebjerg 2019 only as "later" context, not in the approach list.
  - Update `DESIGN.md` with the approach palette.
- [ ] **Step 4: Run all web gates and e2e.** Add an e2e step to `smoke.spec.ts`: choose Colour → Approach at 1280 and 375 without errors. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): approach colour mode, filter and success grouping (1b)`.

---

### Task 6: Pathway reference data — `map_pathways.py`

**Files:**
- Create: `pipeline/scripts/map_pathways.py`, `pipeline/src/trialradar/mechanisms/pathways.py`, `pipeline/tests/unit/test_mechanisms_pathways.py`, `pipeline/tests/fixtures/reactome/` (trimmed `ReactomePathways.txt`, `ReactomePathwaysRelation.txt`, `ReactomePathways.gmt`), `pipeline/tests/fixtures/quickgo/` (recorded JSON)
- Create (committed output): `config/mechanisms/pathways.json`, `config/mechanisms/go_fallback.csv`, `config/mechanisms/curated_pathways.csv`
- Modify: `config/mechanisms/README.md` (Reactome release, GO date, licences)

**Interfaces:**
- Consumes: `read_mappings` (targets of resolved molecular rows).
- Produces:
```python
# mechanisms/pathways.py
@dataclass(frozen=True)
class PathwayRef: id: str; name: str; parents: tuple[str, ...]; genes: int; source: Literal["reactome", "go", "curated"]
@dataclass(frozen=True)
class Pathways:
    release: str
    targets: dict[str, tuple[str, ...]]          # gene symbol -> lowest-level pathway ids (reactome, go or curated ids)
    pathways: dict[str, PathwayRef]
    overlaps: tuple[tuple[str, str, float], ...]   # reactome only, jaccard >= floor
def build_pathways(genes: Iterable[str], gmt: Path, names: Path, relations: Path, *, human_prefix: str = "R-HSA-",
                   exclude_roots: frozenset[str], floor: float) -> Pathways
def read_pathways(dir: Path) -> Pathways        # pathways.json + go_fallback.csv + curated_pathways.csv; ValueError
def write_pathways(path: Path, p: Pathways) -> None
```
- Reactome: use the GMT file (gene **symbols** per pathway, so no UniProt step), `ReactomePathways.txt` (human only) and `ReactomePathwaysRelation.txt`.
- Exclude the "Disease" top-level branch (R-HSA-1643685) and the drug-action branch, plus all their descendants (spec §6.1 item 3).
- Keep pathways reached by a target, plus their ancestors.
- Overlaps only among kept pathways, with the floor chosen so the file is under ~1 MB.
- GO fallback: for a target with no Reactome pathway (FCGRT) or only uninformative ones (CD52: only GPI-anchor biosynthesis), take one GO biological-process term from QuickGO (curated, manually reviewed annotations; the most specific term). Ids are `GO:…`, with `source go`. `go_fallback.csv` (`target,go_id,go_name`) is script-written and reviewable. The uninformative list is a constant in the script, starting with `CD52`.
- `curated_pathways.csv` (`target,node_label,note,source_url`), by hand: at least CD52 → "lymphocyte depletion" (alemtuzumab label). Curated ids are `curated:<slug>`. A curated row replaces GO for that target.

- [ ] **Step 1: Failing tests** with trimmed fixtures:
  - `test_gmt_maps_symbols_to_lowest_pathways`
  - `test_disease_branch_excluded`
  - `test_ancestors_kept`
  - `test_overlaps_above_floor_only`
  - `test_go_fallback_for_target_without_reactome` (FCGRT with the recorded QuickGO response)
  - `test_curated_replaces_go`
  - `test_read_pathways_invalid_raises`
  - `test_roundtrip_write_read`
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement the module and the script.**
  - Script options: `--out` (default `config/mechanisms`), `--cache` (`pipeline/.cache/reactome`), `--record DIR`.
  - Downloads from `https://reactome.org/download/current/` (`ReactomePathways.gmt.zip`, `ReactomePathways.txt`, `ReactomePathwaysRelation.txt`), with the release read from `https://reactome.org/ContentService/data/database/version`.
  - The script prints targets with Reactome / GO / curated / none counts.
- [ ] **Step 4: Run the script on the real mapping** (needs network; on failure, retry once, then stop and report BLOCKED). Commit the three output files. Run the pipeline gates.
- [ ] **Step 5: Commit** `feat(mechanisms): Reactome pathways with GO and curated fallbacks`.

---

### Task 7: Graph build — `mechanisms.json`

**Files:**
- Create: `pipeline/src/trialradar/explorer/graph.py`, `pipeline/tests/unit/test_explorer_graph.py`, `pipeline/tests/fixtures/mechanisms/pathways.json` (small)
- Modify: `pipeline/src/trialradar/pipeline.py` (a `mechanism_graph` step after `explorer`), `pipeline/src/trialradar/export.py` (write/remove `mechanisms.json` like `explorer.json`), `pipeline/src/trialradar/config.py` (`GraphConfig`: `max_nodes: int = 250`, `overlap_floor: float`, `overlap_top_k: int = 3`, `layout_iterations: int = 300`, seed from `ExplorerConfig.seed`), `pipeline/scripts/make_web_fixtures.py` if needed
- Regenerate: web fixtures (now including `mechanisms.json`)

**Interfaces:**
- Consumes: Task 4 per-trial `drugs`, `mechanisms`, `targets` and the file-level `drug_index`; Task 6 `read_pathways`; `read_mappings`.
- Produces `mechanisms.json`:
```
{ generated_for, reactome_release, method: {max_nodes, overlap_floor, overlap_top_k, seed},
  nodes: [{id, kind: "drug"|"target"|"pathway", label, source?: "reactome"|"go"|"curated", top_level?: bool,
           x, y, trials: [nct...]  (drug nodes only), n, finished, succeeded, stopped, running, conditions: [...]}],
  edges: [{source, target, kind: "acts_on"|"in_pathway"|"parent"|"shares_genes", action?, weight?, source_db?}] }
```
- `build_graph(explorer_doc: Mapping[str, Any], mappings: Mapping[str, DrugMapping], pathways: Pathways, cfg: GraphConfig, seed: int) -> dict[str, Any]`

Node rules:
- Drug nodes are drugs with a molecular class (`drug_index[d].approaches` contains `targeted`).
- A drug with gene targets gets `acts_on` edges to `target:<GENE>`. A molecular drug without gene targets gets one `acts_on` edge to a class target node `class:<mechanism_class>`, which has no pathway (Review Focus 2).
- Target → lowest-level pathway (`in_pathway`); pathway → parent (`parent`); `shares_genes` edges as context.
- Node counts:
  - `n`, `running`, `stopped`: all trials reaching the node.
  - `finished`: pool trials.
  - `succeeded`: 1b — a pool trial whose `succeeded_by` includes a drug that reaches the node.
- Pruning: drop pathways reached by only one target unless they are on the way to a kept ancestor, until there are ≤ `max_nodes` nodes. Then drop the lowest-`n` pathways.
- Layout: a seeded Fruchterman–Reingold layout in numpy (own implementation), normalised to [-1, 1]. The same input gives identical output.

- [ ] **Step 1: Failing tests:**
  - `test_nodes_and_edges_from_fixture`
  - `test_class_target_node_without_pathway`
  - `test_no_target_kinds_never_in_graph`: an `msc` trial adds no node.
  - `test_counts_use_1b`
  - `test_pruning_respects_cap`
  - `test_layout_deterministic`: two builds are equal.
  - `test_missing_pathways_degrades`: one `mechanism_graph:` warning, no `mechanisms.json` written, and the run succeeds.
  - `test_top_level_marked`
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement**, plus the export hook.
- [ ] **Step 4: Run the gates and regenerate the web fixtures.** Then run the real-data rebuild and print the node and edge counts (aim 150–300 nodes) and the build time (must stay under 10 s). Expected: PASS.
- [ ] **Step 5: Commit** `feat(pipeline): mechanism graph export`.

---

### Task 8: `/mechanisms` — rail, chips, trees and side panel

**Files:**
- Create: `web/src/components/mechanisms/{MechanismsPage,ApproachRail,KindTree,SidePanel}.tsx`, `web/src/components/mechanisms/mechanisms.css`, `web/src/lib/approaches.ts`, `web/tests/Mechanisms.test.tsx`, `web/tests/approaches.test.ts`
- Modify: `web/src/App.tsx` (nav entry "Mechanisms" between Explore and Changes; routes `/mechanisms` and `/mechanisms/:approach`), `web/src/data.ts` (`loadGraph = () => fetchJson<GraphFile>("mechanisms.json")`), `web/src/types.ts` (`GraphFile`, `GraphNode`, `GraphEdge`), `web/src/components/explore/SelectedTrial.tsx` ("Show in mechanism graph" link), `web/e2e/smoke.spec.ts`, `DESIGN.md`

**Interfaces:**
- Consumes: Task 5 (`groupsOf`, `wonIn`, `DrugInfo`, filters and `matches` from `explorer.ts`).
- Produces:
```ts
// lib/approaches.ts
export interface RailRow { key: string; label: string; n: number; finished: number; succeeded: number;
  rate: number | null; successDefined: boolean }   // successDefined false for "nondrug"
export function railRows(trials: ExplorerTrial[], f: ExplorerFile, minGroup: number): RailRow[];
export interface TreeKind { key: string; label: string; n: number; outcomes: Record<Outcome, number>;
  finished: number; succeeded: number; rate: number | null; trials: string[] }
export interface TreeGroup { group: string; rationale: string | null; source_url: string | null; kinds: TreeKind[] }
export function kindTree(approach: string, trials: ExplorerTrial[], f: ExplorerFile, minGroup: number): TreeGroup[];
```
- `MechanismsPage` takes `:approach` (default `targeted`; unknown → redirect to `targeted`).
- It shares the Explore filter model for Outcome and Disease. Filters apply to the rail counts and the canvas.
- For `targeted`, the canvas renders a placeholder slot that Task 9 fills (`<GraphCanvas/>`). For the others, `KindTree`. For `unclassified`, "Not yet sorted" lists the `unsorted` names by trial count.

- [ ] **Step 1: Failing tests:**
  - `railRows counts each approach once per trial and marks nondrug success undefined`
  - `railRows applies too-few under minGroup`
  - `kindTree groups kinds and uses 1b`
  - `unclassified tree lists unsorted names by count`
  - `MechanismsPage selects from the URL and switches on rail click`
  - `rail rows are buttons with aria-pressed`
  - `MechanismsPage shows the empty message when filters exclude all`: "No trials match these filters".
  - `missing approaches shows "Approaches appear after the next update"`
  - `kind panel lists trials with /trial links and "Show these trials on the map"`
  - `panel d links to /mechanisms/<approach>`
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** per spec §7.1–7.2 (layout sketches there):
  - Rail rows: label, count, thin success bar (outline + "too few to tell" under `min_group`; a dash + "success not defined" for Non-drug care). The selected row has an ink rule.
  - At 375px: a horizontally scrolling chip row.
  - Tree: a typeset list in the figure's type scale, kind rows with outcome strips (succeeded in red), and rationale lines marked "proposed" with a source link.
  - The side panel is a bottom sheet at 375px.
  - "Show these trials on the map" navigates to `/explore` with the trials as the Find query or filter. Use the existing mechanism the map already supports; if none fits, add a `?nct=` list filter.
  - Update `DESIGN.md` with the rail, tree and chip patterns.
- [ ] **Step 4: Run the web gates.** Add e2e steps at 1280 and 375: open Mechanisms, click Cell & transplant (chip at 375), open a kind, follow a trial link. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): mechanisms page with approach rail and kind trees`.

---

### Task 9: Targeted drugs graph canvas

**Files:**
- Create: `web/src/components/mechanisms/GraphCanvas.tsx`, `web/src/lib/graph.ts`, `web/tests/graph.test.ts`, `web/tests/GraphCanvas.test.tsx`
- Modify: `MechanismsPage.tsx`, `SidePanel.tsx`, `mechanisms.css`, `web/e2e/smoke.spec.ts`, `DESIGN.md`

**Interfaces:**
- Consumes: Task 7 `GraphFile`; Task 8 page, side panel and filters.
- Produces:
```ts
// lib/graph.ts
export function neighbours(g: GraphFile, id: string): Set<string>;                 // one hop, any edge kind
export function chain(g: GraphFile, id: string): Set<string>;                      // follows acts_on/in_pathway/parent only (both directions from the focus as in spec §7.2)
export function litByTrials(g: GraphFile, ncts: Set<string>): Set<string>;         // nodes reached by the filtered trials' drugs
export function nodeShare(n: GraphNode, minGroup: number): number | null;          // succeeded/finished, null under minGroup
export function convergence(g: GraphFile, ncts: Set<string>, minGroup: number): GraphNode[]; // pathways one level below top, ranked
```
- Behaviour follows the 2026-11-06 spec §7.2:
  - at rest everything is muted;
  - hover lights the node and its one-hop neighbours;
  - click focuses the chain;
  - Escape or a click on empty space clears;
  - filters light up rather than hide, with succeeded paths in red;
  - shared-gene links are context only, in full ink only between two lit nodes;
  - top-level pathways are never counted as convergence;
  - node colour is the pool success share (neutral under `min_group`), size is `n`;
  - GO nodes get a distinct marker, curated nodes are dashed and labelled "curated";
  - search selects nodes.
- Canvas 2D with zoom and pan, reusing `clampView`/`zoomAt`/`panBy` from `explorer.ts`.

- [ ] **Step 1: Failing tests:**
  - `chain from a drug reaches its targets, pathways and ancestors but not shares_genes neighbours`
  - `litByTrials`
  - `convergence skips top-level pathways`
  - `nodeShare null under minGroup`
  - `GraphCanvas focuses on click and clears on Escape`
  - `search box selects a node and opens the side panel`
  - `class target node shows "no pathway" in the side panel`
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The side panel shows facts (mechanism, targets, Reactome / GO / curated source links, ChEMBL link), counts by outcome, trials, and "Show these trials on the map".
  - If `mechanisms.json` is absent: "The graph appears after the next update."
- [ ] **Step 4: Run the web gates.** Add e2e steps at 1280 and 375: open Mechanisms, the graph renders, click a node and the side panel opens, Escape clears. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): targeted drugs mechanism graph`.

---

### Task 10: Real data, finish review, docs

**Files:**
- Modify: `README.md` ("coming next" → real), `docs/superpowers/HANDOFF.md` §00, `docs/superpowers/specs/2026-11-06-mechanisms-and-graph-design.md` §10 (one line pointing at the approach spec), `DESIGN.md`, `.impeccable/design.json` if present

- [ ] **Step 1: Rebuild on real data and serve the preview** on port 4174 (4173 is Martin's), following HANDOFF §00. Take screenshots into the scratchpad:
  - Explore with Colour → Approach, and panel b By approach;
  - Mechanisms with Targeted drugs (rest, hover, focus, succeeded filter);
  - Cell & transplant;
  - Non-drug care;
  - Unclassified.
  
  Each in light, dark and 375px.
- [ ] **Step 2: Dispatch the `impeccable:impeccable-finish-reviewer` agent** with `DESIGN.md`, the spec §7, and the screenshots. Apply every material fix it returns, with gates green after each. Re-screenshot.
- [ ] **Step 3: Write docs.**
  - HANDOFF §00: what was built, the real-data numbers (approach counts, coverage, graph size, the panel b before/after under 1b), the gates, and the open items.
  - README: the Mechanisms page is real.
- [ ] **Step 4: Commit** `docs: approach bubbles and mechanism graph landed`.

### Task 11: Whole-branch review and fix wave

- [ ] **Step 1: Dispatch a fresh reviewer** (most capable model) over `git diff 85017a9..HEAD`, against both specs and this plan. It returns Critical / Important / Minor findings.
- [ ] **Step 2: Fix every Critical and Important finding.** Re-run all gates and e2e. Re-review only the fix diff.
- [ ] **Step 3: Update HANDOFF §00** with the review outcome. Commit `fix: whole-branch review findings`.
