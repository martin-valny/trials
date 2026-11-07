# Trial Radar

**What's changing in clinical trials for a therapeutic area?** Trial Radar downloads the ClinicalTrials.gov registry once a day, compares it with the previous day, and publishes a field-level change feed (status changes, slipped primary-completion dates, enrollment swings, endpoint edits) as a static site. It runs on GitHub Actions and Pages for $0.

> **Status: slice 1 of 6, plus the Explore map with drug mechanisms.** The home page is the Explore map (Figure 1); the change feed and trial pages sit beside it. Drug mechanisms are real data from ChEMBL. The pathway graph, Open Targets genetic evidence and preprints are **coming next** (see [Roadmap](#roadmap)). Default area: neuroimmunology.

Live site: <https://martin-valny.github.io/trials/> · Architecture: [docs/architecture.md](docs/architecture.md)

## The problem and who it is for

A clinical-operations or competitive-intelligence lead wants to know *what changed in competitor trials this week, and does it matter?* The registry only shows the current state of a record. It does not tell you that a primary completion date moved by four months, or that a trial changed from recruiting to terminated, overnight.

## Existing tools and the gap

| Tool | What it does | Gap this project addresses |
|---|---|---|
| Cortellis and similar commercial intelligence | Broad, curated, analyst-backed; paid | Not free or open; not reproducible |
| ClinicalTrials.gov saved-search alerts | Free, per-search email when a record changes | No field-level old→new diff, no notability, no feed across a whole area |
| Clinical Trial Risk Tool | Scores risk from protocol documents | Different problem: it does not track registry changes over time |

**What Trial Radar does not do:** it is not curated or analyst-reviewed, covers only ClinicalTrials.gov (not EU CTIS or other registries), has no history before the day it started running, and does not predict anything yet.

## The Explore map (Figure 1)

The home page draws every tracked trial as a dot on a single map, so you can see how the trials of an area group together. Dot size follows enrollment; colour can show outcome, phase, disease, drug mechanism or modality, and the same five can filter the map. Named clusters (HDBSCAN on the map) are labelled beside their dots. Select a dot for the trial's key facts, the start of its registry summary and links to its trial page and the registry record. A "Results posted" toggle keeps only trials with results on the registry. Two small panels beside the map show what the layout implies, in plain words; panel b can group success by disease, modality or mechanism.

**How the layout is made.** Position depends on content only: disease, treatment type, molecule (the cleaned name of the drug in the experimental arms), drug mechanism and study population. Outcomes are never used for position; they only colour the dots. Nearby dots are therefore trials that look alike on paper, and any grouping by outcome is something the map can be tested on rather than something built into it.

**The success proxy.** A trial is marked **"Succeeded (drug moved to a later phase)"** when its experimental-arm drug was not already in Phase 3/4 in the same disease and the same drug appears afterwards in a later-phase tracked trial **in the same disease** (sharing one of its condition labels) that started after this one and was not withdrawn. A trial listed under several diseases succeeds only in those where the drug moved on. Only finished trials that could succeed are in the pool: completed or stopped trials in Early Phase 1 up to Phase 2/3 with at least one drug in an experimental arm. Panel b's shares and its average use this pool. Limits: this is a proxy, not an efficacy result. A drug can advance for commercial reasons or fail quietly outside the tracked set, drug-name matching is approximate, trials with no experimental-arm drug cannot succeed (so they are left out of the pool), recently completed trials have had little time to move on (recent years undercount success), and month-precision start dates are compared as days.

**The neighbourhood statistic.** Within the pool, each trial that succeeded gets its 10 nearest neighbours by what they study (cosine distance over disease, treatment type, molecule and population; the mechanism block shapes the map but is left out here, since which mechanisms do well is panel b's By mechanism view), and the pipeline measures how often those neighbours also succeeded, relative to the pool's average. Neighbours that test the **same drug** are excluded, so a drug cannot cluster with itself. The same value is computed for 10,000 shuffles of the outcome labels; the p-value is the share of shuffles that reach the real value (counting the real one). The page says trials that succeeded cluster only when p < 0.025, and otherwise that they cluster no more than chance, always with the p-value; when they cluster it also gives the lift and the shuffled range. Under the sentence it says how many trials that succeeded the number rests on and, when any, how many had fewer than 10 usable neighbours. With fewer than 30 successes the number is withheld.

**Drug mechanisms.** Each experimental drug is matched by exact name (no fuzzy matching, nothing guessed) to its mechanism of action, targets and modality in [ChEMBL](https://www.ebi.ac.uk/chembl/) (ChEMBL_37, licensed [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)). The mapping is committed under [`config/mechanisms/`](config/mechanisms/README.md), keyed by drug, with a hand-written overrides file that always wins; it is made by hand with `pipeline/scripts/map_mechanisms.py`, and the daily run never calls ChEMBL. Coverage at the first mapping: every drug resolved for 838 of 1,314 drug-bearing trials (63.8%), 182 mechanism classes. Unmapped drugs stay unmapped. A trial with several mechanisms counts in each group it touches.

**Not built yet.** The pathway graph (mechanism → target → pathway) and Open Targets genetic evidence are **coming next**; nothing on the map uses them.

## How it works

Daily: fetch → relevance filter → normalize → quality gate → diff → store → explorer layout → export → deploy. Raw snapshots are kept so the whole history can be rebuilt. Details and a diagram: [docs/architecture.md](docs/architecture.md).

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
- Mechanism coverage is partial (63.8% of drug-bearing trials fully mapped); trials with unmapped drugs show as "no known mechanism".
- Slice 1 has no AI and no prediction model: every value comes straight from the registry record or the committed ChEMBL mapping. The Explore layout is a deterministic dimensionality reduction of registry fields, and its success label is the proxy described above.

## Evaluation

_Added in later slices._ Planned: a labelled evaluation set for retrieval answers with citations, and a backtest for the termination-risk model. Nothing is claimed here until it is measured.

## Roadmap

1. Core pipeline and change feed (this slice), and the Explore map.
2. Enrichment: drug→mechanism→target mapping from ChEMBL (done), then the pathway graph and Open Targets genetic evidence.
3. Fuller frontend: landscape views, target pages.
4. Preprints, retrieval Q&A with citations, evaluation set.
5. Termination-risk model (with a historical backfill).
6. Weekly human-approved briefing.

## Go-live status

The scheduled run is designed to be unattended.

- **First successful run:** 2026-11-05 (manual dispatch, run #2; run #1 failed on a blocked keepalive action and a Pages timeout, both since fixed).
- **First scheduled run:** 2026-11-06, 07:17 UTC.
- **14-day clock:** started 2026-11-05. The target is 14 consecutive daily runs without intervention; the result will be recorded here.
- The change feed is empty on day 1 by design: a change needs two daily snapshots to compare.

## Repository layout

`pipeline/` Python package, tests, scripts · `web/` Vite + React app · `config/` area, thresholds, aliases, drug mechanisms · `.github/workflows/` CI and schedules · `docs/` architecture, specs, plans.

Branch protection: importable rulesets are in [`.github/rulesets/`](.github/rulesets/README.md).

Security: see [SECURITY.md](SECURITY.md).
