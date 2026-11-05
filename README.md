# Trial Radar

**What's changing in clinical trials for a therapeutic area?** Trial Radar downloads the ClinicalTrials.gov registry once a day, compares it with the previous day, and publishes a field-level change feed (status changes, slipped primary-completion dates, enrollment swings, endpoint edits) as a static site. It runs on GitHub Actions and Pages for $0.

> **Status: slice 1 of 6.** The change feed and trial pages are what exists today. Linking trials to drug targets, genetic evidence and preprints is **coming next** (see [Roadmap](#roadmap)). Default area: neuroimmunology.

Live site: _to be added after go-live_ · Architecture: [docs/architecture.md](docs/architecture.md)

## The problem and who it is for

A clinical-operations or competitive-intelligence lead wants to know *what changed in competitor trials this week, and does it matter?* The registry only shows the current state of a record. It does not tell you that a primary completion date moved by four months, or that a trial changed from recruiting to terminated, overnight.

## Existing tools and the gap

| Tool | What it does | Gap this project addresses |
|---|---|---|
| Cortellis and similar commercial intelligence | Broad, curated, analyst-backed; paid | Not free or open; not reproducible |
| ClinicalTrials.gov saved-search alerts | Free, per-search email when a record changes | No field-level old→new diff, no notability, no feed across a whole area |
| Clinical Trial Risk Tool | Scores risk from protocol documents | Different problem: it does not track registry changes over time |

**What Trial Radar does not do:** it is not curated or analyst-reviewed, covers only ClinicalTrials.gov (not EU CTIS or other registries), has no history before the day it started running, and does not predict anything yet.

## How it works

Daily: fetch → relevance filter → normalize → quality gate → diff → store → export → deploy. Raw snapshots are kept so the whole history can be rebuilt. Details and a diagram: [docs/architecture.md](docs/architecture.md).

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
- Slice 1 has no AI and no model: every value comes straight from the registry record.

## Evaluation

_Added in later slices._ Planned: a labelled evaluation set for retrieval answers with citations, and a backtest for the termination-risk model. Nothing is claimed here until it is measured.

## Roadmap

1. Core pipeline and change feed (this slice).
2. Enrichment: drug→target mapping and Open Targets genetic evidence.
3. Fuller frontend: landscape views, target pages.
4. Preprints, retrieval Q&A with citations, evaluation set.
5. Termination-risk model (with a historical backfill).
6. Weekly human-approved briefing.

## Go-live status

The scheduled run is designed to be unattended. **14-day clock: not started.** Start date and result will be recorded here after the first successful `daily` run.

## Repository layout

`pipeline/` Python package, tests, scripts · `web/` Vite + React app · `config/` area, thresholds, aliases · `.github/workflows/` CI and schedules · `docs/` architecture, specs, plans.

Security: see [SECURITY.md](SECURITY.md).
