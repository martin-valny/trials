# Small gaps and deferred minors — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Close the two open gaps from session 8 (`/trials` ignores `disease`; Fading stricter than its spec) and the deferred minors from session 9 (approvals), listed in HANDOFF §00.

**Specs (binding):** `docs/superpowers/specs/2026-11-09-by-year-and-explore-retire-design.md` (§ By year notes, § TrialsList), `docs/superpowers/specs/2026-11-09-approved-for-disease-design.md` (§5, §6.1, §6.2).

## Global Constraints

- No disease names or codes in code; they come from `config/area.yaml` (the config-swap test `pipeline/tests/integration/test_config_swap.py` enforces it for `web/src` too).
- R19: a missing or bad optional input gives a warning, never a lost output.
- JSON slimming: omit empty/default keys.
- Red means "advanced" only; the floor rule is `--ink`, never dimmed by the company lens or the Mostly historical fade.
- No hover-only information.
- Pipeline gates (from `pipeline/`): `uv run pytest -q`, `uv run ruff check`, `uv run ruff format --check`, `uv run mypy src`. Web gates (from `web/`): `npx vitest run`, `npx eslint .`, `npx tsc --noEmit`; e2e from a scratch build on a port other than 4173.
- Never push. Never use the Workflow tool. Another session commits stop-risk work on this branch and working tree: stage files by explicit path only; if a file you must edit has uncommitted changes you did not make, stop and report.

---

### Task 1: Approvals pipeline hygiene

**Files:** `pipeline/src/trialradar/approvals/{io,build,openfda}.py`, `pipeline/src/trialradar/pipeline_figure/build.py`, `pipeline/src/trialradar/pipeline.py`, `config/approvals/README.md`, tests beside them; regenerate `web/tests/fixtures/data/pipeline.json` (`uv run python scripts/make_web_fixtures.py`).

- [ ] `read_approvals` / `read_overrides` report the real file line (`reader.line_num`), so a blank line before a bad row does not shift the number. Test: blank line then a bad row → message names the right line.
- [ ] `write_approvals` raises `ValueError` on a source not in `SOURCES` instead of dropping it. Test.
- [ ] `OpenFdaClient.__init__` accepts the `record` trimmer keyword like `ChemblClient`, passed through to `JsonClient`. Test that a recorded file is trimmed.
- [ ] Review print: lines in "Found by one source only", "Sources disagree" and "Label mentions with a negation nearby" are emitted after variant folding, so a folded variant ("prednisolone acetate") no longer appears; a folded line's detail is attributed to the root drug, deduplicated. Test.
- [ ] Two molecules with the same name in one cell: the merged line keeps a DailyMed url when either has one (DailyMed > ChEMBL card), not "the later one". Test.
- [ ] `pipeline.json` gains a top-level `"approvals": true` when `approvals.csv` was read successfully (even with zero lines); omitted when missing or bad. Test both.
- [ ] `config/approvals/README.md`: one sentence that a label mention with "not indicated" / "limitations of use" nearby is never counted as an approval; it is only printed for review.
- [ ] Gates; commit `fix(approvals): line numbers, strict writer, record trimmer, folded review print, file-level flag`.

### Task 2: Disease codes on the trials index

**Files:** `pipeline/src/trialradar/export.py` (`_index`), its tests, `web/src/types.ts` (`TrialSummary.dz?: string[]`), regenerate web fixtures.

- [ ] Each `trials.json` summary gains `dz`: the trial's disease codes in `figure_order`, computed the same way the pipeline figure assigns a mark's `dz` (reuse that function; do not re-derive matching). Omitted when empty. Test with a fixture trial in two diseases and one in none.
- [ ] Check `trials.json` size growth on the fixture and note it in the report.
- [ ] Gates; commit `feat(export): disease codes on the trials index`.

### Task 3: `/trials` honours `disease`

**Files:** `web/src/components/TrialsList.tsx`, `web/tests/TrialsList.test.tsx` (or the existing Trials test file), `web/e2e/*.spec.ts` if an e2e covers the banner.

- [ ] With `?disease=CODE`, the list keeps only trials whose `dz` includes CODE (combined with `nct`, status and search). Unknown code → no filter and no crash.
- [ ] Banner: "Showing {n} trials from {from} in {disease label} · Clear" when both are set; "Showing {n} trials in {disease label} · Clear" with only `disease`. Disease label from `pipeline.json`'s `diseases` list if the page already loads it; otherwise load it via the existing data loader (no hard-coded labels). Clear removes `nct`, `from` and `disease`.
- [ ] The empty-state link keeps other search params (session 7b deferred minor) — only if it is the same line of code; otherwise leave it.
- [ ] Tests: disease alone, disease + nct, Clear removes all three, unknown code.
- [ ] Gates; commit `feat(web): /trials filters by disease`.

### Task 4: Fading as specified

**Files:** `web/src/lib/pipeline.ts` (Fading score ~line 498), `web/tests/pipeline.test.ts`.

- [ ] Spec: "row with ≤ 1 running and the most trials started before 2012 (min 15)". Drop the extra "more than half of the row's trials before 2012" condition. Keep min 15 total and ≤ 1 running; score = trials before 2012.
- [ ] Test: a row with ≤ 1 running, 20 trials, 9 before 2012 and 11 after now qualifies (it did not before); the existing Fading tests still pass or are updated with a reason.
- [ ] Gates; commit `fix(web): Fading note follows its spec`.

### Task 5: Approvals UI minors

**Files:** `web/src/lib/pipeline.ts` (`hasApprovalData`), `web/src/types.ts` (`PipelineFile.approvals?: boolean`), `web/src/components/pipeline/{parts.tsx,PipelineFigure.tsx,PipelineStrip.tsx,pipeline.css}`, `web/src/components/target/target.css`, `web/src/styles.css` (tokens), tests, `web/e2e/front-door.spec.ts`.

- [ ] `hasApprovalData(f)` is `f.approvals === true` (Task 1's flag), so "Approval data not available" shows only when the file was missing or bad, not when it has zero approvals. Update tests and the fixture-without-ap case.
- [ ] The hard-coded dark ladder colour (panel e pale segment, finish-review fix 4) becomes a token defined beside `--pale` for both themes (light value = current `--pale`), used by `.dzl .st i`.
- [ ] The floor rule's hover text uses the figure's own tooltip (`show(...)` in `PipelineFigure.tsx`, the `.tip` element) instead of the native `title`, with the same text; remove `title`. Phone strip: no tooltip (tap opens the target page as now). The visually hidden text stays.
- [ ] Phone strip: the floor's invisible hit area must not overlap marks — on the strip, the `::before` reaches no higher than the cell's bottom padding (8px) minus the rule; desktop unchanged if it already clears the 12px padding.
- [ ] e2e (desktop project): with a company lens on that misses CD20, the CD20 × MS `.floor` has computed opacity 1 on itself and every ancestor up to the row; and a Mostly historical row's floor likewise. This replaces nothing; the CSS-text tests stay.
- [ ] Gates incl. e2e; commit `fix(web): approvals UI minors (data flag, token, tooltip, hit area, e2e opacity)`.

### Task 6 (controller): verify and record

- [ ] Re-run `fetch_approvals.py` from the cached responses into scratch; `approvals.csv` must be byte-identical to the committed one (only the review print changes).
- [ ] Rebuild the real-data site into scratch; screenshot By year (1280, light) to check the Fading note, `/trials?disease=…` and a target-page "List these trials" hand-off; By disease hover on a floor rule.
- [ ] Opus final review over the plan's commits; one fix wave; HANDOFF §00 Session 9 deferred-minors line and small-gaps line updated.
