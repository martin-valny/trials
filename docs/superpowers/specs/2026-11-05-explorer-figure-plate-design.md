# Explorer ("Figure Plate") — design

Status: awaiting Martin's approval (builder check done) · 2026-11-05. Supersedes the open A/B/C restyle question in HANDOFF.md section 6 · builds on slice 1 (`2026-11-04-trial-radar-slice1-design.md`)

## 1. Intent

The site works but is boring: a list of trials, no summaries, only links out to ClinicalTrials.gov. Martin wants the home page to look striking *and* answer a real question: **do trials that succeed sit close together when trials are laid out by what they study?**

The answer is a new home page, the **Explorer**. It puts every tracked trial in one rotating 3D map. Trials are placed only by what they study (disease, treatment, population). Outcomes such as phase, success and stopped early are painted on afterwards and can be filtered, highlighted and compared. Every trial also gets its plain-language registry summary.

Primary audience is a hiring panel for a Forward Deployed Engineer role (life-sciences AI prototyping). They will spend minutes, not hours, so the first view must impress and clicking around must show real depth and honest method. Secondary audience: clinical-ops / competitive-intelligence leads; tertiary: researchers. See `PRODUCT.md`.

## 2. Goals, non-goals, anti-goals

**Goals**
1. A home page in the chosen "Figure Plate" visual direction (section 5) with a live, rotatable 3D map of all tracked trials.
2. Layout computed from study content only; outcomes are overlays and provably never inputs.
3. Outcome overlays: succeeded (defined in 6.3), stopped early, completed with unknown outcome, still running; plus colour-by phase and disease.
4. Filtering and highlighting by disease, phase, outcome, treatment type, and search by drug / sponsor / NCT id.
5. A selected-trial panel and an upgraded trial detail page, both showing the registry's brief summary.
6. One honest, quantified answer to the headline question (the neighbourhood statistic in 6.4), with its baseline.
7. Everything still $0, static, rebuilt daily, config-driven (no source file names a condition).

**Non-goals (this project)**
- The molecular-pathway graph (needs drug → target → pathway enrichment; a later slice).
- External drug databases (ChEMBL approval status, Open Targets). "Success" uses only our own registry data for now.
- Live reweighting of the layout in the browser (approach B; possible follow-up).
- Race/ethnicity (not in the protocol record).
- Restyling Changes / Trials / Methods beyond what they need to sit under the new header and nav. A broader restyle can follow once the Figure Plate system exists.
- The "Ask" AI feature (separate, paused brainstorm).

**Anti-goals (would be failure even if it works)**
- Implying causation or prediction. The page shows where outcomes fall, never that position "predicts" success.
- Calling a proxy "success" without saying what it is, anywhere it is shown.
- Neon / glowing black "AI dashboard" look.
- A layout that silently uses outcome information (leakage).
- A heavy page: first render must not wait on more than one data file beyond what exists today.

## 3. Constraints

- $0, no server, no secrets; GitHub Actions + Pages + Releases only.
- Pipeline: Python 3.12, uv, polars, strict mypy, ruff, pytest. Web: Vite + React 19 + TypeScript, HashRouter, vitest, Playwright e2e at desktop and 375px.
- New-therapeutic-area-is-config-only rule holds (a test enforces it).
- `main` protected; PRs only; merge only on Martin's say-so.
- Real data shape (snapshot 2026-11-05): 3,047 fetched studies (relevant subset somewhat smaller); 100% have `briefSummary`; ~99% have sex and ~98% minimum age; 618 (20%) have posted results; statuses: 1,624 completed, 385 unknown, 346 recruiting, 244 terminated, 167 active not recruiting, 148 not yet recruiting, 96 withdrawn, 28 enrolling by invitation, 9 suspended.

## 4. Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **A (chosen)** | Pipeline computes a 3D UMAP from content features once a day and exports coordinates + labels; the page only draws. | Deterministic, testable (including a no-leakage test), fast to load. Layout fixed per day; no live reweighting. |
| B | Pipeline exports feature vectors; the browser runs UMAP (umap-js). | Enables live "what counts as similar" sliders. Seconds of compute on load for ~3k trials, non-deterministic, hard to test. |
| C | A now, B later as an advanced mode. | Same as A for this project. |

Martin chose **A**. B remains a possible follow-up.

Visual direction: chosen through Impeccable's direction round (seed reference `seed:60730230eacb10e5`). Martin picked **"The Figure Plate" in its original colours** (section 5) after seeing poster, specimen, risograph, edition, glass and other alternatives.

