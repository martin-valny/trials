# Front Door: Pipeline Figure and Target Pages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the similarity-map front door with a pipeline figure (target-class rows × phases or diseases, one mark per trial, companies on rows, company lens) and target pages behind it; move the map and graph into an Explore drawer; plain words app-wide.

**Architecture:** A new pipeline stage `pipeline_figure` reads the built explorer document plus the trial table and three hand-kept config files, and writes a compact `pipeline.json` (rows, one mark per trial placement, sponsors, stop reasons). The web app computes every count, headline and margin note in pure functions (`web/src/lib/pipeline.ts`) so they follow the disease switch, arrangement and company lens. New routes `/` and `/target/:slug`; Mechanisms is renamed Approaches.

**Tech Stack:** Python 3.12, uv, polars, pydantic, pytest, ruff, strict mypy; React 19 + TypeScript strict + Vite + react-router (HashRouter), vitest + Testing Library, Playwright. No UI kit.

**Spec:** `docs/superpowers/specs/2026-11-08-front-door-pipeline-design.md` (approved by Martin 2026-11-08). **Approved comp (normative for look):** `docs/superpowers/mockups/2026-11-08-front-door/front-door-v1.html` (source: `template.html` in the same folder; screenshots `s-pipe.png`, `s-tgt.png`). Read both before any task.

## Global Constraints

