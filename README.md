# Trial Radar

**What's changing in clinical trials for a therapeutic area?** Trial Radar downloads the ClinicalTrials.gov registry once a day, compares it with the previous day, and publishes a field-level change feed (status changes, slipped primary-completion dates, enrollment swings, endpoint edits) as a static site. It runs on GitHub Actions and Pages for $0.

> **Status: slice 1 of 6, plus the front door, the Explore map, the Approaches page and the stop-risk estimates (Watchlist).** The home page is a pipeline figure of MS and autoimmune-neurology drug targets (rows) by phase or disease (columns), with a company lens; each row opens a target page. Approaches (Figure 2) sorts every trial by how its treatment works, with a drug → target → pathway graph; the Explore map (Figure 1), the change feed and trial pages sit beside them. Drug mechanisms are real data from ChEMBL, pathways from Reactome. Running drug trials carry an estimated chance of stopping early (see [Stop-risk estimates](#stop-risk-estimates)). Open Targets genetic evidence and preprints are **coming next** (see [Roadmap](#roadmap)). Default area: neuroimmunology.

Live site: <https://martin-valny.github.io/trials/> · Architecture: [docs/architecture.md](docs/architecture.md)

## The problem and who it is for

A clinical-operations or competitive-intelligence lead wants to know *what changed in competitor trials this week, and does it matter?* The registry only shows the current state of a record. It does not tell you that a primary completion date moved by four months, or that a trial changed from recruiting to terminated, overnight.

## Existing tools and the gap

| Tool | What it does | Gap this project addresses |
|---|---|---|
| Cortellis and similar commercial intelligence | Broad, curated, analyst-backed; paid | Not free or open; not reproducible |
| ClinicalTrials.gov saved-search alerts | Free, per-search email when a record changes | No field-level old→new diff, no notability, no feed across a whole area |
| Clinical Trial Risk Tool | Scores risk from protocol documents | Different problem: it does not track registry changes over time |

**What Trial Radar does not do:** it is not curated or analyst-reviewed, covers only ClinicalTrials.gov (not EU CTIS or other registries), has no history before the day it started running, and its only prediction is the stop-risk estimate below: a statistical estimate that is often wrong.

## The front door: pipeline figure and target pages

Routes: `/` the pipeline figure, `/target/:slug` a target page, `/watchlist` the stop-risk watchlist, `/approaches` (and `/approaches/:approach`; the old `/mechanisms/...` redirects), `/changes`, `/trials` (also the target of every "List these {n} trials →" link, with `?nct=…&from=…`), `/trial/:nct`, `/methods`. The nav is Pipeline · Watchlist · Approaches · Changes · Trials · Methods; `/explore` (the experimental similarity map) still works but is linked only from Methods. The pipeline figure has three arrangements: By phase, By disease and By year (`view=year`).

**The pipeline figure** (`/`) answers *what is being tried against which targets, by whom, and how far has it got?* One row per target class (CD20, FcRn, BTK, S1P receptor, CD19 CAR-T and so on, 28 in all, grouped into families), one dot per trial: advanced to a later phase, still running, stopped, finished with no follow-on, or status unknown. Columns are the phases or, under **By disease**, the diseases. A headline states a finding computed from the data (on the 2026-11-06 snapshot: "185 targeted-drug trials are running…"), with key numbers, a source line that says what is and is not in the figure, a **company lens** (pick Roche and the figure shows its trials and rows), up to four computed margin notes, and a "Mostly historical" tail. "Advanced" means only that the drug has a later-phase trial on the registry (the 1b rule: credited to the drug that moved on); it does not mean the drug worked. Real numbers on that snapshot: 693 of 2,987 trials sit in a row, 369 more targeted-drug trials sit in smaller classes. Under **By disease**, a short ink line along the bottom of a cell marks a target with a drug approved for that disease by any regulator (from ChEMBL, FDA labels and a small hand file, `config/approvals/`; see Methods).

**A target page** shows one row's trials over time by drug, who is working on it (by parent company), what stopped and why (the registry's own words, grouped by reason), and the drug → gene → pathway chain with a link into the mechanism graph. Panel e, "{Row} by disease", gives each disease the furthest phase its trials reached and the drugs approved for it, with their sources. Hand-offs carry the disease filter between the figure, target pages, Approaches, the graph and the map.

Only registered ClinicalTrials.gov trials are in it: no preclinical programmes, company pipeline disclosures or EU-only trials.

**Config that decides the figure** (hand-kept, read by the daily run, never written by it):

| Path | What it does |
|---|---|
| [`config/pipeline/rows.csv`](config/pipeline/README.md) | The rows: slug, label, family and order, the ChEMBL mechanism classes and canonical drug names that put a trial in the row, the gene (for the graph hand-off), a blurb and related rows |
| `config/pipeline/unrowed.csv` | Mechanism classes that are deliberately not a row; a test requires every class with 3 or more trials since 2012 to be in a row or here |
| `config/pipeline/background.csv` | Drugs (corticosteroids, interferon-β spellings, conditioning chemotherapy) that never put a trial in a row when it has another experimental drug |
| [`config/sponsors/parents.csv`](config/sponsors/README.md) | Raw lead-sponsor string to the company a reader knows (`parent`) and its `kind`, for the company lens |
| `config/stop_reasons.csv` | Ordered `pattern,group` regexes that sort registry `why_stopped` text into reason groups (first match wins; "Other" was 3.2% of stopped trials with a reason) |
| `config/area.yaml` `figure_order` | Each condition's column order in the figure |
| `config/aliases/intervention.csv` | Also folds drug-name variants (ocr, ofatunumab and others) into one name pipeline-wide |

A bad row stops the stage with `<file>:<line>: <problem>`; the run continues without `pipeline.json` and the front page shows a calm "not available" fallback (R19). To check coverage after a rebuild, run `uv run python scripts/pipeline_report.py <site_dir>` from `pipeline/`: it prints the row table, the "Other" stop-reason share, unlisted classes and sponsors (from the run warnings), comparator cases (a trial in two rows) and the size of `pipeline.json`, and exits 1 if it is missing or over 200 KB (it is about 178 KB on the real snapshot).

## Stop-risk estimates

**What it predicts.** For each running drug or biologic trial in Phase 1 to 3, the estimated chance that it stops early after it has started (registry status TERMINATED rather than COMPLETED), with a range and the typical rate for comparable trials. It shows on target pages (panel f), trial pages, the `/watchlist` page (all scored running trials ranked by estimate, with filters by disease, company and target) and in Methods (`/methods#stop-risk`, the model card). It is a statistical estimate from public registry data, not a statement about any sponsor or trial, and it is often wrong; every surface carries that note.

**Training and test.** Trained on finished interventional drug and biologic trials of phase 1 to 3 started in 2008 or later (COMPLETED = 0, TERMINATED = 1; withdrawn, unknown and suspended trials left out), pulled 2008 to 2025 across the whole registry, not only this area: 81,655 labelled trials. The evaluation model is trained on starts up to 2015 and tested on starts 2016 to 2019 (19,782 trials, 3,392 stopped). Only facts known at the start are used: phase, design, sponsor and its earlier trials, sites and countries, outcome counts, MeSH disease categories. Enrollment is deliberately excluded (a finished trial's actual enrollment is small because it stopped), as are the stop reason, results, actual dates and the final status. The shipped model is the same recipe refit on trials started up to 2019 (later starts are biased toward early stops among the finished), and the typical rates come from the same window.

**Accuracy, honestly.** On the held-out set the boosted model reaches AUC 0.682 (Brier 0.1348) against 0.567 (0.1420) for a logistic baseline, so it ranks a stopped trial above a completed one about 68 times in 100: better than chance, far from reliable. Without site and country features it still reaches 0.676, so those do not leak the label. On trials in this area only (141 trials, 29 stopped) the AUC was 0.602, but that sample is too small to say anything, and Methods shows it as "too few to judge". Each model is isotonic-calibrated, Methods plots predicted against observed stop rates on the held-out set (the calibration figure), and the range is the spread of 20 bootstrap refits placed around the estimate. A model that can be this wrong is shown next to the typical rate, never alone.

**What is scored.** On the 2026-11-06 snapshot 237 running trials are scored and 440 are not (387 not phase 1 to 3, 22 whose primary completion is already reached, 19 with no drug or biologic, 12 with results posted). Estimates run from 1.5% to 42.8% with a median of 20.7%; 79 sit above the typical rate for their phase, 135 near it and 23 below. MeSH files Myasthenia Gravis under Paraneoplastic Syndromes, which climbs to Neoplasms; that path alone no longer counts as the Neoplasms category (2 scored trials keep it, both with a neoplasm among their conditions).

**Text experiment.** Adding the trial's text (title, primary outcomes, eligibility) as TF-IDF or PubMedBERT features lifted AUC from about 0.685 to at most 0.701, short of the +0.03 bar set beforehand, and the gain came almost entirely from the eligibility text and looks like a proxy for era and sponsor style. Not adopted; the write-up is in [docs/superpowers/research/2026-11-09-stop-risk-text-experiment.md](docs/superpowers/research/2026-11-09-stop-risk-text-experiment.md).

**The per_trial switch.** `risk.per_trial` in `config/area.yaml` (with `risk.enabled` and `risk.dir`). With `per_trial: false`, `risk.json` keeps only the per-target summaries, the Watchlist lists targets instead of trials, and trial pages show nothing; flip it if per-trial numbers should not be public. `enabled: false` skips the stage.

**Where it lives.** The model and its card are committed under [`config/risk/`](config/risk/README.md) (`model.joblib`, `card.json`, `heldout.parquet`, `sponsor_history.csv`, hand-kept `factor_labels.csv`). They are made by hand with `pipeline/scripts/train_stop_risk.py` (needs network; nothing retrains automatically), and the daily `stop_risk` stage only scores. A failure there is a run warning and the site publishes without `risk.json` (R19). Spec: [docs/superpowers/specs/2026-11-09-stop-risk-model-design.md](docs/superpowers/specs/2026-11-09-stop-risk-model-design.md).

## The Explore map (Figure 1, experimental, not in the nav)

The Trial map (`/explore`) draws every tracked trial as a dot on a single map, so you can see how the trials of an area group together. Dot size follows enrollment; colour can show outcome, phase, disease, drug mechanism, modality or approach (see the Approaches page below), and the same six can filter the map. Named clusters (HDBSCAN on the map) are labelled beside their dots. Select a dot for the trial's key facts, the start of its registry summary and links to its trial page and the registry record. A "Results posted" toggle keeps only trials with results on the registry. Two small panels beside the map show what the layout implies, in plain words; panel b can group success by disease, modality, mechanism or approach.

**How the layout is made.** Position depends on content only: disease, treatment type, molecule (the cleaned name of the drug in the experimental arms), drug mechanism and study population. Outcomes are never used for position; they only colour the dots. Nearby dots are therefore trials that look alike on paper, and any grouping by outcome is something the map can be tested on rather than something built into it.

**The success proxy.** A trial is marked **"Succeeded (drug moved to a later phase)"** when its experimental-arm drug was not already in Phase 3/4 in the same disease and the same drug appears afterwards in a later-phase tracked trial **in the same disease** (sharing one of its condition labels) that started after this one and was not withdrawn. A trial listed under several diseases succeeds only in those where the drug moved on. Only finished trials that could succeed are in the pool: completed or stopped trials in Early Phase 1 up to Phase 2/3 with at least one drug in an experimental arm. Panel b's shares and its average use this pool. Limits: this is a proxy, not an efficacy result. A drug can advance for commercial reasons or fail quietly outside the tracked set, drug-name matching is approximate, trials with no experimental-arm drug cannot succeed (so they are left out of the pool), recently completed trials have had little time to move on (recent years undercount success), and month-precision start dates are compared as days.

**The neighbourhood statistic.** Within the pool, each trial that succeeded gets its 10 nearest neighbours by what they study (cosine distance over disease, treatment type, molecule and population; the mechanism block shapes the map but is left out here, since which mechanisms do well is panel b's By mechanism view), and the pipeline measures how often those neighbours also succeeded, relative to the pool's average. Neighbours that test the **same drug** are excluded, so a drug cannot cluster with itself. The same value is computed for 10,000 shuffles of the outcome labels; the p-value is the share of shuffles that reach the real value (counting the real one). The page says trials that succeeded cluster only when p < 0.025, and otherwise that they cluster no more than chance, always with the p-value; when they cluster it also gives the lift and the shuffled range. Under the sentence it says how many trials that succeeded the number rests on and, when any, how many had fewer than 10 usable neighbours. With fewer than 30 successes the number is withheld.

**Drug mechanisms.** Each experimental drug is matched by exact name (no fuzzy matching, nothing guessed) to its mechanism of action, targets and modality in [ChEMBL](https://www.ebi.ac.uk/chembl/) (ChEMBL_37, licensed [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)). The mapping is committed under [`config/mechanisms/`](config/mechanisms/README.md), keyed by drug, with a hand-written overrides file that always wins; it is made by hand with `pipeline/scripts/map_mechanisms.py`, and the daily run never calls ChEMBL. Coverage at the last mapping (8 November 2026, after the reviewed mapping-gaps proposals were applied): every drug resolved for 1,112 of 1,314 drug-bearing trials (84.6%), up from 838 (63.8%) at the first mapping; 201 mechanism classes. Unmapped drugs stay unmapped. A trial with several mechanisms counts in each group it touches.

## The Approaches page (Figure 2)

`/approaches` (formerly `/mechanisms`) answers *which kinds of treatment are being tried, and how do they fare?* Every trial sits in one or more of seven **approaches**, sorted from its experimental arms: Targeted drugs (any drug with a molecular mechanism), Cell & transplant, Antibody & plasma, Tolerisation, Broad immunomodulators, Non-drug care, and Unclassified. Nothing is guessed: names are matched exactly against the drug mapping and a hand-written list of kinds (`config/approaches/`, each with a "proposed" rationale and a MeSH, NCIt, ChEMBL or PubMed source), and non-drug names against reviewed whole-word phrases. Anything left over stays visible under Unclassified › Not yet sorted, by trial count.

- **The rail** (panel a) lists all seven approaches with their trial counts and success share. On the 2026-11-06 snapshot (2,987 trials): Targeted drugs 1,062 (17% succeeded), Cell & transplant 72 (3%), Antibody & plasma 58 (13%), Tolerisation 15 (8%), Broad immunomodulators 52 (6%), Non-drug care 1,222 (success not defined), Unclassified 570 (2%). 55 trials sit in more than one approach.
- **Targeted drugs** opens into a graph of drugs, their gene targets and the [Reactome](https://reactome.org/) pathways those targets sit in (release 98, CC BY 4.0), with Gene Ontology (CC BY 4.0) and a short curated list where Reactome has nothing. The graph is capped at 300 nodes so it stays readable: every drug credited with a success and the drugs in 4 or more trials (66 of 515), the 137 targets they act on and 97 pathways, with 606 edges; it reaches 546 of the 974 trials whose drugs have a mapped mechanism. The cap changes only what is drawn: each target and pathway still counts the trials of every mapped drug that reaches it, drawn or not, so its success share is not pushed up by leaving out drugs that never succeeded. The canvas caption says so, and Find still finds every left-out drug, says why it is not drawn and shows its trials on the map. Hover lights a node's neighbours; a click follows the chain from drug to pathway and opens its panel. Filters light up the paths their trials take instead of hiding the rest. "Where successes converge" lists the pathways below the top level with the highest pool success share.
- **Every other approach** opens into a typeset tree (group → kind → trials), not a graph, so no connection is implied that does not exist. Each row shows its trials, an outcome strip and the success share (or "too few to tell" under 10 finished trials). A row opens its trials in a side panel, which can hand them back to the map.

**How success is counted here (1b).** A pool trial counts in the denominator of every approach and kind it touches, but it counts as a success only in the groups of the drug that moved on to a later phase. An aHSCT trial that succeeded because its cyclophosphamide progressed is a success for Targeted drugs, not for Cell & transplant. Non-drug care has no success figure, since success here means a drug moved on. The pool and the trial-level outcome are the map's, unchanged.

The graph is built by the pipeline with a seeded layout (`mechanisms.json`); pathway data is made by hand with `pipeline/scripts/map_pathways.py`, and the daily run never calls Reactome or QuickGO. The approved-drug list is hand-run too: `pipeline/scripts/fetch_approvals.py` (needs network; ChEMBL and openFDA) writes `config/approvals/approvals.csv`, and the daily run never calls either. Open Targets genetic evidence is **coming next**.

## How it works

Daily: fetch → relevance filter → normalize → quality gate → diff → store → explorer layout → pipeline figure → mechanism graph → stop risk → export → deploy. Besides the change feed, the export writes `explorer.json`, `mechanisms.json`, `pipeline.json` and `risk.json` (the front page's only data file besides `meta.json`). Raw snapshots are kept so the whole history can be rebuilt. Details and a diagram: [docs/architecture.md](docs/architecture.md).

A change is **notable** when status changes, a primary endpoint changes, enrollment moves by 20% or more, or a primary-completion/completion date slips by 90 days or more (thresholds in `config/area.yaml`).

## Run it locally

Requirements: Python 3.12 with [uv](https://docs.astral.sh/uv/), Node 22.

```bash
# pipeline (needs network access to clinicaltrials.gov)
cd pipeline
uv sync --locked
uv run trialradar check --config ../config/area.yaml
uv run trialradar run --config ../config/area.yaml \
    --data-dir ../data --raw-dir ../raw --site-dir ../web/public/data

# tests (offline; no network needed)
uv run pytest

# web app
cd ../web
npm ci
npm run dev          # http://localhost:5173, reads web/public/data
npm test             # unit tests
npm run e2e          # production build + Playwright
```

The site needs at least two daily runs before the feed shows anything. For a demo without the network, `uv run python scripts/make_web_fixtures.py` regenerates the test data in `web/tests/fixtures/data` (copy it to `web/public/data`).

`trialradar rebuild` recreates the whole store from the raw snapshots. Download them first (`gh release download snapshots-YYYY-MM --dir raw`, once per month). It builds into a temporary store and swaps it in only on success; it refuses to run with no snapshots, or when they start later than the stored history (`--force` overrides that).

## Change the therapeutic area

Edit [`config/area.yaml`](config/area.yaml): the area name, the `conditions` (label plus synonyms used for both the registry query and the relevance filter), tracked fields and thresholds. Sponsor and intervention name aliases live in `config/aliases/*.csv`. No code changes are needed; `pipeline/tests/integration/test_config_swap.py` runs a different area end to end and checks that no source file names a condition.

Because relevance is decided after download and raw snapshots keep everything, a config change can be replayed over history with `trialradar rebuild`.

## Data-use note

All data is public ClinicalTrials.gov registry data. It is **self-reported by sponsors and lags reality**: a change may be recorded days or weeks after it happened, and records can be wrong. This is not medical advice and not a substitute for reading the registry record, which every row links to.

## Limitations

- Relevance matches conditions, keywords and MeSH terms as whole phrases against configured synonyms. Titles are not used. Studies that list only a bare abbreviation (for example a two-letter acronym) as their condition are missed.
- If a trial drops out of the registry response and returns, only an "added" row is recorded; field changes during its absence are not reported.
- A partial registry response under the 25% drop threshold can still produce a burst of removed/added rows.
- Mechanism coverage is partial (84.6% of drug-bearing trials fully mapped); trials with unmapped drugs show as "no known mechanism", and their names are listed under Unclassified › Not yet sorted on the Approaches page (or, when the trial also has a mapped drug and so sits in another approach, in the last Unclassified group, "Not yet sorted, in trials of other approaches").
- The only prediction is the stop-risk estimate (AUC 0.682 on held-out trials; see above); every other value comes straight from the registry record or the committed ChEMBL mapping. The Explore layout is a deterministic dimensionality reduction of registry fields, and its success label is the proxy described above.

## Evaluation

_Added in later slices._ Planned: a labelled evaluation set for retrieval answers with citations, and the termination-risk model's held-out accuracy is reported above and on Methods (AUC 0.682); nothing else is claimed until it is measured.

## Roadmap

1. Core pipeline and change feed (this slice), and the Explore map.
2. Enrichment: drug→mechanism→target mapping from ChEMBL (done), approach bubbles and the drug → target → pathway graph (done), then Open Targets genetic evidence.
3. Fuller frontend: landscape views, target pages.
4. Preprints, retrieval Q&A with citations, evaluation set.
5. Termination-risk model (done: stop-risk estimates and the Watchlist).
6. Weekly human-approved briefing.

## Go-live status

The scheduled run is designed to be unattended.

- **First successful run:** 2026-11-05 (manual dispatch, run #2; run #1 failed on a blocked keepalive action and a Pages timeout, both since fixed).
- **First scheduled run:** 2026-11-06, 07:17 UTC.
- **14-day clock:** started 2026-11-05. The target is 14 consecutive daily runs without intervention; the result will be recorded here.
- The change feed is empty on day 1 by design: a change needs two daily snapshots to compare.

## Repository layout

`pipeline/` Python package, tests, scripts · `web/` Vite + React app · `config/` area, thresholds, aliases, drug mechanisms, approaches, pipeline rows, sponsor parents, stop reasons · `.github/workflows/` CI and schedules · `docs/` architecture, specs, plans.

Branch protection: importable rulesets are in [`.github/rulesets/`](.github/rulesets/README.md).

Security: see [SECURITY.md](SECURITY.md).