## 5. The Figure Plate (what the visitor sees)

The page reads as **Figure 1 of the paper you would write about this landscape**, with panels a–d, live. The approved mockup is `.impeccable/mocks/decision/model-pick.html` (synthetic data); it is the composition the build matches.

```
┌──────────────────────────────────────────────────────────────────────┐
│ Trial Radar                          Explore  Changes  Trials  Methods│  slim top bar, freshness badge
├──────────────────────────────────────────────────────────────────────┤
│ Figure 1 | The <area> trial landscape, laid out by what each trial    │  figure title (area from meta)
│ studies, with outcomes painted on top.                                │
│ a  Embedding of N trials …                 │ b  Share of finished …   │
│   ·  · ·:·.  ·        ·:·::·.              │    MS      ████▌|   29%  │
│  ·:·::·.·  ·        ·::·:·:·               │    NMOSD   ███  |   19%  │  red tick = average
│   ·::·:              ·:·.                  │ c  Trials by phase       │
│        (rotating 3D canvas)    ··:·        │    ▇  █▇  █   ▇          │  red = drug moved on
├──────────────────────────────────────────────────────────────────────┤
│ Colour  [Outcome] Phase  Disease      Show [MS][NMOSD][MOGAD]…        │  figure legend = filter bar
│ d  <selected trial: id · drug · phase · status · n · sponsor · link>  │
│    Positions ignore outcomes. Success = … (definition link)           │
└──────────────────────────────────────────────────────────────────────┘
```

- **World:** white plate, near-black ink, one red accent (`#c8102e`) reserved for "succeeded"; supporting blue-grey; hairline rules; bold lowercase panel letters; figure title in "Figure 1 |" form; Hanken Grotesk (self-hosted, not Google CDN, to keep the CSP tight; exact face may change in the finish review).
- **Panel a (3D map):** canvas, slow auto-rotation, drag to rotate, click/tap to select, hover highlight; dot size = enrollment (sqrt-scaled); filtered-out trials drop to ~8% opacity rather than vanish, so the shape stays readable.
- **Panel b:** share of finished trials that succeeded, per disease (config condition labels), with an average tick; plus the neighbourhood statistic (6.4) as one sentence with its baseline.
- **Panel c:** trial counts by phase, with the "moved on" share highlighted.
- **Panel d / legend bar:** colour mode (Outcome / Phase / Disease), disease toggles, phase and treatment-type filters, search box; the selected trial's one-line facts, the first ~2 sentences of its brief summary, links to its Trial Radar page and ClinicalTrials.gov. A one-line definition of "succeeded" with a link to Methods.
- **States:** loading (skeleton plate), data missing / old data (reuse existing freshness rules; the explorer shows an explanation instead of an empty canvas), no trial selected, filters that match nothing ("No trials match these filters" + reset), canvas unsupported (fall back to the Trials list link).
- **Reduced motion:** no auto-rotation; layout changes snap.
- **Phone (375px):** panels stack a → d; canvas ~60vh; legend bar wraps; panel b/c below.
- **Dark mode:** follows `prefers-color-scheme` like the rest of the site; the dark variant is the "Dark slide" mockup (`plate-dark.html`) palette.

## 6. Data and method

### 6.1 New trial fields (pipeline)

`normalize` adds to the `trial` table: `brief_summary` (text), `sex` (`ALL|FEMALE|MALE|null`), `min_age_years`, `max_age_years` (float or null, parsed from strings like "18 Years", "6 Months"), `has_results` (bool). None of these are tracked fields, so they never create change rows. They flow into `trials/<NCT>.json` (summary, eligibility, has_results) and into the explorer features.

**Store compatibility:** existing Parquet on the `data` branch lacks these columns. The builder decides between reading old files with the new columns filled as null until the next run rewrites `current/`, or a one-off `rebuild` from raw snapshots. Either way, a daily run on the existing `data` branch must not fail the `schema` quality check.

### 6.2 Features for the layout (content only)

One row per relevant trial, built from:
- **Disease:** multi-hot of the config condition labels each trial maps to (via the existing relevance matching), plus TF-IDF of its MeSH condition terms for finer structure.
- **Treatment type:** multi-hot of intervention types (DRUG, BIOLOGICAL, DEVICE, BEHAVIORAL, PROCEDURE, …).
- **Molecule:** TF-IDF of normalized intervention names (aliases applied), excluding placebo / sham / standard-of-care terms (list in config, not source).
- **Population:** age band flags derived from min/max age (paediatric, adult, older adult) and sex.