- Never push; never bypass the sandbox. Local commits on `feat/explorer-figure-plate` only. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Gates (all must pass at the end of every task that touches that side): `cd pipeline && uv run pytest -q && uv run ruff check . && uv run ruff format --check . && uv run mypy src scripts`; `cd web && npx vitest run && npm run lint && npx tsc --noEmit`; `npm run e2e` when routes or flows change (on the Mac: `PW_CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run e2e`).
- After changing anything that `export.py` writes: `cd pipeline && uv run python scripts/make_web_fixtures.py` and commit the fixtures (a test fails if they go stale).
- R19: a missing config file or a failed stage logs one `pipeline_figure: …` warning and the run continues; no `pipeline.json` is written and a stale one is removed.
- Never commit real trial data. Config files about drugs, targets and sponsors are fine.
- Port 4173 is Martin's preview; use 4174–4179 for your own servers and stop them afterwards.
- Copy: the spec's wording is exact where it is quoted. "Advanced to next phase", "Still running", "Stopped", "Finished, no follow-on", "Status unknown". Never "open", "opportunity", "white space".
- Design: the Figure Plate system (`DESIGN.md`, `.impeccable/design.json`) and the comp. Hanken Grotesk; rubric red `#c8102e` (dark `#ff5a6e` in the comp, reconcile with DESIGN.md's dark tokens) for advanced only; running blue `#3c5488` / dark `#8da3d6`; no gradients, glass, emoji or generic cards. Light/dark parity; phone 375 without horizontal scroll.
- Disease codes: MS, MG, NMOSD, CIDP, MOGAD, AE (from a new `code` field in `config/area.yaml`, not `short`, which names map clusters).
- Thresholds as named constants (web `lib/pipeline.ts`): `HISTORICAL_MAX_RUNNING = 1`, `HISTORICAL_MIN_TRIALS = 12`, `NEWEST_YEARS = 5`, `MAX_NOTES = 4`, `LANE_MIN_TRIALS = 4`, `COMPANIES_ON_ROW = 3`, `COMPANIES_ON_TARGET = 7`, `STOPS_SHOWN = 6`.

## Review Focus

1. **A company whose raw names differ only by case, punctuation or a legal suffix** ("Novartis Pharmaceuticals" vs "Novartis", "argenx" vs "argenx BV"): the lens must catch all of them under one parent. Test in Task 2 (`test_parent_of_normalises`) and Task 4 (`companyOptions` dedupes).
2. **A combination trial in two rows where only one drug advanced:** red in one row, pale with "Advanced, through {drug}" in the other, and headline totals count the trial once. Tests in Task 2 (`test_mark_state_1b`) and Task 4 (`headline counts distinct trials`).
3. **A disease or company filter that empties the figure** (AE + a company with nothing there; a disease with zero running): calm copy, never a blank grid or "0 of 0". Tests in Task 4 (`headline zero running`) and Task 5 (`renders the empty lens state`).
4. **A shared or bookmarked URL with an unknown value** (`?disease=XYZ`, `?company=Nobody`, `?sort=foo`, `/target/nope`): falls back to defaults or the not-found copy, no crash. Tests in Task 4 (`parseFigureState ignores unknown values`) and Task 6 (`unknown slug`).
5. **A trial with missing dates or a null sponsor** (`start_year` null, `end_year` null, `lead_sponsor` null): it still draws (sorted last in a cell; on the timeline drawn as a dot at start, or omitted from the timeline but kept in the list fallback with "dates not given"). Tests in Task 2 (`test_build_tolerates_missing_fields`) and Task 6 (`timeline omits undated trials but the list keeps them`).

---

## File map

**Pipeline**
- Create `config/pipeline/rows.csv`, `config/pipeline/unrowed.csv`, `config/pipeline/background.csv`, `config/pipeline/README.md`, `config/sponsors/parents.csv`, `config/sponsors/README.md`, `config/stop_reasons.csv`.
- Modify `config/area.yaml` (condition `code`s), `pipeline/src/trialradar/config.py` (`ConditionSpec.code`, `AreaConfig.pipeline_dir`, `AreaConfig.sponsors_dir`, `AreaConfig.stop_reasons`).
- Create package `pipeline/src/trialradar/pipeline_figure/` with `io.py` (config loading), `rules.py` (pure rules), `build.py` (document builder).
- Modify `pipeline/src/trialradar/pipeline.py` (stage at both call sites, lines ~360 and ~525), `pipeline/src/trialradar/export.py` (`pipeline.json`).
- Create `pipeline/scripts/pipeline_report.py` (real-data report).
- Tests: `pipeline/tests/unit/test_pipeline_figure_io.py`, `test_pipeline_figure_rules.py`, `test_pipeline_figure_build.py`; extend `test_export.py`, `tests/integration/test_pipeline.py`, `test_config.py`.

**Web**
- Modify `web/src/types.ts` (Pipeline types), `web/src/data.ts` (`loadPipeline`), `web/src/App.tsx` (routes, nav with Explore drawer), `web/src/components/FreshnessBadge.tsx`.
- Create `web/src/lib/pipeline.ts` (pure aggregates), `web/src/lib/stopReasons.ts` only if needed by the target page beyond `pipeline.json` (avoid; groups come from the pipeline).
- Create `web/src/components/pipeline/PipelinePage.tsx`, `PipelineFigure.tsx` (desktop grid), `PipelineStrip.tsx` (phone), `FigureControls.tsx`, `Mark.tsx`, `TrialCard.tsx`, `pipeline.css`.
- Create `web/src/components/target/TargetPage.tsx`, `TargetTimeline.tsx`, `TargetCompanies.tsx`, `TargetStops.tsx`, `TargetChain.tsx`, `target.css`.
- Modify `web/src/components/mechanisms/*` (rename to Approaches in copy and route; `ApproachRail.tsx` drops Unclassified; `SidePanel.tsx`/`MechanismsPage.tsx` links), `web/src/lib/graph.ts` (`convergence` dedupe), `web/src/components/explore/*` (trims, links, URL disease), `web/src/lib/format.ts`, `web/src/lib/approaches.ts`, `web/src/components/Methods.tsx`.
- Tests: `web/tests/pipeline.test.ts`, `web/tests/PipelinePage.test.tsx`, `web/tests/TargetPage.test.tsx`, `web/tests/TrialCard.test.tsx`, `web/tests/plainWords.test.tsx`; extend `graph.test.ts`, `Mechanisms.test.tsx`, `Explore.test.tsx`, `ExplorePanels.test.tsx`, `FreshnessBadge.test.tsx`, `Methods.test.tsx`; `web/e2e/front-door.spec.ts`.

**Docs (Task 11):** `DESIGN.md`, `.impeccable/design.json`, `README.md`, `docs/superpowers/HANDOFF.md`.

---

### Task 1: Config files and loaders

**Files:**
- Create: `config/pipeline/rows.csv`, `config/pipeline/unrowed.csv`, `config/pipeline/background.csv`, `config/pipeline/README.md`, `config/sponsors/parents.csv`, `config/sponsors/README.md`, `config/stop_reasons.csv`
- Modify: `config/area.yaml`, `pipeline/src/trialradar/config.py`
- Create: `pipeline/src/trialradar/pipeline_figure/__init__.py`, `pipeline/src/trialradar/pipeline_figure/io.py`
- Test: `pipeline/tests/unit/test_pipeline_figure_io.py`, `pipeline/tests/unit/test_config.py`

**Interfaces:**
- Produces (in `trialradar.pipeline_figure.io`):
  - `SponsorKind = Literal["industry", "academic", "government", "other"]`
  - `@dataclass(frozen=True) class Family: id: str; label: str; order: int`
  - `@dataclass(frozen=True) class FigureRow: id: str; label: str; sub: str; family: str  # Family.id; order: int; classes: tuple[str, ...]; drugs: tuple[str, ...]; gene: str | None; blurb: str; related: tuple[str, ...]`
  - `@dataclass(frozen=True) class Parent: parent: str; kind: SponsorKind`
  - `@dataclass(frozen=True) class ReasonRule: pattern: re.Pattern[str]; group: str`
  - `@dataclass(frozen=True) class FigureConfig: families: tuple[Family, ...]; rows: tuple[FigureRow, ...]; unrowed: Mapping[str, str]; background: frozenset[str]; parents: Mapping[str, Parent]  # key = norm_sponsor(raw); reasons: tuple[ReasonRule, ...]`
  - `def norm_sponsor(raw: str) -> str` — casefold, collapse whitespace, strip trailing punctuation.
  - `def read_figure_config(pipeline_dir: Path, sponsors_dir: Path, stop_reasons: Path) -> FigureConfig` — raises `ValueError("<file>:<line>: <problem>")` on a bad row; raises `FileNotFoundError` when a file is missing (the stage turns both into the R19 warning).
  - `REASON_GROUPS: tuple[str, ...] = ("Business or strategy", "Slow enrolment", "Safety", "Efficacy or futility", "Funding", "COVID-19", "Sponsor or investigator decision", "Other", "Not given")`
- Produces (in `trialradar.config`): `ConditionSpec.code: str | None = None` (non-blank when set); `AreaConfig.pipeline_dir: Path = Path("pipeline")`, `AreaConfig.sponsors_dir: Path = Path("sponsors")`, `AreaConfig.stop_reasons: Path = Path("stop_reasons.csv")`, all resolved relative to the YAML file like `mechanisms_dir`.

**File formats (exact columns):**
- `rows.csv`: `row_id,label,sub,family,family_order,row_order,classes,drugs,gene,blurb,related` — `classes`, `drugs`, `related` are `;`-separated; `gene` may be empty; `row_id` matches `^[a-z0-9]+(-[a-z0-9]+)*$` and is unique; every `related` id exists; a class or drug may appear in only one row.
- `unrowed.csv`: `class,reason`.
- `background.csv`: `drug,reason` (canonical lower-case drug names as in `explorer.json` `drugs`).
- `parents.csv`: `sponsor,parent,kind` — `kind` ∈ SponsorKind; duplicate `norm_sponsor(sponsor)` is an error.
- `stop_reasons.csv`: `pattern,group` — `pattern` is a case-insensitive regex; `group` ∈ REASON_GROUPS minus "Not given"; order = priority.

**Seed content:** rows and families from spec §6.5 and the comp's `build_data.py` `ROWS`/`EXTRA_ROWS`/`DRUG_ROWS` (fix families to the spec's order: B-cell depletion 1, IgG and complement 2, Cell therapy 3, Kinases 4, Cytokines and co-stimulation 5, Lymphocyte trafficking 6, Broad immune modulation 7, Repair and protection 8, Symptom relief 9). Add Symptom relief rows (fampridine / Kv channel; cannabinoids CB1 modulator + inhibitor) and any class meeting spec §6.1's bar you can verify from `config/mechanisms/drugs.csv` + `overrides.csv` (glucocorticoids, ACTH, glatiramer if mapped, IL-17A, CD38). `gene` from `config/mechanisms/target_labels.csv` where the row is one gene (CD20 → MS4A1, FcRn → FCGRT, C5 → C5, BTK → BTK, S1P → S1PR1, α4-integrin → ITGA4, CD52 → CD52, IL-6 receptor → IL6R, CD19 → CD19, DHODH → DHODH). `background.csv` from the comp's `BACKGROUND` set. `parents.csv`: the merges in spec §6.1 plus the top industry sponsors (Biogen, Sanofi/Genzyme, Teva, argenx, GSK, UCB, TG Therapeutics, Immunovant, Harbour BioMed, Kyverna, Cabaletta Bio, Cartesian, RemeGen, GeNeuro, AbbVie, Takeda, Bayer, Pfizer, Regeneron, Vertex, Biocad, Dianthus, Immunic, Mitsubishi Tanabe, BMS) and the top academic sponsors by trial count in `web/dist/data/trials.json` (≥ 10 trials), `kind` = academic/government. Use `web/dist/data/trials.json` (real snapshot, local, not committed) to find raw spellings. `stop_reasons.csv`: patterns covering the comp's `cat()` plus "sponsor decision", "investigator", "PI left", "drug supply", "regulatory", "feasibility"; tune in Task 3.

