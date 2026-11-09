# Approved for this disease Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mark every pipeline row × disease cell where a drug on that target is approved for that disease (ChEMBL + FDA labels + a hand file), as a floor rule in the By disease figure and a new target-page panel e "By disease".

**Architecture:** A hand-run script (`pipeline/scripts/fetch_approvals.py`, thin CLI over the new package `trialradar.approvals`) writes the committed `config/approvals/approvals.csv`. The daily `pipeline_figure` stage reads it (R19 if missing or bad) and adds an `ap` map per row to `pipeline.json`. The web reads `ap` for the floor rule (`PipelineFigure`, `PipelineStrip`) and the new panel (`TargetDiseases`).

**Tech Stack:** Python 3.12, pydantic, httpx, polars, pytest, ruff, mypy (pipeline); React 18 + TypeScript, Vite, vitest + Testing Library, Playwright (web).

**Spec:** `docs/superpowers/specs/2026-11-09-approved-for-disease-design.md` (read it in full before any task). Mockups: `docs/superpowers/mockups/2026-11-09-approvals/` (chosen: marker C "floor rule", panel E1).

## Global Constraints

- No disease names or codes in code: vocabularies come from `config/area.yaml` (`approvals` block per condition).
- The daily run never fetches approvals and makes no network call for them.
- Missing or malformed `approvals.csv` → one warning, no `ap` keys, the figure still builds (R19). Warning texts: `approvals: missing`, `approvals: <file>:<line>: <problem>`, `approvals_unknown: <items>`.
- `pipeline.json` omits empty/default keys (no `ap` when a row has none; no `wd` unless true; no `reg`/`y` unless set). Stays under 200 KB.
- Red (`--red`) means "advanced to a later phase" and nothing else; the floor rule is `--ink`, 2px, both themes.
- No hover-only information: the floor rule's text is also in the cell's accessible name.
- "Approved" = ever approved by any regulator; withdrawn drugs kept and labelled; the floor rule needs at least one non-withdrawn drug.
- Copy: "a drug on this target is approved for this disease" (key); "Approved for {disease}: {drugs}." (tooltip / accessible text); "None approved"; "withdrawn"; "Approval data not available"; panel head "{Row} by disease", aside "furthest phase reached by trials on the registry · approved for the disease, by any regulator".
- Pipeline gates: `uv run pytest`, `uv run ruff check`, `uv run ruff format --check`, `uv run mypy src` (from `pipeline/`). Web gates: `npx vitest run`, `npx eslint .`, `npx tsc --noEmit`, e2e via the scratch build (never port 4173).
- Never commit real registry data. Never push. Never use the Workflow tool.

## Review Focus

1. **A drug approved in two rows' diseases via different targets** (an IL-6R antibody that is also on another row's target) must appear only in rows whose seeds match on (target, action, modality) — `test_widen_pairs_not_cross_product` (Task 3).
2. **An FDA label whose indications text mentions a disease only to exclude it** ("not indicated for … multiple sclerosis") must reach the review print, not silently pass — `test_label_hits_flags_negation` (Task 3) and `test_review_lists_negations` (Task 5).
3. **An `approvals.csv` row naming a row or disease no longer in the figure** (rows.csv edited after the fetch) must warn and be skipped, not crash or attach to nothing — `test_ap_unknown_row_warns` (Task 6).
4. **A cell where every approved drug is withdrawn** shows the drugs in panel e but no floor rule in the figure — `floorRule false when all withdrawn` (Task 7) and `panel e withdrawn tag, no rule` (Task 9).
5. **The company lens and `?disease=`** must not dim or hide the floor rule — `floor rule survives the lens` (Task 8).

---

### Task 1: Area config — approval vocabularies

**Files:**
- Modify: `pipeline/src/trialradar/config.py` (`ConditionSpec`, `AreaConfig`, `load_config` path resolution)
- Modify: `config/area.yaml`
- Test: `pipeline/tests/unit/test_config.py`