Blocks are scaled so each contributes comparably; block weights live in config. **Explicitly excluded:** status, phase, dates, enrollment, results, why_stopped, sponsor, sites, outcomes. A test asserts the feature builder's inputs contain none of these columns.

UMAP to 3D, cosine metric, fixed `random_state`. 3,000 rows runs in well under a minute in CI. New dependencies: `umap-learn` and `scikit-learn` (TF-IDF); the builder may substitute an equivalent if install size is a problem. Exact coordinates may differ across machines; tests check structure, not exact numbers.

### 6.3 Outcome labels (overlays only)

| Label | Definition | Applies to |
|---|---|---|
| **Succeeded** | Status COMPLETED **and** at least one drug/biologic from its **experimental arm(s)** (a) had **no** Phase 3/4 trial in our set starting before this trial started, and (b) appears in a tracked trial of a **later phase** that started after this trial's start date and is not WITHDRAWN. | Early Phase 1 – Phase 2/3 |
| Stopped early | TERMINATED, WITHDRAWN or SUSPENDED | all |
| Completed, outcome unknown | COMPLETED and not "Succeeded" (includes all Phase 3/4 and N/A for now) | all |
| Still running | RECRUITING, NOT_YET_RECRUITING, ACTIVE_NOT_RECRUITING, ENROLLING_BY_INVITATION | all |
| Status unknown | UNKNOWN | all |
| Results posted | `has_results` (separate toggle, combinable) | all |

Experimental-arm drugs come from the registry's `armsInterventionsModule.armGroups` (arm `type == EXPERIMENTAL`, its `interventionNames`). `normalize` gains an `arm_intervention` table (`nct_id`, `arm_type`, `intervention_name` raw and normalized); a trial with no arm groups falls back to all its drug/biologic interventions minus placebo/standard-of-care terms. This is why comparator and add-on drugs (interferons, ocrelizumab in MS) do not make a trial "succeed": Martin chose this definition so the label measures progress of a new drug.

**Drug-name matching:** the intervention alias file is empty today. Add an automatic cleaning step (lower-case, strip dose/unit/route/regimen words, bracketed text and common salt suffixes) plus a seed alias list for the ~30 most frequent drugs in the snapshot (brand ↔ INN ↔ code name). Wider curation is a follow-up.

Wording on the page is always "Succeeded (drug moved to a later phase)", never bare "successful". Methods states the limits: our set covers one therapeutic area, so progress in another indication is missed; a later-phase trial does not prove the earlier one met its endpoint; Phase 3/4 have no success label until external approval data is added. Combined phases (e.g. PHASE2|PHASE3) use the highest phase.

### 6.4 The headline statistic

**Pool:** finished trials in phases that can succeed (Early Phase 1 – Phase 2/3; COMPLETED or stopped early). Panel b's "finished" counts and `success_rate` use the same pool.

**Statistic ("neighbourhood lift"):** for each succeeded trial in the pool, find its k = 10 nearest neighbours **within the pool**, in the **original feature space** (cosine), **excluding neighbours that share any experimental-arm drug with it**. Lift = mean share of those neighbours that also succeeded ÷ the pool's success rate. Same-drug neighbours are excluded because the molecule block places same-drug trials together and the label is defined through drugs, so they would agree by construction; Methods says this in one sentence.

**Baseline:** shuffle labels within the pool 1,000 times (fixed seed), recompute; report the mean and the 2.5–97.5% range.

**Honesty rules on the page:** fewer than 30 succeeded trials → the number is withheld ("Too few successes in this area to measure clustering yet"). Lift inside the shuffled range → "Successful trials cluster no more than chance would". Otherwise e.g. "Successful trials' neighbours succeed 1.4× more often than chance (shuffled: 0.9–1.1×)". Export carries `n_pool`, `n_succeeded` and a `verdict` (`insufficient|chance|clustered`).

Computed in the pipeline and covered by tests on synthetic data: a planted cluster yields `clustered`; shuffled labels yield `chance`; same-drug neighbours are excluded; below 30 gives `insufficient`.

### 6.4a Day-to-day stability

UMAP is refit daily. To keep the map recognisable, each day's coordinates are aligned to the previous day's by an orthogonal Procrustes rotation (plus reflection and scale) fitted on trials present both days. Previous coordinates are stored on the `data` branch (`explorer/coords.parquet` at the store root); with no previous coordinates (first run, rebuild) the raw layout is used.

### 6.5 Export contract

New file `explorer.json`, written by `export`:

```json
{
  "generated_for": "YYYY-MM-DD",
  "method": {"algorithm": "umap", "dims": 3, "seed": 42, "features": ["disease", "treatment_type", "molecule", "population"], "k": 10},
  "stats": {"verdict": "clustered", "lift": 1.4, "baseline_mean": 1.0, "baseline_range": [0.9, 1.1], "n_pool": 640, "n_succeeded": 120, "success_rate": 0.19, "by_condition": [{"label": "...", "finished": 120, "succeeded": 35}]},
  "trials": [{"nct_id": "NCT…", "x": 0.12, "y": -0.4, "z": 0.9, "title": "…", "condition_labels": ["…"], "phase": "PHASE2", "outcome": "succeeded|stopped|completed_unknown|running|unknown", "has_results": true, "treatment_types": ["DRUG"], "drugs": ["…"], "enrollment": 120, "lead_sponsor": "…", "start_year": 2019}]
}
```

Sorted by `nct_id`, compact JSON like the other files. Brief summaries are **not** in this file (size); the selected-trial panel lazy-loads `trials/<NCT>.json`. Web types in `web/src/types.ts` mirror it exactly; web fixtures are regenerated by `scripts/make_web_fixtures.py` and the existing staleness test covers them.

## 7. Web changes

- New route `/explore` and `/` redirects to it; nav gains "Explore" first. Changes, Trials, Methods, Trial detail keep working at their URLs.
- New components for the plate (canvas renderer, panels b/c, legend/filter bar, selected-trial panel). Rendering is plain Canvas 2D (no WebGL / three.js needed at ~3k points), as in the mockup.
- Trial detail page: add "Summary (from the registry)" with the brief summary, eligibility (sex, age range) and a "Results posted" mark with link.
- Methods page: new section "How the map is made" (features, exclusions, UMAP, success definition and limits, the neighbourhood statistic).
- Accessibility: canvas has an accessible name and a visually hidden text summary; every control keyboard-reachable; outcome always conveyed by legend text too; the selected trial is announced; a "View as list" link goes to Trials with the same filters where feasible.

## 8. Testing and evaluation

- Pipeline unit tests: field parsing (ages, sex, summary), feature builder (no excluded columns; placebo terms dropped; config weights applied), outcome labelling (each rule, combined phases, start-date ordering), lift statistic on planted / shuffled synthetic data, export contract shape, determinism with fixed seed on one machine.
- Config-swap test still passes (no condition names in source).
- Web unit tests: filtering, colour modes, selection, empty-filter state, missing-data state.
- E2E (desktop + 375px): explore loads, a trial can be selected and opens its detail page, filters change the visible count, reduced-motion stops rotation.
- Impeccable finish: direction contract recorded in the surface brief before code; finish review against the mockup; DESIGN.md written from the shipped build by the documenter; `impeccable detect` on changed UI files.

## 9. Decided by Martin

- Approach A (pipeline-computed layout).
- Figure Plate visual direction, original colours.
- Explorer becomes the home page; other pages stay as tabs.
- Hiring panel first; no neon sci-fi look.
- "Success" = completed + drug moved on (our data) now; external approval data later; posted results where available.
- "Moved on" counts only experimental-arm drugs that were not already in late phase (Phase 3/4) before the trial started.
- Pathway graph is a later, separate project.

## 10. My calls (check these)

1. "Succeeded" applies only up to Phase 2/3; Phase 3/4 show as completed / stopped until external data exists.
2. Panel b groups by config disease labels, not by algorithmic clusters (clearer, and it stays config-driven).
3. The k-NN lift with a permutation baseline is the single headline number.
4. Brief summaries load lazily per trial, not inside `explorer.json`.
5. Filtered-out trials fade instead of disappearing.
6. Fonts are self-hosted.
7. Dark mode uses the "Dark slide" palette.
8. The lift excludes same-drug neighbours and is computed in feature space, not on the 3D coordinates (6.4).
9. One pool (finished, Early Phase 1 – Phase 2/3) for the lift, panel b and the success rate.
10. Fewer than 30 successes withholds the number; a lift within the shuffled range is reported as "no more than chance".
11. Automatic drug-name cleaning plus a ~30-drug seed alias list; fuller curation later.
12. Daily Procrustes alignment to yesterday's map, with coordinates stored on the `data` branch.
13. Withdrawn later-phase trials do not count as progress.

## 11. Left to the builder

Store migration mechanics (6.1), feature weights' starting values, UMAP hyperparameters (n_neighbors, min_dist), file layout of new modules and components, exact responsive breakpoints, how filters map into the Trials list URL, test fixture construction.