- [ ] **Step 1: Write failing tests** in `test_pipeline_figure_io.py`:
  - `test_reads_committed_config`: `read_figure_config(ROOT/"config/pipeline", ROOT/"config/sponsors", ROOT/"config/stop_reasons.csv")` returns ≥ 22 rows, families ordered 1..9, `cfg.rows[0].id == "cd20"`, `"fludarabine" in cfg.background`, `cfg.parents[norm_sponsor("Genentech, Inc.")].parent == "Roche"`.
  - `test_rejects_duplicate_row_id`, `test_rejects_class_in_two_rows`, `test_rejects_unknown_related`, `test_rejects_bad_kind`, `test_rejects_bad_group`, `test_rejects_bad_regex` — each with a tmp dir and asserts `ValueError` whose message starts with the file name and line number.
  - `test_missing_file_raises_file_not_found`.
  - `test_norm_sponsor`: `norm_sponsor("  Novartis   Pharmaceuticals. ") == "novartis pharmaceuticals"`.
  - In `test_config.py`: `test_condition_code_optional_and_not_blank`; `test_area_yaml_codes`: loading `config/area.yaml` gives codes `["MS","NMOSD","MOGAD","MG","CIDP","AE"]` in file order; `test_pipeline_paths_resolve_relative`.
- [ ] **Step 2:** Run `cd pipeline && uv run pytest tests/unit/test_pipeline_figure_io.py tests/unit/test_config.py -q` — expect failures (module missing).
- [ ] **Step 3:** Write the config files and `io.py`; add the config fields. Loader style: follow `trialradar/approaches/io.py` (`_rows` with line numbers).
- [ ] **Step 4:** Run the same tests — PASS. Run the full pipeline gates.
- [ ] **Step 5: Commit** `feat(pipeline): pipeline-figure config (rows, parents, background, stop reasons) and loaders`.

---

### Task 2: Pure rules (placement, state, sponsor, stop reason)

**Files:**
- Create: `pipeline/src/trialradar/pipeline_figure/rules.py`
- Test: `pipeline/tests/unit/test_pipeline_figure_rules.py`

