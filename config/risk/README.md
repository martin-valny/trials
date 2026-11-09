# Stop-risk model artefacts

Every file here is read by the daily run's `stop_risk` stage. Nothing here is retrained
automatically.

## What it predicts

The estimated chance that a drug or biologic trial of phase 1-3 **stops early after it has
started** (registry status TERMINATED rather than COMPLETED). It is a statistical estimate
from public registry data, not a statement about any sponsor or trial, and it is often wrong;
the model card holds its measured accuracy.

## Training filter

Interventional studies with a phase 1, 2 or 3 (combined phases included, early phase 1 only
excluded), at least one DRUG or BIOLOGICAL intervention, start date 2008-01-01 or later, and
a final status of COMPLETED (label 0) or TERMINATED (label 1). WITHDRAWN, UNKNOWN, SUSPENDED
and all running statuses are excluded: withdrawn trials never enrolled and list few sites,
which would let site counts give the label away. No condition filter: the whole registry.

## Excluded fields, and why

Only facts known when a trial starts are used. Excluded, because they are set or changed at
the end of a trial:

- **enrollment** (any type). First on purpose: a finished trial's record carries *actual*
  enrollment, which is small exactly because the trial stopped. It is the single biggest cost
  of using registry data alone.
- `why_stopped`, results posted, actual completion dates and any duration derived from them,
  last-update date, site recruitment status, overall status.

## The two models

One recipe, two fits. The **evaluation model** is trained on trials started up to 2015-12-31
and tested on starts 2016-01-01 to 2019-12-31 (later starts are left out: their finished set
is biased toward short, early-stopped trials). Every published accuracy number comes from it,
and `tests/unit/test_risk_card.py` reloads it and recomputes them. The **shipped model** is
the same recipe refit on all labelled trials started up to 2019-12-31 (`refit_end` on the card)
and scores live trials. Later starts are left out of the refit for the same reason they are left
out of the test: among trials started since 2020, the ones already finished are mostly the ones
that stopped early (selection by outcome), so a refit on them learns "recent start means
stopped". `max_start_year` is therefore 2019, and a live trial started later is read as 2019.
Start year still shifts the estimate, but it is never shown as one of a trial's factors, because
the clamped year would not be the trial's own. The typical stop rates on the card (`typical`)
come from the same trials as the shipped refit (starts up to `refit_end`), for the same reason.

Each estimate's range is the spread of the 20 bootstrap refits placed around the shipped
estimate p: `lo = p - (median - q10)`, `hi = p + (q90 - median)` over the refits, clipped to
[0, 1]. p itself comes from the main model (the one the card's metrics measure), so it sits
inside its range rather than on an edge.

A boosted model ships only if its test AUC is at least 0.02 above the logistic baseline and its Brier score is no
worse; otherwise the baseline ships. The card records which, and why. A boosted fit without
site and country features is also reported; if removing them costs more than 0.03 AUC the
card sets `site_leak_flag` and Methods names them as a possible leak. All of these numbers
(baseline, boosted, boosted without sites, in-area) are bootstrap-ensemble metrics on the same
held-out set, and the shipping reason and leak flag quote exactly the numbers in `card.json`.

## First trained model (stop-risk-20261109)

Pulled 2008-2025 (81,655 labelled trials; train 41,564, test 19,782 with 3,392 stopped).
Test-set accuracy, bootstrap ensembles:

| Model | AUC | Brier |
| --- | --- | --- |
| Logistic baseline | 0.567 | 0.1420 |
| Boosted (shipped) | 0.683 | 0.1346 |
| Boosted without site and country features | 0.674 | 0.1355 |
| Boosted, in-area trials only (n 141, 29 stopped) | 0.556 | 0.1640 |

The boosted model won on both criteria, and `site_leak_flag` is false (removing sites costs
0.009 AUC). The in-area sample is too small to say anything about the area itself. Overall
stop rate, over the shipped refit's trials (starts up to 2019, 61,346 trials, the window the
typical rates use): 15.1% (industry 12.6%, other 18.6%); over every pulled year it would read
16.0%. Each boosted member is one booster refit with
an isotonic map learned from shuffled 5-fold out-of-fold scores (`ensemble=False`; the folds
must be shuffled because training rows are ordered by start year), and the model file
is zlib-compressed, to keep it near 7 MB.

## Files

| File | Content |
| --- | --- |
| `model.joblib` | `{"version", "eval", "shipped"}` ensembles (main model plus 20 bootstrap refits each) |
| `card.json` | metrics, filter, features, exclusions, versions, dates, typical stop rates |
| `heldout.parquet` | test-set features and labels only: no NCT ids, no text |
| `sponsor_history.csv` | per sponsor: earlier finished trials, how many stopped, as-of date |
| `factor_labels.csv` | hand-kept plain-words labels for the factors (format below) |

`factor_labels.csv` has the columns `feature,kind,yes,no,text`. The words always describe the
trial's own value; the sign of the feature's contribution only decides "raises" or "lowers", so
a label can never contradict the value (no "Few sites (112)").

| kind | used for | text shown |
| --- | --- | --- |
| `count` | counts and levels | `text` with `{value}` filled in, e.g. "Sites planned: 112" (no many/few adjectives) |
| `binary` | yes/no features | `yes` when the value is 1, `no` when it is 0 |
| `phase` | `phase_1..3` | `text` with the trial's own phases, e.g. "Phase 3 trial" (never "Not a phase 2 trial") |
| `category` | `cat_*` condition categories | `yes` when present; an absent category is never a factor |
| `sponsor` | the three sponsor features | fixed copy built in code: "Sponsor's earlier trials: k of n stopped early (registry)" |

A missing value is never described, and a label already given for a trial is not repeated. The
category labels read "Registry files it under: ...", because they follow the registry's MeSH
filing rather than the disease as a clinician would name it: MeSH files Myasthenia Gravis under
Paraneoplastic Syndromes, so every myasthenia gravis trial carries the Neoplasms category.

`sponsor_history.csv` is the one deliberate exception to "never commit real registry data":
it holds counts per sponsor name, no trial records. Live scoring reads it for the sponsor
track-record factor. Unlike the shipped refit it is not cut at 2019: it counts all of a
sponsor's trials that had finished by the training date, because a sponsor's finished record
is genuinely known at scoring time. (During training each trial sees only the sponsor's trials
that finished before it started.) This is a known train/serve difference, kept on purpose: for a
running trial the count is as of today, so it can include trials that finished after this one
started, which a training row would not have seen. Methods says so in its sponsor history
sentence.

## Retrain (by hand, needs network)

```sh
cd pipeline
caffeinate -dims uv run python scripts/train_stop_risk.py --cache .cache/stop-risk --out ../config/risk --years 2008-2025
```

**Stale cache:** a cached year is reused forever. Before a retrain, delete the cache file of
the latest year (and any year still being backfilled by the registry), otherwise its trials
stay frozen at the status they had when first pulled. The first run used `--years 2008-2025`
(2026 is incomplete and unused: training and test only use finished trials).

The pull goes one start year at a time into `<cache>/<year>.jsonl.gz` and skips years already
cached, so an interrupted run resumes. `--offline` trains from the cache only. Review the
printed summary, then commit the regenerated files together. The model needs the scikit-learn
minor version recorded in the card; the loader refuses any other.