**Interfaces:**
- Produces: `class ApprovalTerms(_Strict)` with `mesh: list[str] = []`, `efo: list[tuple[str, str]] = []` (MeSH heading, EFO term pairs), `label_terms: list[str] = []`; `ConditionSpec.approvals: ApprovalTerms | None = None`; `AreaConfig.approvals_dir: Path = Path("approvals")`, resolved relative to the config file like `pipeline_dir`.

- [ ] **Step 1: Write the failing tests** — `test_condition_approvals_parsed` (a condition with `mesh`, `efo` and `label_terms` round-trips; `efo` items are 2-tuples), `test_condition_without_approvals_is_none`, `test_approval_terms_reject_blank` (a blank string in any list raises `ConfigError`), `test_approvals_dir_resolves_relative` (`load_config` gives `<config dir>/approvals`), `test_repo_area_has_approvals` (the repo `config/area.yaml`: MS mesh is exactly `["Multiple Sclerosis", "Multiple Sclerosis, Chronic Progressive", "Multiple Sclerosis, Relapsing-Remitting"]`; MOGAD mesh is `[]` and label_terms contains `"myelin oligodendrocyte glycoprotein antibody"`).
- [ ] **Step 2: Run** `uv run pytest tests/unit/test_config.py -q` → the new tests FAIL.
- [ ] **Step 3: Implement** the model and path resolution; add to `config/area.yaml`:
  - MS: mesh the three above; label_terms `["multiple sclerosis"]`
  - MG: mesh `["Myasthenia Gravis"]`; label_terms `["myasthenia gravis"]`
  - NMOSD: mesh `["Neuromyelitis Optica"]`; label_terms `["neuromyelitis optica"]`
  - CIDP: mesh `["Polyradiculoneuropathy, Chronic Inflammatory Demyelinating"]`; label_terms `["chronic inflammatory demyelinating polyneuropathy", "chronic inflammatory demyelinating polyradiculoneuropathy"]`
  - MOGAD: mesh `[]`; label_terms `["myelin oligodendrocyte glycoprotein antibody", "MOGAD"]`
  - AE: efo `[["Autoimmune Diseases of the Nervous System", "autoimmune encephalitis"]]`; label_terms `["autoimmune encephalitis"]`
- [ ] **Step 4: Run** the config tests and the full pipeline suite → PASS (nothing else reads the new fields yet).
- [ ] **Step 5: Commit** `feat(config): approval vocabularies per condition`.

### Task 2: Approvals files — model, read, write, overrides

**Files:**
- Create: `pipeline/src/trialradar/approvals/__init__.py`, `pipeline/src/trialradar/approvals/io.py`
- Test: `pipeline/tests/unit/test_approvals_io.py`

**Interfaces:**
- Produces (all in `trialradar.approvals.io`):
  - `COLUMNS = ("row_id","disease","drug","chembl_id","sources","withdrawn","regulator","year","url")`; `OVERRIDE_COLUMNS = ("action","row_id","disease","drug","regulator","year","withdrawn","source_url","note")`; `SOURCES = ("chembl","fda_label","hand")`.
  - `class ApprovalsError(ValueError)` — message always `<file>:<line>: <problem>` (line 1 = header).
  - `@dataclass(frozen=True) class Approval: row_id: str; disease: str; drug: str; chembl_id: str; sources: tuple[str, ...]; withdrawn: bool; regulator: str; year: int | None; url: str`
  - `@dataclass(frozen=True) class Override: action: Literal["add","exclude"]; row_id: str; disease: str; drug: str; regulator: str; year: int | None; withdrawn: bool; source_url: str; note: str`
  - `read_approvals(path: Path) -> list[Approval]`, `write_approvals(path: Path, items: Iterable[Approval]) -> None`, `read_overrides(path: Path) -> list[Override]` (missing overrides file → `[]`).