**Interfaces:**
- Consumes: Task 1 `FigureConfig`, `Parent`, `norm_sponsor`, `REASON_GROUPS`.
- Produces (in `trialradar.pipeline_figure.rules`):
  - `COLUMN: Mapping[str, int] = {"EARLY_PHASE1": 1, "PHASE1": 1, "PHASE2": 2, "PHASE3": 3, "PHASE4": 4}`
  - `MarkState = Literal["adv", "run", "stop", "fin", "unk"]`
  - `def span(phases: Sequence[str]) -> Literal["1/2", "2/3"] | None` — `["PHASE1","PHASE2"]` → "1/2", `["PHASE2","PHASE3"]` → "2/3", else None (order-insensitive).
  - `def placements(drugs: Sequence[str], drug_mechanisms: Mapping[str, Sequence[str]], cfg: FigureConfig) -> dict[str, str]` — row id → the drug that put the trial there (first drug in `drugs` order wins per row). Rules spec §6.2: drop `cfg.background` drugs unless that empties the list; a drug in a row's `drugs` maps there and its classes are not used; else each of its classes found in a row's `classes`.
  - `def mark_state(outcome: str, drug: str, succeeded_by: Sequence[str]) -> tuple[MarkState, str | None]` — returns `(state, via)`: `succeeded` + drug in `succeeded_by` → `("adv", None)`; `succeeded` + drug not in it → `("fin", succeeded_by[0])` (via = first crediting drug, sorted); `running`→run, `stopped`→stop, `completed_unknown`→fin, `unknown`→unk; anything else → `("unk", None)`.
  - `def sponsor_display(raw: str) -> str` — trims legal suffixes (Co., Ltd., Inc., LLC, GmbH, AG, S.A., SA, plc, B.V., BV, Corporation, ", a Gilead Company") and trailing commas.
  - `def parent_of(raw: str | None, sponsor_class: str | None, parents: Mapping[str, Parent]) -> Parent` — listed → as listed; else kind from `sponsor_class` (`INDUSTRY`→industry, `NIH`/`FED`→government, `OTHER_GOV`→government, else academic if `raw` matches the academic word list from the comp's `ACADEMIC` regex, else other) and `parent = sponsor_display(raw)`; `raw` None → `Parent("Not given", "other")`.
  - `def reason_group(why: str | None, rules: Sequence[ReasonRule]) -> str` — blank/None → "Not given"; first matching rule's group; no match → "Other".
  - `def unlisted_classes(trials: Iterable[Mapping[str, Any]], drug_mechanisms: Mapping[str, Sequence[str]], cfg: FigureConfig, *, since: int = 2012, min_trials: int = 3) -> list[tuple[str, int]]` — Targeted trials started ≥ `since`: classes (via their non-background drugs) with ≥ `min_trials` trials that are in neither a row nor `cfg.unrowed`; sorted by count desc then name.

- [ ] **Step 1: Write failing tests** (synthetic `FigureConfig` built in a fixture with rows cd20 [anti-CD20], car19 [CD19 CAR-T], dna [drugs: cladribine]; background {fludarabine, cyclophosphamide, methylprednisolone}):
  - `test_placements_drops_background`: drugs `["kyv-101","fludarabine","cyclophosphamide"]` with kyv-101 → CD19 CAR-T gives `{"car19": "kyv-101"}`.
  - `test_placements_background_only_fallback`: `["methylprednisolone"]` with class "glucocorticoid receptor modulator" in a row `gc` → `{"gc": "methylprednisolone"}`.
  - `test_placements_drug_override_beats_class`: cladribine (class "DNA inhibitor", which is in no row) → `{"dna": "cladribine"}`.
  - `test_placements_multi_row_keeps_each_drug`: `["ocrelizumab","kyv-101"]` → `{"cd20": "ocrelizumab", "car19": "kyv-101"}`.
  - `test_span`: the three cases above, plus `["PHASE2","PHASE1"]` → "1/2".
  - `test_mark_state_1b`: `mark_state("succeeded","ocrelizumab",["ocrelizumab"]) == ("adv", None)`; `mark_state("succeeded","kyv-101",["ocrelizumab"]) == ("fin","ocrelizumab")`; the four plain outcomes.
  - `test_parent_of_listed_and_normalises`: parents `{norm_sponsor("Hoffmann-La Roche"): Parent("Roche","industry")}`; `parent_of("HOFFMANN-LA  ROCHE", None, p).parent == "Roche"`.
  - `test_parent_of_sponsor_class_fallback`: `parent_of("Daishi Tian", "OTHER", {})` → `Parent("Daishi Tian","other")`; `parent_of("Acme Bio, Inc.", "INDUSTRY", {})` → `Parent("Acme Bio","industry")`; `parent_of("Mayo Clinic","OTHER",{}).kind == "academic"`; `parent_of(None, None, {})` → `Parent("Not given","other")`.
  - `test_reason_group`: "Business decision" → "Business or strategy"; "slow enrollment" → "Slow enrolment"; "" → "Not given"; "Zebra" → "Other".
  - `test_unlisted_classes`: a class with 3 trials since 2012 not rowed/unrowed is reported; 2 trials or pre-2012 not reported; background-only classes ignored when the trial has another drug.
- [ ] **Step 2:** Run `uv run pytest tests/unit/test_pipeline_figure_rules.py -q` — FAIL.
- [ ] **Step 3:** Implement `rules.py`.
- [ ] **Step 4:** Tests PASS; full pipeline gates.
- [ ] **Step 5: Commit** `feat(pipeline): pipeline-figure rules (placement, 1b state, parents, stop reasons)`.

---

### Task 3: Build `pipeline.json`, wire the stage, export, fixtures, real-data report

**Files:**
- Create: `pipeline/src/trialradar/pipeline_figure/build.py`, `pipeline/scripts/pipeline_report.py`
- Modify: `pipeline/src/trialradar/pipeline.py` (new `_pipeline_figure` helper; call it after `_explorer` and before `_mechanism_graph` at both call sites), `pipeline/src/trialradar/export.py` (`pipeline: dict | None = None` kwarg; write/remove `pipeline.json` like `explorer.json`, only together with a map), `pipeline/scripts/make_web_fixtures.py` if it calls `export` directly.
- Test: `pipeline/tests/unit/test_pipeline_figure_build.py`, `pipeline/tests/unit/test_export.py`, `pipeline/tests/integration/test_pipeline.py`, `pipeline/tests/integration/test_web_fixtures.py`
- Regenerate: `web/tests/fixtures/data/` (now includes `pipeline.json`).

**Interfaces:**
- Consumes: Tasks 1–2; `explorer` doc (`trials[]` keys: `nct_id, drugs, approaches, phase, outcome, succeeded_by, succeeded_in, start_year, end_year, end_estimated, condition_labels, lead_sponsor, title`; `drug_index[drug].mechanisms`); `tables.trial` columns `nct_id, phases, why_stopped, sponsor_class`; `cfg.conditions[].label/code`.
- Produces: `def build_pipeline_doc(explorer: Mapping[str, Any], trial: pl.DataFrame, cfg: AreaConfig, fig: FigureConfig, day: date, warnings: list[str]) -> dict[str, Any]`, and the file `pipeline.json` with exactly these keys (the web types in Task 4 mirror them):

```jsonc
{
  "generated_for": "YYYY-MM-DD",
  "diseases": [{"code": "MS", "label": "Multiple sclerosis"}],          // area order
  "counts": {"trials": 0, "targeted": 0, "in_rows": 0, "targeted_not_rowed": 0},
  "families": [{"id": "b-cell-depletion", "label": "B-cell depletion", "order": 1}],
  "rows": [{"id": "cd20", "label": "CD20", "sub": "MS4A1 · antibodies", "family": "b-cell-depletion",
            "order": 1, "gene": "MS4A1", "blurb": "", "related": ["cd19"],
            "marks": [{"n": "NCT…", "c": 3, "span": "2/3", "s": "adv", "via": null, "si": ["MS"],
                       "y": 2019, "y2": 2023, "est": false, "dz": ["MS"], "drug": "ocrelizumab", "sp": 0}]}],
  "sponsors": [{"raw": "Hoffmann-La Roche", "parent": "Roche", "kind": "industry"}],
  "trials": {"NCT…": {"t": "title, max 110 chars", "why": "verbatim, max 300 chars", "r": "Business or strategy"}},
  "unrowed": [{"class": "Kv channel inhibitor", "trials": 27, "reason": "symptomatic"}]
}
```
  - Marks within a row sorted by `(y is None, y, n)`. `si` = disease codes from `succeeded_in` (present for every mark, `[]` when none). `why`/`r` only for `s == "stop"`. `trials` holds every NCT that has a mark. `targeted` = trials whose `approaches` contains "targeted"; `in_rows` = distinct trials with ≥ 1 mark; `targeted_not_rowed = targeted - in_rows` (NA-phase targeted trials count here too).
  - Warnings appended: `pipeline_unlisted_classes: <class> (<n>), …` when `unlisted_classes` is non-empty; `pipeline_unlisted_sponsors: <raw> (<n>), …` for unlisted INDUSTRY sponsors with ≥ 3 marked trials.
- `def _pipeline_figure(explorer: dict | None, tables: Tables, cfg: AreaConfig, *, day: date | None = None) -> tuple[dict | None, list[str]]` in `pipeline.py`, modelled on `_mechanism_graph` (stage name `pipeline_figure`, R19 warning `pipeline_figure: <Exc>`; no explorer → `(None, [])`).
- `pipeline_report.py`: `uv run python scripts/pipeline_report.py <site_dir>` prints a per-row table (running/total/advanced/stopped), the "Other" share of stopped trials with a reason, unlisted classes and sponsors, trials in ≥ 2 rows where one row is Interferon-β, Glatiramer or Glucocorticoids (spec §6.2 comparator check), and the file size; exit code 1 if `pipeline.json` > 200 KB.

- [ ] **Step 1: Write failing tests:**
  - `test_build_pipeline_doc_shapes` (synthetic explorer with 4 trials + a polars trial table): keys exactly as above; a combination trial appears in two rows with the right `drug` and 1b `s`/`via`; `counts.in_rows` counts it once; an NA-phase targeted trial has no mark and is in `targeted_not_rowed`; a stopped trial has `why` and `r`.
  - `test_build_tolerates_missing_fields`: `start_year`/`end_year`/`lead_sponsor` None → mark with `y: null`, `sp` pointing at a "Not given" sponsor, sorted last.
  - `test_build_title_and_why_truncated` (110 / 300).
  - `test_build_warns_unlisted_class`.
  - `test_export_writes_and_removes_pipeline_json` (in `test_export.py`): written with a map; removed when `pipeline=None` or `explorer=None`.
  - Integration `test_pipeline.py`: a run writes `pipeline.json`; with `config/pipeline` missing (tmp copy of the config without it) the run succeeds, warns `pipeline_figure:`, and writes no `pipeline.json`.
- [ ] **Step 2:** Run them — FAIL.
- [ ] **Step 3:** Implement `build.py`, `_pipeline_figure`, export, report script.
- [ ] **Step 4:** Tests PASS. Run `cd pipeline && uv run python scripts/make_web_fixtures.py`; confirm `web/tests/fixtures/data/pipeline.json` exists and has the fixture's anti-CD20 trials in row `cd20`. Full pipeline gates.
- [ ] **Step 5: Real-data rebuild and tuning.** In the session scratch: `gh release download snapshots-2026-11 -R martin-valny/trials -D <scratch>/raw`; `cd pipeline && uv run trialradar rebuild --config ../config/area.yaml --raw-dir <scratch>/raw --data-dir <scratch>/store --site-dir <scratch>/site --force`; `uv run python scripts/pipeline_report.py <scratch>/site`. Then:
  - add rows or `unrowed.csv` entries until there are no unlisted classes;
  - add `parents.csv` entries until no unlisted industry sponsor has ≥ 3 trials;
  - tune `stop_reasons.csv` until "Other" ≤ 15% of stopped trials with a reason; if impossible, record the final share (Task 6 then hides the chips);
  - resolve the comparator check: add a narrow background rule or list the cases for Methods (write them to `config/pipeline/README.md` under "Known comparator cases");
  - size ≤ 200 KB raw.
  Re-run the report until clean. If the release download is blocked by the sandbox, say so in the task report and use `web/dist/data` (already a real-data site, pre-fallback) with `pipeline_figure` run via a tiny script on those files; do not bypass the sandbox.
- [ ] **Step 6:** Copy the real site to `web/dist/data` only in a scratch build, never commit it. Save the final report output to `<scratch>/pipeline-report.txt` and paste its summary (row table, Other share, size) into the task report.
- [ ] **Step 7: Commit** `feat(pipeline): pipeline_figure stage writes pipeline.json; fixtures; real-data report script` (plus config tuning in the same or a follow-up commit `chore(config): tune rows, parents and stop reasons on the 2026-11 snapshot`).

---

### Task 4: Web data layer and pure figure logic

**Files:**
- Modify: `web/src/types.ts`, `web/src/data.ts`
- Create: `web/src/lib/pipeline.ts`
- Test: `web/tests/pipeline.test.ts` (build small `PipelineFile` objects in the test; also one test loads `web/tests/fixtures/data/pipeline.json`)

**Interfaces:**
- Consumes: `pipeline.json` (Task 3).
- Produces:
  - `types.ts`: `PipelineFile`, `PipelineRow`, `PipelineMark`, `PipelineSponsor`, `PipelineFamily`, `PipelineTrialInfo`, `PipelineDisease` mirroring Task 3's JSON exactly; `type MarkState = "adv" | "run" | "stop" | "fin" | "unk"`.
  - `data.ts`: `export const loadPipeline = (): Promise<PipelineFile | null> => fetchJson<PipelineFile>("pipeline.json")`.
  - `lib/pipeline.ts`:
    - constants from Global Constraints; `MARK_LABEL: Record<MarkState,string>` = the five legend labels.
    - `type Arrangement = "phase" | "disease"; type SortKey = "run" | "adv" | "new" | "az";`
    - `interface FigureState { disease: string | null; company: string | null; sort: SortKey; view: Arrangement }`
    - `parseFigureState(p: URLSearchParams, f: PipelineFile | null): FigureState` — unknown disease/company/sort/view → defaults (`null`, `null`, `"run"`, `"phase"`); company matched case-insensitively against parent names and returned in canonical case.
    - `figureSearch(s: FigureState): string` — omits defaults; keys `disease`, `company`, `sort`, `view`.
    - `markState(m: PipelineMark, disease: string | null): MarkState` — R21: `adv` stays `adv` only if `disease === null || m.si.includes(disease)`, else `fin`.
    - `interface CompanyCount { parent: string; kind: SponsorKind; n: number; run: number }`
    - `interface RowView { row: PipelineRow; marks: PipelineMark[]; total: number; run: number; adv: number; stop: number; recent: number; companies: CompanyCount[] /* industry only, by n desc */; runningCompanies: number; academic: number /* distinct non-industry parents */; historical: boolean; hasCompany: boolean }`
    - `rowViews(f: PipelineFile, s: FigureState, thisYear: number): RowView[]` — marks filtered by `s.disease` (by `dz`); rows with zero marks dropped; `historical = run <= HISTORICAL_MAX_RUNNING && total >= HISTORICAL_MIN_TRIALS`; `recent` = marks with `y >= thisYear - NEWEST_YEARS + 1`; sorted by `s.sort` (run: run desc, adv desc, label; adv: adv desc, run desc; new: recent desc; az: label) and, when `s.company` is set, rows with the company first (stable within the sort).
    - `cellMarks(v: RowView, column: number | string, s: FigureState): PipelineMark[]` — phase arrangement: `m.c === column`; disease arrangement: `m.dz.includes(column)`.
    - `interface Headline { kind: "field" | "lens" | "none"; running: number; advanced: number; companiesRunning: number; trials: number; text: { lead: string; rest: string } }`
    - `headline(f: PipelineFile, views: RowView[], s: FigureState): Headline` — distinct trials across views. Copy (exact):
      - field: lead `"{running} targeted-drug trials are running{ in {disease}}."`, rest `"{Family} leads, with {k} of them; {Row} alone has {m}."` (family = family label with most running marks; ties → lower family order; row = top row by the current sort among running).
      - lens: lead `"{Company}"`, rest `": {n} trials across {r} target classes; {run} running, {adv} advanced."` (r = rows with the company).
      - none (zero running under a disease): lead `"No targeted-drug trials are running in {disease};"`, rest `" {n} finished or stopped."`
      - Singular forms: "1 targeted-drug trial is running", "1 trial", "1 target class".
    - `interface MarginNote { kicker: string; text: string }`
    - `marginNotes(views: RowView[], s: FigureState, thisYear: number): Map<string, MarginNote>` — hidden (empty map) when `s.company`; rules in order, each on a distinct row, max `MAX_NOTES`; in the disease arrangement a first rule "Spreading" (most diseases with a running mark, min 3): `"Running in {k} diseases: {MS, MG, …}."` Others exactly as spec §7.1 (Most crowded min 5; Newest wave min 5 trials and 60%, text `"{r} of {n} trials started since {thisYear - NEWEST_YEARS + 1}."`; Most advanced min 3; Most stopped min 5 naming the parent with most stops).
    - `companyOptions(f: PipelineFile): string[]` — distinct parents, industry first (by marked trials desc), then others alphabetically; deduped case-insensitively.
    - `sourceLine(f: PipelineFile, views: RowView[]): string` — spec §7.1 source line with numbers filled (`{in_rows}` = distinct trials in the shown views).
    - `rowAccessibleName(v: RowView): string` — `"{label}: {total} trials, {run} running, {adv} advanced, {stop} stopped. Open target page."`
    - Target page helpers: `drugLanes(marks: PipelineMark[], label: string): { name: string; marks: PipelineMark[] }[]` (lanes for drugs with ≥ `LANE_MIN_TRIALS`, rest pooled as `"Other {label}"`, lanes by size desc); `targetCompanies(f, marks): { parent: string; drugs: string[]; marks: PipelineMark[]; run: number }[]` (industry by count, then one `"Academic and other"`); `stopSummary(f, marks): { groups: [string, number][]; showGroups: boolean; stops: PipelineMark[] }` with `showGroups = share of "Other" among stops with a reason <= 0.15`.

- [ ] **Step 1: Write failing tests** in `web/tests/pipeline.test.ts` covering each function, including:
  - `parseFigureState ignores unknown values` (`?disease=XYZ&sort=foo&view=bar&company=Nobody` → defaults); `company is canonicalised` (`?company=roche` → "Roche"); `figureSearch omits defaults` and round-trips.
  - `markState R21` (adv with `si:["MG"]` under `MS` → fin; under null → adv).
  - `rowViews filters by disease, drops empty rows, flags historical, sorts, lens-first`.
  - `headline counts distinct trials` (one trial in two rows counted once); `headline zero running`; `headline lens`; singulars.
  - `marginNotes`: thresholds respected; at most 4; distinct rows; hidden with company; Spreading only in disease view; Most stopped names the parent.
  - `companyOptions dedupes` ("Novartis" from two sponsors with different raw names appears once).
  - `drugLanes pools small drugs`; `stopSummary hides groups when Other > 15%`.
  - `fixture file parses` (loads the committed fixture, `rowViews` non-empty).
- [ ] **Step 2:** `cd web && npx vitest run tests/pipeline.test.ts` — FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** PASS; web gates.
- [ ] **Step 5: Commit** `feat(web): pipeline.json types, loader and figure logic`.

---

### Task 5: Pipeline page (figure, phone strip, controls, lens, arrangements), routes and nav

**Files:**
- Create: `web/src/components/pipeline/PipelinePage.tsx`, `PipelineFigure.tsx`, `PipelineStrip.tsx`, `FigureControls.tsx`, `Mark.tsx`, `TrialCard.tsx`, `pipeline.css`
- Modify: `web/src/App.tsx`, `web/src/components/FreshnessBadge.tsx`, `web/src/styles.css` (only shared tokens if needed)
- Test: `web/tests/PipelinePage.test.tsx`, `web/tests/TrialCard.test.tsx`, `web/tests/FreshnessBadge.test.tsx`

**Interfaces:**
- Consumes: Task 4 (`loadPipeline`, all of `lib/pipeline.ts`).
- Produces:
  - `<Mark m={PipelineMark} state={MarkState} hit?={boolean} size?={6|8} />` — the five mark styles (comp CSS `.m.*`), `span` tail, `data-n` attribute.
  - `<TrialCard nct={string} file={PipelineFile} rowId?={string} onClose={() => void} variant="popover" | "sheet" />` — spec §7.3; actions "Open trial page" (`/trial/:nct`), "Show on map" (`/explore?nct=<nct>&from=<label>`), "ClinicalTrials.gov ↗"; shows "Advanced, through {via}" when `via`; "why stopped" quote when stopped.
  - Routes in `App.tsx`: `/` → `PipelinePage`; `/target/:slug` → placeholder until Task 6 (render `TargetPage` if Task 6 is done, else a stub that Task 6 replaces); `/mechanisms/*` → redirect to `/approaches/*` preserving the rest of the path and query; `/approaches` → `/approaches/targeted`; `/approaches/:approach` → `MechanismsPage`; catch-all → `/`. Brand links to `/`.
  - Nav: Pipeline · Approaches · Explore ▾ (Trial map → `/explore`, Mechanism graph → `/approaches/targeted`) · Changes · Trials · Methods. The Explore item is a disclosure button with a two-link menu (keyboard: Enter/Space opens, Escape closes, arrow keys move; closes on route change); on phone the whole nav is a menu button (≡) opening a sheet.
  - FreshnessBadge: normal state `"Registry data from {d MMM yyyy}"` with a green dot; stale state `"Registry data from {date}, {n} days old"`; unknown state unchanged.

**What to build (match the comp; spec §7.1, §7.1a, §7.6, §7.7):**
- Lede grid (kicker, headline with lead in running blue, three key numbers), source line, controls (arrangement switch, disease segmented control hidden in the disease view, company lens search with datalist-like suggestions from `companyOptions` plus a dark chip with ✕, sort select), legend, figure, footer line.
- Desktop grid `200px repeat(N, minmax(0,1fr)) 116px 210px` (N = 4 phases or 6 diseases); family bands; "Mostly historical" divider; row hover tint; row is a link (accessible name from `rowAccessibleName`) to `/target/:id` carrying `?disease=`; marks hover → tooltip; mark click → `TrialCard` popover (stopPropagation so the row link does not fire). Empty disease cell → 4px quiet dot with tooltip "No registered trial of {row} in {disease}".
- Below 1100px the notes column moves under the row's label; ≤ 640px use `PipelineStrip` (sticky column header "Ph 1 · Ph 2 · Ph 3 · Approved" or "MS · MG · NMO · CIDP · MOG · AE", 6px marks, note inline, tap mark → `TrialCard variant="sheet"`). No horizontal page scroll at any width.
- URL state through `useSearchParams` + `parseFigureState`/`figureSearch`; changing a control replaces the query.
- Lens: non-hit marks 13% opacity, hit marks ink outline, rows without the company 45%; headline switches; notes hidden. Empty result → "Nothing for {company} in {disease}. Clear the company lens →".
- States: skeleton while loading (headline block, three number placeholders, grey row bands); `pipeline.json` missing → "The pipeline figure isn't available for this data refresh" with links to Trial map and Trials.
- Cross-fade ≤ 180ms on lens/arrangement changes; none under `prefers-reduced-motion`.
- Both themes via the app's existing theme tokens (extend them for the new colours; no hard-coded hex in components).

- [ ] **Step 1: Write failing tests** (`PipelinePage.test.tsx` with the fixture file mocked through the existing test helpers):
  - `renders headline, key numbers and source line from the fixture`.
  - `disease switch updates the URL and the headline`.
  - `clicking a company name turns on the lens` (chip visible, URL `company=`, notes hidden) and `✕ clears it`.
  - `arrangement switch shows six disease columns and hides the disease control`.
  - `row link goes to /target/cd20 and keeps ?disease`.
  - `mark click opens the trial card and does not navigate`.
  - `renders the empty lens state`; `renders the unavailable state when pipeline.json is missing`.
  - `every row has an accessible name`.
  - `TrialCard.test.tsx`: via text, why-stopped text, the three actions' hrefs.
  - `FreshnessBadge.test.tsx`: the new normal and stale copy; "Data may be stale" absent.
  - App routing: `/mechanisms/targeted?node=x` redirects to `/approaches/targeted?node=x`; unknown route → `/`.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** PASS; web gates. Visually compare with the comp at 1280 and 375 in both themes (local build on port 4175 with fixtures and, if Task 3 produced one, the real scratch site); fix drift.
- [ ] **Step 5: Commit** `feat(web): pipeline figure front page, company lens, By disease view, nav and routes`.

---

### Task 6: Target page

**Files:**
- Create: `web/src/components/target/TargetPage.tsx`, `TargetTimeline.tsx`, `TargetCompanies.tsx`, `TargetStops.tsx`, `TargetChain.tsx`, `target.css`
- Modify: `web/src/App.tsx` (route `/target/:slug` → `TargetPage`)
- Test: `web/tests/TargetPage.test.tsx`

**Interfaces:**
- Consumes: Task 4 helpers (`drugLanes`, `targetCompanies`, `stopSummary`, `markState`, `parseFigureState`), Task 5 `Mark`, `TrialCard`; `loadGraph` and `chain()` from `lib/graph.ts` for panel d.
- Produces: `TargetPage` reading `slug` and `?disease`.
- **Panel d's chain (plan call, deviates from spec §6.4's "from pathways.json"):** computed in the browser from `mechanisms.json` (lazy-loaded only on the target page): the row's gene node `target:<gene>` and, via `chain()`, its most specific pathway and top-level pathway; drug pills are the row's drugs with lanes. If `mechanisms.json` is missing or the gene is not in the graph (300-node cap), show the drug → target pills only and hide "Open in the mechanism graph". The link is `/approaches/targeted?node=target:<gene>&from=<row id>`. Rationale: the graph file already holds the ranked chain; duplicating it in Python adds a second source of truth.

