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
the same recipe refit on all labelled trials and scores live trials. A boosted model ships
only if its test AUC is at least 0.02 above the logistic baseline and its Brier score is no
worse; otherwise the baseline ships. The card records which, and why. A boosted fit without
site and country features is also reported; if removing them costs more than 0.03 AUC the
card sets `site_leak_flag` and Methods names them as a possible leak. All of these numbers
(baseline, boosted, boosted without sites, in-area) are bootstrap-ensemble metrics on the same
held-out set, and the shipping reason and leak flag quote exactly the numbers in `card.json`.

## Files

| File | Content |
| --- | --- |
| `model.joblib` | `{"version", "eval", "shipped"}` ensembles (main model plus 20 bootstrap refits) |
| `card.json` | metrics, filter, features, exclusions, versions, dates, typical stop rates |
| `heldout.parquet` | test-set features and labels only: no NCT ids, no text |
| `sponsor_history.csv` | per sponsor: earlier finished trials, how many stopped, as-of date |
| `factor_labels.csv` | hand-kept plain-words labels for the factors, `{value}` is filled in |

`sponsor_history.csv` is the one deliberate exception to "never commit real registry data":
it holds counts per sponsor name, no trial records. Live scoring reads it for the sponsor
track-record factor.

## Retrain (by hand, needs network)

```sh
cd pipeline
uv run python scripts/train_stop_risk.py --cache .cache/stop-risk --out ../config/risk --years 2008-2025
```

**Stale cache:** a cached year is reused forever. Before a retrain, delete the cache file of
the latest year (and any year still being backfilled by the registry), otherwise its trials
stay frozen at the status they had when first pulled. The first run used `--years 2008-2025`
(2026 is incomplete and unused: training and test only use finished trials).

The pull goes one start year at a time into `<cache>/<year>.jsonl.gz` and skips years already
cached, so an interrupted run resumes. `--offline` trains from the cache only. Review the
printed summary, then commit the regenerated files together. The model needs the scikit-learn
minor version recorded in the card; the loader refuses any other.
