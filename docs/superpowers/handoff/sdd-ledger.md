# SDD ledger — plan: docs/superpowers/plans/2026-11-04-trial-radar-slice1.md
Scope this run: Tasks 1–2 only (user request). Spec: docs/superpowers/specs/2026-11-04-trial-radar-slice1-design.md

## Pre-flight scan
| Rows | Produces / consumes | Finding |
|---|---|---|
| T1 ↔ T2 | T1 `make_study`, `AreaConfig`, area.yaml → T2 predicates + script params | consistent |
| T2 ↔ T5/T7 | T2 had `test_normalize_recorded.py` needing normalize (T5) + quality (T7) | CONFLICT: T2 runs before T5/T7 |
| T2 ↔ T10 | T2 `sample20.jsonl` → T10 integration | consistent |
| T1 ↔ T11/T12 | T1 ci.yml → T12 adds web job | consistent |
| T1 self | tests vs config/files | consistent; .gitignore lacks `.superpowers/` |
| T2 self | presence test vs recording needing blocked network | CONFLICT: committing presence test before recording makes CI red |

Ruling: moved `test_normalize_recorded.py` from Task 2 to Task 7 (plan edited) — T2 can't import code that doesn't exist yet — cost if wrong: realism check happens 5 tasks later.
Ruling: Task 2 adds `test_record_predicates.py` (offline) now; `test_fixtures_present.py` lands only with the recorded fixtures — keeps CI green while the recording waits — cost if wrong: one extra small test file.
Ruling: recording runs via `record-fixtures.yml` workflow_dispatch on GitHub (container blocks clinicaltrials.gov; repo default branch is this branch so dispatch works) — cost if wrong: user must run it manually.
Ruling: `.gitignore` also includes `.superpowers/` — SDD workspace is scratch — cost if wrong: none.
Ruling: `requires-python = ">=3.12"`, `.python-version` 3.12 (python3.12 available locally; CI pins 3.12) — matches spec — cost if wrong: none.