**What to build (comp; spec §7.2):** breadcrumb (Pipeline keeps `?disease`), title + sub, generated lede (exact: `"{run} of {n} trials are running, from {k} companies and academic groups. {a} advanced to a later phase; {s} stopped."`, singulars handled), key numbers, disease chips with counts (click sets `?disease`); panels a–d; footer with "Show these {n} trials on the map →" (`/explore?nct=<comma list>&from=<label>`).
- Timeline: SVG, lanes from `drugLanes`, packed tracks, year axis 2000 → max(expected end)+1 clamped 2032, "Data as of {date}" rule, stroke weight by phase, ends per state (red dot, ink tick), running open ring + dashed past the rule, unknown dashed. Hover tooltip; click → `TrialCard`. Undated trials are left off the chart. A "List these trials" toggle under the chart shows an accessible list of every mark (including undated ones, "dates not given"); it is the screen-reader view.
- Companies: top `COMPANIES_ON_TARGET` + "+k more" expander; a parent name links to `/?company=<parent>`.
- Stops: chips only if `showGroups`; `STOPS_SHOWN` quotes then "Show all {s}"; none → "No {label} trial has stopped."
- Unknown slug → "No target called '{slug}'. Back to the pipeline →". Phone layout as the comp.

- [ ] **Step 1: Write failing tests:** `renders lede and key numbers for cd20 from the fixture`; `disease chip sets ?disease and refilters`; `unknown slug`; `timeline omits undated trials but the list keeps them`; `company link goes to /?company=`; `stop groups hidden when showGroups is false`; `panel d hides the graph link when mechanisms.json is missing`; `Show on map link carries every NCT`.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** PASS; web gates; visual check against `s-tgt.png` at 1280 and 375, both themes.
- [ ] **Step 5: Commit** `feat(web): target pages (timeline, companies, stops, mechanism chain)`.