- [ ] **Step 1: Write the failing tests** — `test_roundtrip` (write then read equals input; output sorted by `(row_id, disease, drug.casefold())`; `sources` written `;`-joined in `SOURCES` order; `withdrawn` written `1` or blank; `year` blank when None); `test_read_rejects` parametrised: wrong header, unknown source `"ema"`, empty `drug`, non-integer `year`, `withdrawn` not in `{"", "1"}`, duplicate `(row_id, disease, drug)` casefolded — each raises `ApprovalsError` whose message starts with `f"{path}:{line}:"`; `test_overrides_add_requires_source_url`; `test_overrides_unknown_action`; `test_overrides_missing_file_is_empty`.
- [ ] **Step 2: Run** `uv run pytest tests/unit/test_approvals_io.py -q` → FAIL.
- [ ] **Step 3: Implement** with `csv.DictReader`/`DictWriter` (UTF-8, `\n` line endings), following `trialradar.mechanisms.io` style.
- [ ] **Step 4: Run** → PASS; `uv run mypy src` clean.
- [ ] **Step 5: Commit** `feat(approvals): approvals.csv and overrides.csv readers and writer`.

### Task 3: Matching rules (pure)

**Files:**
- Create: `pipeline/src/trialradar/approvals/match.py`
- Test: `pipeline/tests/unit/test_approvals_match.py`

**Interfaces:**
- Consumes: `ApprovalTerms` (Task 1).
- Produces (in `trialradar.approvals.match`):
  - `modality_group(molecule_type: str | None) -> str` — `"Antibody"`, `"Protein"`, `"Small molecule"` map to themselves; `"Cell"` and `"Gene"` → `"cell therapy"`; None or `""` → `"unknown"`; anything else → itself.
  - `@dataclass(frozen=True) class Mech: parent_id: str; target_id: str; action: str; group: str` (one mechanism of one molecule, `action` upper-case as ChEMBL gives it).
  - `widen(seeds: Iterable[Mech], on_target: Mapping[str, Sequence[Mech]]) -> set[str]` — the seeds' own parent ids plus every `m` in `on_target[seed.target_id]` with `(m.action, m.group) == (seed.action, seed.group)` for that same seed.
  - `indication_disease(mesh: str | None, efo: str | None, terms: Mapping[str, ApprovalTerms]) -> str | None` — the disease code whose `mesh` contains `mesh` exactly, else whose `efo` contains the `(mesh, efo)` pair; else None.
  - `@dataclass(frozen=True) class LabelHit: disease: str; sentence: str; negated: bool`
  - `label_hits(indications_text: str, terms: Mapping[str, ApprovalTerms]) -> list[LabelHit]` — case-insensitive whole-phrase match (`\b` on both ends) of any `label_terms`; `sentence` is the sentence containing the first match, whitespace-collapsed, ≤ 300 chars; `negated` is true when that sentence or the one before matches `not indicated|limitations of use` (case-insensitive). One hit per disease.

- [ ] **Step 1: Write the failing tests** —
  - `test_modality_groups` (the six mappings above).
  - `test_widen_pairs_not_cross_product`: seeds `Mech("S1","T1","INHIBITOR","Antibody")` and `Mech("S2","T1","AGONIST","Small molecule")`; on_target `T1` has `A` (INHIBITOR, Antibody), `B` (AGONIST, Small molecule), `C` (INHIBITOR, Small molecule), `D` (AGONIST, Antibody) → result `{"S1","S2","A","B"}`.
  - `test_widen_keeps_cell_therapy_apart`: seed (`CAR1`, `CD19T`, `BINDING AGENT`, `"cell therapy"`); on_target has an Antibody binding agent `INEB` → result `{"CAR1"}`.
  - `test_indication_disease`: `"Myasthenia Gravis"` → `MG`; `"Lambert-Eaton Myasthenic Syndrome"` with efo `"Myasthenia gravis"` → None; `("Autoimmune Diseases of the Nervous System","autoimmune encephalitis")` → `AE`; `("Encephalitis, Japanese","Japanese encephalitis")` → None; the same MeSH with another EFO term → None.
  - `test_label_hits`: text "Soliris is indicated for … generalized myasthenia gravis (gMG) in adult patients who are anti-AChR antibody positive. … neuromyelitis optica spectrum disorder (NMOSD) …" → hits MG and NMOSD, not negated.
  - `test_label_hits_flags_negation`: "Limitations of Use: Not indicated for the treatment of multiple sclerosis." → MS hit with `negated=True`.
  - `test_label_hits_whole_phrase`: "MOGADISHU" does not match `"MOGAD"`.