Task 1: ⚠️ items resolved by controller: `uv sync --locked` ok, 12 passed, ruff + mypy clean.
Task 1: minor (deferred): test_invalid_config_rejected lacks match= per case
Task 1: minor (deferred): no test for aliases_dir resolved relative to YAML dir; missing-file / non-mapping paths untested
Task 1: minor (deferred): Thresholds unbounded; tracked_fields may be empty/duplicated
Task 1: minor (deferred): ci.yml push+pull_request double-runs on PR branches
Task 1: minor (deferred): make_study.DELETE duplicates module DELETE
Task 1: complete (commits f7e2a3c..ead279e, review clean)
Ruling: presence test committed now under `recorded` marker (excluded from default run); record-fixtures.yml records, validates with `pytest -m recorded`, commits fixtures to the dispatching branch — avoids hand-carrying an artifact — cost if wrong: presence test not in CI until the marker exclusion is dropped after recording.
Task 2: minor (deferred): recorder retries only HTTP status, not httpx.TransportError
Task 2: minor (deferred): dispatch on a tag → detached checkout, push fails (branch-only by design)
Task 2: minor (deferred): plain git push may race concurrent push (manual workflow; artifact uploaded first)
Task 2: minor (deferred): `.get("enrollmentInfo", {})` breaks on explicit null
Task 2: minor (deferred): test_fixtures_present imports from test_record_predicates (sys.path coupling)
Task 2: fix round 1/5 (2 addressed, 0 open — no-diff commit failure; workflow structure test; commits 1d858a4..386f8ea)
Task 2: minor (deferred): workflow structure test uses substring matches (presence, not ordering)
Task 2: minor (deferred): `git push` relies on checkout-set upstream
Task 2: complete (commits ead279e..386f8ea, review clean) — recording pending via record-fixtures.yml dispatch
Ruling: final whole-branch review deferred to the end of the plan (this run is Tasks 1–2 only, per user) — cost if wrong: cross-task issues in T1–T2 surface later.
Task 2: recording dispatch via GitHub API refused (403 "Resource not accessible by integration"); CI run 41829321761 on 386f8ea green. User must dispatch record-fixtures.yml or allow clinicaltrials.gov.
Task 2: recording done — run 41830521002 green; commit 2ccd2f3 (version 2.0.5, dataTimestamp 2026-11-03T10:00:05); `pytest -m recorded` 8 passed locally; default suite 24 passed.
Note for Task 5: real data has month-precision dates with NO `type` key (NCT01765556, NCT00046943) → date type must be nullable.
Task 2: minor (deferred): month_date and no_sites fixtures are the same study (NCT01765556) — weaker edge coverage.
Pending follow-up: drop `recorded` from default addopts exclusion now that fixtures exist (ruling 6).
Scope extended by user: Tasks 3–9 (model switched to sonnet-5-5; commit trailer now 'Claude Sonnet 5.5').
Task 3: ⚠️ items resolved by controller (conftest helpers + version.json exist; 43 passed, ruff+mypy clean)
Task 3: minor (deferred): Retry-After uncapped/inf; malformed 200 body / missing dataTimestamp raises non-CtGovError; repeated nextPageToken loop unguarded; test reads client._http
Task 3: complete (commits 2ccd2f3..5a77727, review clean) — includes addopts follow-up (fixture-present tests now in default run)
Task 4: review → 2 Important (determinism test doesn't guard mtime; no fsync before os.replace). Fix round 1 dispatched (resume ad58264).
Task 4: minor (deferred): mkstemp leaves mode 0600; regex should be fullmatch with [0-9]; list_snapshots on missing dir raises (Task 10 must handle first-run/empty raw dir); no byte-level test for newline/UTF-8
Task 4: fix round 1/5 (2 addressed, 0 open — determinism test guards mtime; fsync before replace; commits 63060d5..3d8155b)
Task 4: minor (deferred): order test doesn't pin fsync-after-gzip-close
Task 4: complete (commits 5a77727..3d8155b, review clean)
Task 5: ⚠️ items resolved by controller (real NBSP chars present in test_textnorm.py; fixture names exist; 73 passed, ruff+mypy clean)
Task 5: minor (deferred): whitespace-only skip untested; alias CSV BOM (use utf-8-sig) + duplicate keys last-wins; parse_ct_date regex `$` → fullmatch; all-null site rows emitted; smoke test normalises twice/hard-codes 7
Ruling: non-aliased strings are NOT casefolded in Tables (display values stay readable); Task 6 tracked_state casefolds via norm_key for LIST fields (conditions, interventions, outcomes) only; scalar lead_sponsor compared as normalised text (NFKC+whitespace), so a pure case change in a sponsor name WILL show as a change — cost if wrong: occasional cosmetic sponsor-case change row; fix = add sponsor alias.
Task 5: complete (commits 3d8155b..4fe35d9, review clean)
Task 6: dispatched implementer a6c48aec (opus), base 4fe35d9; waiting.
Task 6: review (opus) → spec ✅, approved, 0 Critical/Important. Reviewer Minor 1 (state stores casefolded keys → UI would show lowercase) escalated by controller.
Ruling: tracked state stores DISPLAY text for list fields (norm_text, dedup by norm_key, smallest variant wins); diff compares key sets; rows carry display values — supersedes earlier casefold ruling — the UI renders old→new directly from trial_change; cost if wrong: slightly larger state/hash churn (hash differs on case-only edits, harmless since fast path just falls through).
Task 6: fix round 1 dispatched (resume a6c48ae): display-text storage + tests.
Cross-task notes: Task 8 store must round-trip state ints as ints (state.json/Parquet) so enrollment int check works; Task 9 export must handle SQL-null old_value on `_tracked` "added" rows AND JSON string "null" for None field values; `_tracked` rows never notable; list_snapshots on missing raw dir raises (Task 10 first-run).
Task 6: minor (deferred): empty-key handling inconsistent for outcomes vs conditions; reason-precedence test only exercises distinct fields
Task 6: fix round 1/5 (5 addressed, 0 open — display text in state, key-set compare, hash fall-through test; commits 262df97..52656a9)
Task 6: minor (deferred): _outcome_pairs keeps two parallel dicts
Task 6: complete (commits 4fe35d9..52656a9, review clean)
Task 7: review → 1 Important (null nct_id raises TypeError in _check_dates/duplicate check); also vacuous assert `"2" in errs[0]`. Fix round 1 dispatched (resume a9faa85).
Task 7: minor (deferred): implementer extras (empty-string schema, <study #i> label) and non-dict/None protocolSection untested; cap untested for other prefixes; ESTIMATED-start warning untested; test_sample20_clean duplicates test_normalize_recorded; duplicate check is tables-only (raw dupes pass if normalize ever dedupes)
Task 7: fix round 1/5 (2 addressed, 0 open — null-id guard in dates/duplicates, exact-count asserts; commits 765d9fd..7fd6f8c)
Task 7: minor (deferred): empty-string nct_id would count as duplicate; `<row i>` index meaning undocumented and differs between schema check (raw position) and others (trial-table position)
Task 7: complete (commits 52656a9..7fd6f8c, review clean)
Task 8: dispatched implementer a292c979 (sonnet), base 7fd6f8c; waiting.
Task 8: review (opus) → 1 Important (same-day --force crash between swaps → next day diffs vs state 2 days old, duplicate changes, cleanup deletes only good copy) + missing test. Fix round 1 dispatched (resume a292c97).
Ruling: state_before picks the valid dir (current / .state-old / previous) with greatest state_date < day; save_state self-heals a missing current from a valid .state-old first; an EXISTING-but-invalid current raises StoreError (recovery = `trialradar rebuild`) rather than silently falling back — cost if wrong: a corrupt current fails the daily run loudly until rebuilt.
Task 8: minor (deferred): replace_day writes changes then snapshots non-atomically; rotation rmtree(previous) before rename; files 0600/dirs 0700 via mkstemp/mkdtemp; append_run doesn't reject tz-aware started_at; private _fsync_dir imported from snapshot.py (move to shared fsutil)
Task 8: fix round 1/5 (R1–R5 addressed, 1 new Important in fix diff: stale .state-old trusted next to valid current → tie-break picks superseded state / heal can restore stale copy and rmtree newest previous; commits 18c9f20..f2a0eb4)
Ruling: `.state-old` is a recovery copy ONLY while current/ is missing; with a valid current it is superseded → ignored by state_before and deleted at the start of save_state — cost if wrong: one extra delete per save.
Task 8: fix round 2 dispatched (resume a292c97).
Task 8: minor (deferred): heal rename not dir-fsynced; _write_text doesn't fsync parent dir
Task 8: fix round 2/5 (1 addressed, 0 open — .state-old only a recovery copy when current missing; stale one deleted up front; commits f2a0eb4..830c0a2)
Task 8: minor (deferred): last assert in test_crashed_rotation_recovers_from_previous has `prev is None or` escape hatch; up-front rmtree uses ignore_errors (silent FS failure could leave stale .state-old); state_before docstring outdated
Task 8: complete (commits 7fd6f8c..830c0a2, review clean)
Task 9: review clean (0 Critical/Important)
Task 9: minor (deferred): export .tmp left behind on write failure; nct_id not validated before building path; meta warnings json.loads not type-checked list; is_file() guard before unlink; byte-identical-run / non-ASCII / null-warnings tests missing; meta test circular on area/conditions
Task 9: complete (commits 830c0a2..64bfdf0, review clean)
Scope Tasks 1–9 done; Tasks 10–14 remain (not in this run). Final whole-branch review dispatched over src as it stands (diff too large: uv.lock + fixtures).
FINAL REVIEW (opus, whole branch T1–9, ran the real chain on sample20 over 2 days + same-day --force + rebuild replay): chain composes correctly (round-trip lossless, idempotent, rebuild identical). Verdict "Ready for Task 10: Yes after fixes".
 Finding 1 CRITICAL (verified by controller on fixtures): production query pulls mostly off-topic trials — 6/20 sample20 studies in-area (MS/MG); rest healthy-volunteer, melanoma, obesity, etc. Suspected cause: bare synonyms "MS", "MG", maybe "Devic" (unverified; live API unreachable). NEEDS USER DECISION (scope of tracked set) — not fixed in this run.
 Finding 2 IMPORTANT: malformed raw (missing nctId, bad date) raises before quality.check → no `failed` run row. → Task 10 amendment: run raw-schema check before normalize and wrap every stage so any exception becomes a `failed` run_log row + `status=failed`.
 Finding 3 IMPORTANT: alias CSV edit → false lead_sponsor/intervention change rows (aliases applied at normalize time; stored tables keep old). Decision pending (recommend: tracked_state re-applies current aliases to stored raw names).
 Finding 4 IMPORTANT: rebuild can't reproduce data_timestamp/run_log (snapshots hold studies only). → Task 10 amendment: write `raw/YYYY-MM-DD.meta.json` sidecar (data_timestamp, fetched_at) with the snapshot; rebuild writes synthetic success rows.
 Finding 5 IMPORTANT: rebuild would replay failed days (snapshot written before quality.check). → Task 10 amendment: rebuild runs quality.check and skips days with errors; and a failed run deletes/renames its snapshot (`.failed`) before uploading.
 Finding 6–7 minor→fixed in fix wave (list_snapshots missing dir; BOM). Fix wave also: client CtGovError hardening (missing nctId, bad JSON, missing dataTimestamp, repeated nextPageToken, MAX_PAGES=100, Retry-After clamp), export hardening (.tmp cleanup, nct validation, meta warnings type, sweep is_file).
 Finding 8 minor: helpers for registry_dates / trial_snapshot frame → Task 10 should add `snapshot_frame(state, day)` and `registry_dates(tables)` in tracked.py, shared by run and rebuild.
 Finding 10 minor: drop-out-then-return only gets `added`; partial registry response bursts removed/added → decision pending (recommend: escalate row_drop > 25% to a quality ERROR in Task 10 config).
 Finding 11 minor: export must run BEFORE append_run(success) in Task 10 (so a failed export doesn't mark the timestamp done).
Ruling: fix wave scoped to mechanical hardening A–D only; query/relevance (F1), alias semantics (F3), return-after-absence (F10) held for user decision — they change what the product tracks / reports — cost if wrong: Task 10 start delayed by one question.
Fix wave dispatched (a75a372, sonnet) base 64bfdf0.
USER DECISION (after final review): option A (client-side relevance filter + drop bare abbreviations + re-record fixtures) AND defaults (alias-stable comparison; >25% one-day drop = ERROR, >10% warning).
Ruling: raw snapshot stores ALL downloaded studies; relevance filter applies after snapshot, before normalize (and in rebuild) — so a rule change can be replayed — cost if wrong: larger raw snapshots (still small, gzip).
Ruling: relevance = conditions + keywords + MeSH `derivedSection.conditionBrowseModule.meshes[].term` matched as whole phrases against configured synonyms; title not used — cost if wrong: trials whose only MS signal is the title are missed.
Ruling: bare "MS","MG","Devic" removed from config — cost if wrong: trials listing only "MS"/"MG"/"Devic" as the condition are missed (documented limitation).
Task 9b dispatched (sonnet), base $(git rev-parse --short HEAD). Task 10 waits on 9b + user re-running record-fixtures.
Task 9b: review (opus) → spec ✅; 1 Important (no test distinguishes raw-name vs name_normalized re-aliasing: alias REMOVED/RETARGETED) → fix round 1 dispatched (resume a6e447d). Commits so far 29180f2..b73b0b8.
Task 9b: minor (deferred): ConditionSpec.synonyms accepts ""/whitespace (should be rejected by config validation + reach query builder); recorder early-stop path untested; is_relevant recompiles alternation per call; recorder raw scan unbounded (docstring); off_topic assertions weak
Task 10 reminder (from reviewer): prev and curr tracked states must both be built from stored tables under the SAME current Aliases — never compare stored tracked_hash values from earlier runs against newly computed ones (cutover would flag every trial once). Task 10 must therefore compute prev hashes freshly from stored tables.
Task 9b: fix round 1/5 (1 addressed, 0 open — alias removed/retargeted/control tests, mutation-verified; NBSP test; commit 2fc93c0)
Task 9b: complete (commits 29180f2..2fc93c0, review clean)
PENDING USER ACTION: re-run record-fixtures workflow (config now has no bare MS/MG/Devic and recorder selects in-area studies); then `pytest -m "recorded or recorded_fresh"` validates. Task 10 blocked until fixtures re-recorded (its integration test uses sample20 in-area).
Task 10: brief + addendum written; dispatching opus implementer, base 2fc93c0
Task 10: review (opus) → 1 Important (snapshot promoted BEFORE store write: failed store write / past --date overwrites good raw snapshot; rebuild diverges; reproduced) → fix round 1 dispatched (resume a82c1e8): promote after _persist & before export (snapshot first, sidecar second); fail fast when day < state_date; tests; extract staging helpers to snapshot.py + Store.wipe(). Commits so far 2fc93c0..b93f5a9.
Ruling: run_log stays APPEND-ONLY (audit trail of failed/skipped attempts); amend spec §6 to "same-day rerun deletes that date's trial_change and trial_snapshot rows; run_log is append-only" — spec text amended by controller after the fix round (doc commit). Cost if wrong: none downstream (last_success_timestamp/meta read the latest success row; rebuild equivalence is on changes()/snapshots()).
Ruling: accept raw/.incoming staging; accept_drop recorded in sidecar for rebuild; export non-atomic across files accepted for this slice BECAUSE Task 11 must gate Pages deploy on exit 0 (status=success only) — cost if wrong: a partially written site could deploy.
Task 10: minor (deferred): rebuild `_changes` outside the skip try (a diff error aborts after wipe; consider temp root + swap); second same-day data failure overwrites the earlier `.failed.*` (suffix with run_id; Task 11 must upload `*.failed.*` as an Actions artifact); rebuild normalises with TODAY's aliases so rebuilt trial_snapshot hashes differ after alias edits (document; hashes never compared); argparse exit 2 / KeyboardInterrupt skip $GITHUB_OUTPUT (step fails anyway); skipped-run test doesn't hash the store; check_raw runs twice (comment); live test crawls whole set.
Task 11 requirements from Task 10 review: gate upload/deploy on `status == success`; ensure raw-upload glob matches only `raw/????-??-??.jsonl.gz` (+ sidecars), never `.incoming/` or `*.failed.*`; upload `*.failed.*` as an artifact.
Task 10: fix round 1/5 (R-a..R-d addressed, 0 open; commit b93f5a9..1505998)
Task 10: minor (deferred, for whole-branch review): store can end ahead of raw if promote_staged raises/killed AFTER persist (next-day run clears `.incoming`, rebuild diverges) — fix idea: on start, promote staged pair if its day == committed_date() and sidecar timestamp matches state before clearing; rewind guard not airtight in crashed-rotation state (current missing, state only in previous/); committed_date loads all tables just to read the date (read state.json only); test 3 patches only save_state (not replace_day); half-promoted snapshot/sidecar pair vs accept_drop in rebuild
Task 10: complete (commits 2fc93c0..1505998, review clean)
Spec §6 amended by controller (run_log append-only; raw snapshots source of truth; relevance filter after snapshot).

## Session end (handoff written)
User re-ran record-fixtures (commit e436f10): fixtures are now in-area (20 MS studies); `pytest -m "recorded or recorded_fresh"` passes (9). Default suite has 11 failures from fixture-dependent tests → "Task 10b" (see docs/superpowers/HANDOFF.md §5). A dispatch for Task 10b was interrupted by the user before starting; nothing changed. Next: Task 10b → Task 11 → 12 → 13 → 14 → final whole-branch review → finishing-a-development-branch.

## Session 2 (no subagents; user chose inline execution)
Task 10b: complete — test-only fix, integration dataset fixed at 6 real + 8 clones + 2 off-topic; fixture-derived literals removed (commit after 1bd6369).
Task 11: complete — daily.yml (publishing gated on status=success; failure evidence artifact; keepalive in its own job with actions: write), live-check.yml, test_workflows.py. actionlint not run (blocked); keepalive-workflow pinned @v2 unverified.
Task 12: complete — web scaffold, changes feed, freshness badge; web fixtures generated by pipeline/scripts/make_web_fixtures.py with a freshness test.
Task 13: complete — trial detail, methods, Playwright e2e (desktop + 375px). Visual design pass deferred by user.
Task 14: README, SECURITY.md, docs/architecture.md, test_config_swap.py done. Go-live is a user step (Pages source = Actions, branch protection requiring ci, dispatch daily.yml). No independent review of Tasks 10b–14 yet; final whole-branch review still to do.
Final whole-branch review (session 2): sonnet reviewed web/workflows/docs, opus reviewed pipeline. No Critical. Fix wave applied: daily.yml (data branch only a missing branch = first run; order raw upload -> build -> deploy -> push data LAST; release tag from snapshot date), rebuild (temp store + swap, refuses no/partial snapshots unless --force, keeps gate warnings), config validators, outcome formatting, null-safe badge, filter reset, removed-trial link, doc fixes.
Ruling: data branch push is the commit point and goes last in daily.yml — a failed earlier step leaves state unchanged so the next run redoes the version; cost if wrong: a deployed site may briefly be one day ahead of the data branch (self-heals next run).
Ruling: rebuild refuses empty/partial raw sets (--force overrides) — cost if wrong: one extra flag in a rare recovery path.
Left (documented): failed/skipped run_log rows live only in the 30-day failure artifact; vite preview returns 200 for missing files (Pages returns 404); Task 8 crash-window items; perf/test-hygiene nits.