---

### Task 7: Hand-offs — Approaches, graph, map

**Files:**
- Modify: `web/src/components/mechanisms/MechanismsPage.tsx`, `ApproachRail.tsx`, `SidePanel.tsx`, `GraphCanvas.tsx` (only if node panel lives there), `web/src/lib/graph.ts`, `web/src/lib/approaches.ts`, `web/src/components/explore/Explore.tsx`, `PanelSuccess.tsx` (remove usage), `SelectedTrial.tsx`, `Toolbar.tsx`
- Test: `web/tests/graph.test.ts`, `web/tests/Mechanisms.test.tsx`, `web/tests/Explore.test.tsx`, `web/tests/ExplorePanels.test.tsx`

**Interfaces:**
- Consumes: Task 4 `loadPipeline` (to map a gene or an NCT to a row: `rowForGene(f, gene): PipelineRow | null`, `rowsForTrial(f, nct): PipelineRow[]` — add both to `lib/pipeline.ts` with tests).
- Produces: `convergence(g, ncts, minGroup)` now returns `ConvergenceEntry[]` = `{ node: GraphNode; related: GraphNode[] }` — pathways whose set of reaching trials (from `trialsOf`) is identical collapse into one entry, `node` = the most specific (deepest, then most trials, then label), `related` = the others; the UI shows "+{k} related pathways (same trials)". Update every caller.