- [ ] **Step 2: Run** `uv run pytest tests/unit/test_approvals_match.py -q` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(approvals): widening, disease and label matching rules`.

### Task 4: Clients — ChEMBL calls and openFDA

**Files:**
- Modify: `pipeline/src/trialradar/mechanisms/chembl.py`
- Create: `pipeline/src/trialradar/approvals/openfda.py`
- Create fixtures: `pipeline/tests/fixtures/chembl/` (new trimmed JSON files, hand-written in the existing fixture format) and `pipeline/tests/fixtures/openfda/`
- Test: `pipeline/tests/unit/test_mechanisms_chembl.py` (extend), `pipeline/tests/unit/test_approvals_openfda.py`

**Interfaces:**
- Produces:
  - `ChemblClient.mechanisms_on_target(target_id: str) -> list[Json]` (all pages of `mechanism.json?target_chembl_id=`, same paging/limit pattern as `mechanisms`).
  - `ChemblClient.indications(parent_id: str) -> list[Json]` (all pages of `drug_indication.json?parent_molecule_chembl_id=`; each item has `mesh_heading`, `efo_term`, `max_phase_for_ind`).
  - `class OpenFdaClient` in `trialradar.approvals.openfda`: `__init__(self, http: httpx.Client | None = None, cache_dir: Path | None = None, *, base_url: str = "https://api.fda.gov", record_dir: Path | None = None, sleep=..., rng=...)`; `labels(generic_name: str) -> list[Json]` — `drug/label.json?search=openfda.generic_name:"<name>"&limit=100`, each item reduced to `{"set_id": str, "generic_name": str, "indications": str}` (joined `indications_and_usage` list). HTTP 404 with openFDA's `NOT_FOUND` body → `[]`. Same cache file naming (`cache_key`), retry and backoff as `ChemblClient` (reuse by subclassing or by extracting the transport into a shared base in `chembl.py`; the builder chooses, behaviour must be identical).

- [ ] **Step 1: Write the failing tests** — with `httpx.MockTransport` like the existing `_client` helper: `test_mechanisms_on_target_pages` (two pages joined), `test_indications_pages`, `test_openfda_labels_reduced` (fields above; `indications` joins list items with a space), `test_openfda_not_found_is_empty` (404 + `{"error":{"code":"NOT_FOUND"}}` → `[]`), `test_openfda_500_retries_then_raises`, `test_openfda_cache_hit_skips_http`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the two test files and the full suite → PASS; mypy clean.
- [ ] **Step 5: Commit** `feat(approvals): ChEMBL target and indication calls, openFDA label client`.

### Task 5: Build approvals and the review; the hand-run script

**Files:**
- Create: `pipeline/src/trialradar/approvals/build.py`
- Create: `pipeline/scripts/fetch_approvals.py`
- Create: `config/approvals/README.md`, `config/approvals/overrides.csv` (header only for now; Task 11 fills it)
- Test: `pipeline/tests/unit/test_approvals_build.py`

**Interfaces:**
- Consumes: Tasks 1–4; `FigureRow` (`trialradar.pipeline_figure.io`), `DrugMapping`/`read_mappings` (`trialradar.mechanisms.io`).
- Produces (in `trialradar.approvals.build`):
  - `class ChemblLike(Protocol)`: `mechanisms`, `mechanisms_on_target`, `indications`, `molecule` with `ChemblClient`'s signatures. `class FdaLike(Protocol)`: `labels`.
  - `@dataclass class Review: one_source: list[str]; disagree: list[str]; hand: list[str]; negated: list[str]; counts: dict[str, int]` — each list item a printable line `"{row_id} × {disease}: {drug} — {detail}"`; `counts` approved cells per disease code.
  - `build_approvals(rows: Sequence[FigureRow], mappings: Mapping[str, DrugMapping], terms: Mapping[str, ApprovalTerms], chembl: ChemblLike, fda: FdaLike, overrides: Sequence[Override]) -> tuple[list[Approval], Review]`.

Rules (from spec §5.2–5.4):
- Seeds per row: mappings with status `mapped`/`manual` and a `chembl_id`, whose `mechanism_class` meets `row.classes`; for a row with `drugs` and no `classes`, the mappings of those drug names (casefolded) only, and no widening. Seed `Mech`s from `chembl.mechanisms(chembl_id)` with `modality_group(chembl.molecule(id)["molecule_type"])`.
- Candidates: `widen(...)` for class rows. For each candidate: `chembl.indications` → disease via `indication_disease`; hit when `max_phase_for_ind` ≥ 4. `chembl.molecule` gives `pref_name` (drug name, lower-cased), `withdrawn_flag`. `fda.labels(pref_name)` → `label_hits`; a non-negated hit is an FDA approval; negated hits go to `review.negated` only.
- A cell × drug is approved if ChEMBL or FDA says so (`sources` accordingly). `disagree`: one source approves and the other has data for that drug and disease that says otherwise (ChEMBL indication < 4, or an FDA label for the drug without the phrase). `one_source`: approved by one source, the other has nothing for that drug.
- Overrides: `exclude` removes a matching row × disease × drug; `add` inserts it with `sources` gaining `hand`, `regulator`, `year`, `url = source_url`, `withdrawn` from the override (or keeps the automatic row and marks it withdrawn when `withdrawn` is `1`). Every override is listed in `review.hand`.
- `url`: hand `source_url`, else DailyMed `https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=<set_id>`, else `https://www.ebi.ac.uk/chembl/compound_report_card/<chembl_id>/`.
- Only diseases with an `approvals` block are considered; output deterministic (sorted as Task 2).

