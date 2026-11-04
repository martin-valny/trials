### Task 9b: Relevance filter, alias-stable comparison, large-drop error (decisions from the final review)

User-approved decisions (binding): (A) client-side relevance filter after download; remove bare abbreviations from the area config; recorder picks in-area studies. Defaults: (1) alias edits must not create change rows; (2) a one-day row drop > 25% is a quality ERROR, > 10% stays a WARNING.

**Files:**
- Create: `pipeline/src/trialradar/relevance.py`, `pipeline/tests/unit/test_relevance.py`
- Modify: `config/area.yaml`, `pipeline/src/trialradar/config.py` (+ `tests/unit/test_config.py`), `pipeline/src/trialradar/tracked.py` (+ `tests/unit/test_tracked.py`, `tests/unit/test_diff.py` call sites), `pipeline/src/trialradar/quality.py` (+ `tests/unit/test_quality.py`), `pipeline/scripts/record_fixtures.py` (+ `tests/unit/test_record_predicates.py`)

**Interfaces:**
- Consumes: `AreaConfig`, `norm_key` (textnorm), `load_aliases`/`apply_alias` (textnorm), `Tables`, `tracked_state`, `QualityReport`.
- Produces:
  - `relevance.is_relevant(study: dict[str, Any], cfg: AreaConfig) -> bool`
  - `relevance.filter_relevant(studies: Iterable[dict[str, Any]], cfg: AreaConfig) -> list[dict[str, Any]]` (input order preserved)
  - `Thresholds.row_drop_error: float = 0.25`, `Thresholds.min_relevant_share: float = 0.5` (validated: `0 < row_drop_warn <= row_drop_error <= 1`, `0 <= min_relevant_share <= 1`)
  - `tracked_state(tables: Tables, fields: Sequence[str], aliases: Aliases | None = None) -> TrackedState` where `Aliases` is a small frozen dataclass `Aliases(sponsor: Mapping[str, str], intervention: Mapping[str, str])` defined in `textnorm.py` with `Aliases.empty()` and `load_alias_set(aliases_dir: Path) -> Aliases` (loads `sponsor.csv` and `intervention.csv`; reuses `load_aliases`).
  - `quality.check(raw, tables, prev_trial_count, cfg, fetched_count: int | None = None) -> QualityReport` (new optional arg; existing callers keep working).

#### Relevance filter
- A study is relevant iff at least one configured synonym (from `cfg.conditions[*].synonyms`) matches at least one text drawn from: `protocolSection.conditionsModule.conditions[*]`, `protocolSection.conditionsModule.keywords[*]`, and `derivedSection.conditionBrowseModule.meshes[*].term` (all optional; tolerate missing/None/non-list/non-str entries).
- Matching: both sides through `norm_key`; the synonym must appear as a whole phrase: regex `(?<!\w)<escaped synonym>(?!\w)` against the text. So "multiple sclerosis" matches "Relapsing Multiple Sclerosis (RMS)" and "multiple sclerosis, relapsing-remitting" but NOT "multiple sclerosis-like" ... (hyphen is a non-word char, so "multiple sclerosis-like" DOES match; that is acceptable — do not special-case), and a short synonym such as "CIDP" must not match inside "CIDPX".
- The title is NOT used (conditions/keywords/MeSH only).
- No condition names are hard-coded: everything comes from `cfg`.
- Tests (offline, built with `make_study`/dicts): match on condition; match on keyword only; match on MeSH term only; phrase-boundary negative ("CIDPX" vs synonym "CIDP"); case/whitespace/NBSP insensitive; non-matching study (e.g. conditions ["Healthy"]) excluded; missing `conditionsModule`/`derivedSection`/None lists don't raise; `filter_relevant` keeps order and returns a list; a config with a different condition list (e.g. "psoriasis") filters accordingly (proves no hard-coding).

#### Config
- `config/area.yaml`: remove the bare abbreviations `"MS"`, `"MG"` and `"Devic"` from synonyms (keep the full phrases, `NMOSD`, `MOGAD`, `CIDP`); add `row_drop_error: 0.25` and `min_relevant_share: 0.5` under thresholds (keep `row_drop_warn: 0.10`). Update `test_config.py` expectations (repo config loads; thresholds defaults; invalid orderings rejected: `row_drop_error < row_drop_warn`, values outside [0,1]).

#### Alias-stable comparison
- `tracked_state` re-applies the CURRENT aliases to the stored RAW names: `lead_sponsor` = `apply_alias(raw lead name from the sponsor table row with role "lead", aliases.sponsor)` (fall back to the trial table's `lead_sponsor` if no lead row); `interventions` = `apply_alias(intervention.name, aliases.intervention)` per row (then the existing display/key de-dup). With `aliases=None`, behave exactly as today (existing tests unchanged).
- Tests: two Tables built from the same studies — one normalized with an alias CSV, one without — passed through `tracked_state` with the SAME `Aliases` object produce identical tracked states and `diff` emits ZERO rows (this is the alias-edit scenario); without passing aliases the old behaviour (a change row) is unchanged; BOM-prefixed CSV works (already supported). Also a test through `Store`-style round trip is NOT needed.

#### Quality
- `row_drop_error:` ERROR when `prev_trial_count` is not None, `> 0`, and `(prev - current)/prev` is strictly greater than `cfg.thresholds.row_drop_error`; the existing `row_drop:` WARNING still fires for drops strictly above `row_drop_warn` but NOT above `row_drop_error` (an error replaces the warning: no double reporting). `empty:` still pre-empts both.
- `off_topic:` WARNING when `fetched_count` is given, `> 0`, and `current_trial_count / fetched_count` is strictly less than `cfg.thresholds.min_relevant_share`; message includes both counts and the percentage. `fetched_count=None` → never fires.
- Tests: boundaries (exactly 25% → warning not error; 25.1% → error; exactly 10% → nothing); no double report; off_topic boundary (exactly 50% → nothing; below → warning); `fetched_count=None` silent; existing quality tests still pass unchanged.

#### Recorder
- `scripts/record_fixtures.py`: import `trialradar.relevance.filter_relevant`/`is_relevant` (scripts may import the package) and apply it to every fetched study BEFORE selection, so `sample20.jsonl` and every labelled fixture are in-area studies; count distinct *relevant* studies for the "fewer than 20" failure. Update/extend `test_record_predicates.py` accordingly (a non-relevant study is never selected, using `make_study` with conditions ["Healthy"]). Do NOT re-run the recorder (no network here) and do NOT modify the existing recorded fixtures; the user will re-record via the workflow. The existing `test_fixtures_present.py`/`test_normalize_recorded.py` must keep passing against the CURRENT recorded files — but note `sample20.jsonl` currently contains off-topic studies, so any NEW assertion that all sample20 studies are relevant must live in a test marked `@pytest.mark.recorded_fresh` (register the marker; excluded from default runs via addopts `-m 'not live and not recorded_fresh'` — keep the existing `recorded` marker behaviour as is) and the record workflow must run it after recording (`pytest -m "recorded or recorded_fresh"`; update `test_record_workflow.py` accordingly).

#### Steps (TDD)
- [ ] Write failing tests per section; run `uv run pytest` → FAIL (RED evidence in your report).
- [ ] Implement; run full suite, `uv run ruff check . && uv run ruff format --check .`, `uv run mypy src scripts` → all pass.
- [ ] Commit in focused commits (relevance+config; aliases; quality; recorder) with the trailer.