**What to build (spec §7.4, §7.5):**
- Approaches: page title/copy "Approaches"; the rail drops the Unclassified chip; footnote under the rail `"{n} trials not yet categorised ({u} unsorted names, {d} diagnostic or not a treatment). How we sort →"` → `/methods#not-yet-categorised`. `/approaches/unclassified` (old deep link) redirects to `/methods#not-yet-categorised`.
- Targeted chip: lede `"Targeted drugs are on the Pipeline, grouped by target."` + link "Open the pipeline →" above the graph.
- Graph node panel for a target node whose gene has a row: "Open {label} page →" (`/target/<id>`); arriving with `?from=<row id>` shows "← Back to {label}".
- Map: remove panel b "By approach" and its component usage; remove rotation and "Play"; caption `"{N} trials; similar trials sit close together"`; the selected-trial card gains "Open {label} target page →" for each row of the trial; `?disease=<code>` preselects that disease in the multi-select on arrival and is written back when exactly one disease is selected (spec §5); Unclassified as a filter value reads "Not yet categorised" and sorts last.
- Graph page: same `?disease` behaviour as the map.

- [ ] **Step 1: Write failing tests:** `convergence collapses pathways with identical trial sets` (graph fixture with six IL pathways reached by the same trials → one entry with 5 related); `rail has no Unclassified chip and shows the footnote`; `targeted lede links to /`; `target node shows Open page link when the gene has a row`; `from param shows Back link`; `map has no By approach panel and no Play control`; `map caption copy`; `selected trial links to its target page`; `?disease=MG preselects MG on the map and the graph`; `/approaches/unclassified redirects to methods`.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement; update existing tests that asserted removed UI.
- [ ] **Step 4:** PASS; web gates.
- [ ] **Step 5: Commit** `feat(web): hand-offs between pipeline, target pages, Approaches, graph and map; convergence dedupe`.