- [ ] **Step 1: Write the failing tests** with in-memory fakes (dicts behind the two Protocols): `test_class_row_widens_and_matches` (seed antibody + a second antibody with the same action → both approved in MS from ChEMBL phase 4), `test_named_drug_row_not_widened` (cladribine row: a molecule sharing cladribine's target with an MS phase-4 indication is not included), `test_fda_only_approval` (ChEMBL phase 3 for MG, FDA label mentions myasthenia gravis → approved, `sources == ("fda_label",)`, listed in `review.disagree`), `test_review_lists_negations`, `test_withdrawn_flag_carried`, `test_override_add_and_exclude`, `test_override_marks_withdrawn`, `test_condition_without_terms_ignored`, `test_output_sorted_and_urls` (DailyMed, ChEMBL and hand urls).
- [ ] **Step 2: Run** `uv run pytest tests/unit/test_approvals_build.py -q` → FAIL.
- [ ] **Step 3: Implement `build_approvals`.**
- [ ] **Step 4: Write `scripts/fetch_approvals.py`** — usage `uv run python scripts/fetch_approvals.py [--config ../config/area.yaml] [--out ../config/approvals] [--cache .cache/approvals] [--record DIR]`; reads rows via `read_figure_config(...).rows`, mappings via `read_mappings(cfg.mechanisms_dir)`, overrides from `<out>/overrides.csv`; writes `<out>/approvals.csv`; prints the review in four headed blocks ("Found by one source only", "Sources disagree", "Hand rows", "Label mentions with a negation nearby") and the counts per disease. Module docstring in the `map_mechanisms.py` style, including the `SSL_CERT_FILE` note. Smoke test: `uv run python scripts/fetch_approvals.py --help` exits 0.
- [ ] **Step 5: Write `config/approvals/README.md`** — what approved means (spec §5.4 text: any drug on the target with the same action and modality, ever approved by any regulator, withdrawn kept and labelled), the two files and who writes them, the hand-file rules (`add` needs `source_url`; `exclude` for a false hit; `withdrawn`), how to re-run and read the review print, sources and licences (ChEMBL CC BY-SA 3.0; openFDA public domain), and a "Release" line left as `ChEMBL_37 (2026-05-01); openFDA labels fetched <date>` with the date filled in Task 11.
- [ ] **Step 6: Run** the full pipeline gates → PASS.
- [ ] **Step 7: Commit** `feat(approvals): build approvals with a review print; fetch_approvals.py`.

### Task 6: Pipeline join into `pipeline.json`

**Files:**
- Modify: `pipeline/src/trialradar/pipeline_figure/build.py` (`build_pipeline_doc` gains `approvals`), `pipeline/src/trialradar/pipeline.py` (`_pipeline_figure` reads the file), `pipeline/scripts/pipeline_report.py`, `pipeline/scripts/make_web_fixtures.py`
- Create: `pipeline/tests/fixtures/approvals/approvals.csv` (CD20 × MS: two drugs, ChEMBL + FDA; CD20 × NMOSD: one hand drug with regulator `PMDA`, year 2022; one withdrawn-only cell on another fixture row if the fixture has one, else CD20 × CIDP withdrawn only)
- Regenerate: `web/tests/fixtures/data/pipeline.json` (run `uv run python scripts/make_web_fixtures.py`)
- Test: `pipeline/tests/unit/test_pipeline_figure_build.py`, `pipeline/tests/integration/test_pipeline.py`

**Interfaces:**
- Consumes: `read_approvals`, `Approval`, `ApprovalsError` (Task 2).
- Produces: `build_pipeline_doc(..., warnings: list[str], approvals: Sequence[Approval] = ())`; each row dict gains `"ap": {disease_code: [ {"d": drug, "src": [sources...], "url": url, "wd"?: true, "reg"?: str, "y"?: int} ]}` only when non-empty; drugs per cell in file order (non-withdrawn first, then withdrawn).
- `_pipeline_figure` loads `cfg.approvals_dir / "approvals.csv"`: missing → warning `approvals: missing`; `ApprovalsError` → warning `approvals: <message>`; both → `approvals=()`. Unknown row ids or disease codes → one warning `approvals_unknown: <row_id × code, …>` (sorted, deduplicated) and those lines skipped.
- `pipeline_report.py` prints `Approved cells: MS 12, MG 2, …` (codes in figure order, zero codes omitted) from `pipeline.json`.

- [ ] **Step 1: Write the failing tests** — `test_ap_joined` (keys and order as above, `wd`/`reg`/`y` omitted when default), `test_ap_omitted_when_none`, `test_ap_unknown_row_warns` (and unknown disease), and in integration `test_run_without_approvals_warns_missing` (still writes `pipeline.json`, no row has `ap`, warning `approvals: missing`), `test_run_bad_approvals_warns_and_builds` (bad header → `approvals: …approvals.csv:1: …`).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**; point `make_web_fixtures.py` at `fixtures / "approvals"` like the other fixture dirs; regenerate the web fixture and check it gained `ap` on `cd20` only where the fixture says.
- [ ] **Step 4: Run** pipeline gates, and `npx vitest run` in `web/` (the regenerated fixture must not break existing tests).
- [ ] **Step 5: Commit** `feat(pipeline): approvals joined into pipeline.json (R19)`.

### Task 7: Web types and helpers

**Files:**
- Modify: `web/src/types.ts`, `web/src/lib/pipeline.ts`
- Test: `web/tests/pipeline.test.ts`

**Interfaces:**
- Produces:
  - `export interface PipelineApproval { d: string; src: ("chembl" | "fda_label" | "hand")[]; url: string; wd?: boolean; reg?: string; y?: number }`; `PipelineRow.ap?: Record<string, PipelineApproval[]>`.
  - `approvalsIn(row: PipelineRow, code: string): PipelineApproval[]` (`[]` when none).
  - `floorRule(row: PipelineRow, code: string): boolean` — true when some approval in that cell is not withdrawn.
  - `approvalText(row: PipelineRow, code: string, label: string): string | null` — `"Approved for {label}: {d1}, {d2}."` listing non-withdrawn drugs only; null when `floorRule` is false.
  - `sourceText(a: PipelineApproval): string` — `"ChEMBL · FDA label"` (from `src`, in that order, `hand` omitted), and for hand rows `"{reg} {y} · hand"` (missing parts dropped, e.g. `"PMDA · hand"`).
  - `hasApprovalData(f: PipelineFile): boolean` — true when any row has `ap`.
  - `export interface DiseaseLine { code: string; label: string; trials: number; running: number; byPhase: [number, number, number, number]; furthest: 0 | 1 | 2 | 3 | 4; approvals: PipelineApproval[] }`
  - `diseaseLines(f: PipelineFile, row: PipelineRow): DiseaseLine[]` — one per disease in `f.diseases` order that has a mark (deduplicated by NCT) or an approval; `running` counts `markState(m, code) === "run"`; `byPhase[c-1]` counts marks by `m.c`; `furthest` = max `c` (0 when no trials); approvals non-withdrawn first.

- [ ] **Step 1: Write the failing tests** — `floorRule false when all withdrawn`, `approvalText lists non-withdrawn drugs`, `sourceText` (three cases above), `diseaseLines order, counts and furthest` on the fixture `pipeline.json` (CD20: MS line with the two fixture drugs; a disease with an approval and no trials appears with `trials 0`, `furthest 0`), `hasApprovalData`.
- [ ] **Step 2: Run** `npx vitest run tests/pipeline.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** `feat(web): approval types and helpers`.

### Task 8: Floor rule in the By disease figure

**Files:**
- Modify: `web/src/components/pipeline/PipelineFigure.tsx` (cell at the `cellMarks` map, ~line 156), `web/src/components/pipeline/PipelineStrip.tsx`, `web/src/components/pipeline/PipelinePage.tsx` (legend, ~line 98), `web/src/components/pipeline/pipeline.css`
- Test: `web/tests/PipelinePage.test.tsx`

**Interfaces:**
- Consumes: `floorRule`, `approvalText` (Task 7).
- Produces: markup contract used by the e2e test: an approved cell has class `ap` and contains `<i class="floor" aria-hidden="true" />` plus a visually hidden span with `approvalText`; its `title` is `approvalText`. Legend item `data-key="approved"`, By disease only.

- [ ] **Step 1: Write the failing tests** — under `?view=disease`: the CD20 × MS cell has `.floor` and accessible text "Approved for Multiple sclerosis: …"; a withdrawn-only cell has none; By phase and By year have no `.floor` and no `approved` legend item; `floor rule survives the lens` (with a company lens on, the `.floor` element has no reduced opacity class/style); the phone strip (mock `usePhone` true as existing tests do) shows `.floor` in the same cell.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** CSS: `.cell.ap .floor { position: absolute; left: 6px; right: 6px; bottom: 4px; border-top: 2px solid var(--ink); }`, phone strip inset 3px / bottom 1px; cells with `ap` get enough bottom padding that the rule never touches a mark (desktop 12px, strip 8px); `.lensed` must not dim `.floor`; the legend's rule swatch is the same ink line, 18px wide. The rule also renders in an empty cell (above the nodot).
- [ ] **Step 4: Run** web gates → PASS.
- [ ] **Step 5: Commit** `feat(web): approved floor rule in By disease cells`.

### Task 9: Target page panel e "By disease"

**Files:**
- Create: `web/src/components/target/TargetDiseases.tsx`
- Modify: `web/src/components/target/TargetPage.tsx` (render after panel d's section), `web/src/components/target/target.css`
- Test: `web/tests/TargetPage.test.tsx`

**Interfaces:**
- Consumes: `diseaseLines`, `sourceText`, `hasApprovalData` (Task 7).
- Produces: `TargetDiseases({ file, row, disease, phone }: { file: PipelineFile; row: PipelineRow; disease: string | null; phone: boolean })` inside `<section className="sec" aria-labelledby="pe">` with `<h2 id="pe">{row.label} by disease</h2>` and the plate letter "e" as the other panels do.

Layout (spec §6.2, mockup `panel-e-options.png` E1): desktop grid columns Disease (full label, 14px bold) | Trials (count 15px, "{k} running" in `--run`) | ladder (four segments: header labels Phase 1, Phase 2, Phase 3, Approved use; 6px bars, furthest in `--ink`, earlier in `--fam`, later `--pale`; counts beneath, blank for 0) | Approved for this disease (each drug linking to `url`, `target="_blank" rel="noreferrer"`, with `sourceText` in muted 11px; withdrawn drugs after the others with a muted "withdrawn" tag; the group underlined by the 2px ink floor rule only when a non-withdrawn drug exists; else "None approved" muted). `?disease=` line: `aria-current="true"` and ink-weight emphasis. No approval data in the file (`hasApprovalData` false): the aside adds " · Approval data not available" and the column header and cells are omitted. Phone (≤ 640px): one block per disease, name left and "{n} trials · {k} running" right, ladder below (no header row; segment labels P1 P2 P3 Approved use beneath counts), then the approved list.

- [ ] **Step 1: Write the failing tests** — panel e renders with lines in disease order for CD20; MS line shows both fixture drugs with links and "ChEMBL · FDA label"; NMOSD hand drug shows "PMDA 2022 · hand"; `panel e withdrawn tag, no rule`; a disease with no approvals reads "None approved"; `?disease=MS` sets `aria-current` on the MS line only; a file without any `ap` shows "Approval data not available" and no "None approved"; phone layout renders the blocks.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** web gates → PASS.
- [ ] **Step 5: Commit** `feat(web): target page panel e By disease`.

### Task 10: Methods, docs, e2e

**Files:**
- Modify: `web/src/components/Methods.tsx` (new section after `#unrowed`), `web/tests/Methods.test.tsx`, `web/tests/plainWords.test.tsx` (if it lists sections), `web/e2e/front-door.spec.ts`, `README.md`, `DESIGN.md`, `.impeccable/design.json`, `config/pipeline/README.md` (one line pointing to approvals)

**Interfaces:**
- Produces: Methods `<section id="approved" aria-labelledby="approved-h">` with `<h2 id="approved-h">Approved for this disease</h2>`.

- [ ] **Step 1: Write the failing tests** — Methods: section exists and its text names ChEMBL, FDA labels and the hand file, says "any regulator", says withdrawn drugs are listed but not underlined, says MOGAD has no ChEMBL term, distinguishes the figure's "approved use" column (a trial phase), and explains in one or two sentences why panel e has no success rate (approval is not a later-phase trial, so approved classes would read as failures). e2e: `/?view=disease` shows at least one `.cell.ap .floor` (desktop and phone projects); `/target/cd20` shows heading "CD20 by disease" and a drug link.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Write the copy and docs.** README: the figure and target-page paragraphs gain one sentence each, plus `fetch_approvals.py` in the hand-run scripts list. DESIGN.md and `.impeccable/design.json`: the floor rule (2px ink, inset 6px / 3px phone, By disease only) and panel e.
- [ ] **Step 4: Run** all web gates and the e2e suite from a scratch build (`npx vite build --outDir <scratch>/webdist`, fixtures copied as the existing e2e setup does; a port other than 4173).
- [ ] **Step 5: Commit** `docs: approved for this disease in Methods, README, DESIGN; e2e`.

### Task 11 (controller, with Martin): real fetch, hand rows, real-data check

Not for an implementer subagent: needs network and Martin's review.

- [ ] **Step 1:** Run `SSL_CERT_FILE=<ca.pem> uv run python scripts/fetch_approvals.py` from `pipeline/`. Save the review print.
- [ ] **Step 2:** Verify the three seed hand rows against the regulator's own page (zilucoplan MG FDA 2023; rituximab NMOSD PMDA, Japan; nabiximols MS MHRA 2010); add to `config/approvals/overrides.csv` only those confirmed and not found automatically. Add `exclude` rows for any false hit the review shows.
- [ ] **Step 3:** Show Martin the review print and the resulting cell list (compare with spec §3's ~19 cells). Commit `approvals.csv`, `overrides.csv` and the README release line only after his OK: `data: approvals from ChEMBL_37, openFDA and hand rows`.
- [ ] **Step 4:** Rebuild the real-data site in the session scratch, `scripts/pipeline_report.py` (size gate, approved cells line), screenshots at 1280 and 375, light and dark: By disease, and target pages CD20, FcRn, C5, BTK. Run the design finish review (Sonnet, `impeccable:impeccable-finish-reviewer`) on them and apply its material fixes.

### Task 12: Final whole-branch review (Opus)

- [ ] **Step 1:** Opus reviewer over `daedcda..HEAD` against the spec and this plan. Fix Critical and Important findings; scoped re-review.
- [ ] **Step 2:** HANDOFF.md §00 gets a Session 9 block (what was built, real numbers, rulings, deferred minors, gates). Commit. Do not push.