---

### Task 8: Plain words and Methods

**Files:**
- Modify: `web/src/lib/format.ts`, `web/src/lib/approaches.ts`, `web/src/lib/explorer.ts` (statistic copy), `web/src/components/explore/Toolbar.tsx`, `web/src/components/mechanisms/{SidePanel,KindTree,ApproachRail,MechanismsPage}.tsx`, `web/src/components/explore/SelectedTrial.tsx`, `web/src/components/Methods.tsx`, any other file with an old string (`grep -rn` for each left-column string)
- Test: `web/tests/plainWords.test.tsx`, `web/tests/Methods.test.tsx`, existing tests whose expectations change

**Interfaces:** none new. Copy table: spec §8 (exact right-column wording; "Approach" is kept in the toolbar; the other three toolbar dimensions renamed with one-line hints).

**Methods gains sections** (each with an `id` for deep links): `advanced` (what "advanced" means and its time bias), `registry-only`, `rows-and-companies` (how rows, background drugs and parents are assigned; config paths; the known comparator cases from `config/pipeline/README.md`), `unrowed` (the `unrowed` list from `pipeline.json` with counts), `not-yet-categorised` (the Unclassified groups and names, moved from the rail), `map-statistic` (the neighbourhood statistic and p-value moved from Explore).

- [ ] **Step 1: Write failing tests:** `plainWords.test.tsx` renders Pipeline, a target page, Approaches (targeted + one kind), Explore and a trial page from fixtures and asserts none of the spec §8 left-column strings appear (allow "Approach", "Approaches", "Mechanism graph"); `Methods has the six sections with their ids`.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Apply the table; write Methods sections.
- [ ] **Step 4:** PASS; web gates.
- [ ] **Step 5: Commit** `feat(web): plain words across the app; Methods covers rows, parents, advanced and the moved statistic`.

---

### Task 9: End-to-end tests and real-data screenshots

**Files:**
- Create: `web/e2e/front-door.spec.ts`
- Modify: `web/e2e/smoke.spec.ts` (front page is now `/`)

- [ ] **Step 1: Write e2e tests** (desktop and mobile projects): `/` renders the headline; disease switch changes the URL; a company name turns on the lens; row → target page → "Show these … on the map" arrives on `/explore` with the arrival banner; graph link from the target page then "← Back to CD20" returns; `/#/mechanisms/targeted` redirects to `/#/approaches/targeted`; on mobile `document.documentElement.scrollWidth <= 375` on `/` and `/target/cd20`.
- [ ] **Step 2:** `PW_CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run e2e` — all pass (report the count).
- [ ] **Step 3: Real-data screenshots** from a scratch build (`npm run build`, copy the Task 3 real site into a scratch copy of `dist`, `npx vite preview --port 4176`), a fresh page per view, into `<scratch>/shots/`: Pipeline By phase, By disease, lens (Roche), MG filter; CD20 and FcRn target pages; Approaches targeted; Explore — each at 1280 light, 1280 dark, 375 light, 375 dark. Stop the server.
- [ ] **Step 4: Commit** `test(web): front-door e2e flows`.

---

### Task 10: Reviews and fix waves

- [ ] **Step 1: Whole-branch code review** (fresh reviewer, Opus) of the diff since `722eb9c` against the spec and this plan: correctness, R19, 1b/R21 consistency between Pipeline and graph, URL edge cases (Review Focus), accessibility, performance (`pipeline.json` size, render cost of ~700 marks), no real data committed. Output: Critical / Important / Minor with file:line.
- [ ] **Step 2: Fix wave** for every Critical and Important finding (Minor: fix if cheap, else list for HANDOFF). Gates green. Commit `fix: whole-branch review findings (front door)`.
- [ ] **Step 3: Design finish review** (`impeccable:impeccable-finish-reviewer`, Opus) on the Task 9 real-data screenshots against the comp (`front-door-v1.html`, `s-pipe.png`, `s-tgt.png`), DESIGN.md and the premium bar: ordered material fixes. Recapture after fixes.
- [ ] **Step 4: Fix wave** for its fixes; recapture; gates green. Commit `fix(web): design finish review (front door)`.

### Task 11: Docs

- [ ] **Step 1:** `impeccable:impeccable-documenter` updates `DESIGN.md` and `.impeccable/design.json` from the shipped build (Figure 0: the pipeline figure, target page, marks, lens, By disease).
- [ ] **Step 2:** Update `README.md` (front page, routes, `pipeline.json`, config folders) and `docs/superpowers/HANDOFF.md` §00 (what was built, real-data numbers from the report, review outcomes, deferred minors, round 2 scorecard items, screenshots path, "not pushed").
- [ ] **Step 3:** Final gates (pipeline, web, e2e). Commit `docs: front door shipped; DESIGN, design.json, README, HANDOFF current`.
