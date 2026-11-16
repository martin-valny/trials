# Stop-risk model artefacts

Every file here is read by the daily run's `stop_risk` stage. Nothing here is retrained
automatically. The current model is **v2** (`stop-risk-v2-20261116`), trained on point-in-time
registry records on 16 November 2026; it replaces v1 after passing the shipping gates below.

## What it predicts

The estimated chance that a drug or biologic trial of phase 1-3 **stops early after it has
started** (registry status TERMINATED rather than COMPLETED). It is a statistical estimate
from public registry data, not a statement about any sponsor or trial, and it is often wrong;
the model card holds its measured accuracy.

## Data

ClinicalTrials.gov, read through **AACT** (the Clinical Trials Transformation Initiative's
database of the whole registry), from its monthly archives:

- **Quarterly panel**: the archive nearest the first of March, June, September and December
  from 2018-12 to 2025-12, plus 2026-01 (the outcome snapshot), 30 snapshots in all
  (`filter.snapshots` on the card). Nine tables each: studies, interventions, facilities,
  design groups, design outcomes, conditions, MeSH condition terms, sponsors, designs. They are
  folded into a compact Parquet panel in a git-ignored cache; raw AACT data is never committed.
- **Monthly studies extracts** (2018-12 to 2026-01; 2021-07, 2021-08 and 2022-08 are missing),
  used only by the edit-history research comparison.

Each snapshot goes through an adapter into the same tables the daily run builds from the
ClinicalTrials.gov API, so training and live scoring share one feature code path.

**Scope, at each snapshot:** interventional; phase 1, 1/2, 2, 2/3 or 3 (early phase 1 alone
excluded); at least one DRUG or BIOLOGICAL intervention; a running status (not yet recruiting,
recruiting, enrolling by invitation, active not recruiting); and not finished in all but
status (results posted, or active not recruiting with an actual primary completion date
already passed), exactly as the daily run leaves such trials unscored. No start-date floor and
no condition filter.

**Label:** final status in the 2026-01 snapshot, COMPLETED → 0, TERMINATED → 1. WITHDRAWN,
SUSPENDED, UNKNOWN, still running and records missing from 2026-01 have no label.

## Split

- **Cutoff C = the 2021-12-01 snapshot.**
- **Training:** trials that had ended (completed or terminated) by C, one row per quarterly
  snapshot up to C while the trial was in scope, each row weighted 1/k so every trial counts
  once: 11,651 trials, 55,953 rows. Left out and counted: 108 with no final label, and 169
  whose final label differs from their status at C (that would carry a change made after C).
- **Test:** every trial in scope at C, one row each, features as the record stood at C, label
  from 2026-01: 12,154 trials, 2,874 of them stopped. Excluded and counted: still running
  7,106; unknown 5,153; withdrawn 725; suspended 155; missing from 2026-01 161.
- No trial is in both (training trials had ended by C, test trials were running at C).
- **Shipped model:** the same recipe refit on all trials ended by 2026-01 with their snapshot
  rows (32,532 trials, 274,310 rows). Every published accuracy number is the recipe's accuracy
  at C; the refit itself has no held-out test.

## Models compared, and the shipping gates

All are measured on the same held-out test rows, each from its ensemble's main fit:

- **v2 baseline:** logistic regression on phase, sponsor class and trial age.
- **v2:** `HistGradientBoostingClassifier` on the v2 features (card `features`), isotonic
  calibration from shuffled 5-fold out-of-fold scores grouped by trial, 20 bootstrap refits
  (whole trials resampled) for the ranges.
- **v1 recipe (the like-for-like "before"):** v1's features and code, trained on the same
  training trials from each one's last record at or before C, one row per trial, same labels and
  seed, scored on the test trials' C records (start year clamped to the training maximum, 2021).
  Boosted or baseline is chosen by v1's own rule.
- **Published v1:** the model that was live until v2, scored on the test trials it never saw
  (started 2020-01-01 or later), from their C records.

The rules:

1. Within v2, boosted ships over the baseline only if its AUC is at least 0.02 higher and its
   Brier score no worse.
2. **Gate 1:** the chosen v2 model beats the v1 recipe on the full test set by at least 0.02
   AUC with a Brier score no worse.
3. **Gate 2:** on the published v1's own subset, the chosen v2 model beats the published v1 by
   at least 0.02 AUC with a Brier score no worse.
4. **Parity** (below): no shippable feature mismatches on more than 1% of trials.

The within-v2 rule, Gate 1 and parity were fixed in the design spec (§7.3) before any test
number was read. Gate 2 was added on 2026-11-16, after the first run's results had been read
(including the published v1's 0.688 on its subset), and fixed before v2 was scored on that subset
(spec amendment of 2026-11-16). It can only make shipping harder.

v2 passed all four.

## Results (card `comparison` and `metrics`)

| Model | Test set | AUC | Brier |
| --- | --- | --- | --- |
| v1 recipe, baseline | full (12,154; 2,874 stopped) | 0.545 | 0.1819 |
| v1 recipe, boosted (chosen by v1's rule) | full | 0.643 | 0.1757 |
| v2 baseline | full | 0.550 | 0.1831 |
| **v2 boosted (shipped)** | full | **0.693** | **0.1682** |
| v2 boosted without site and country features | full | 0.693 | 0.1692 |
| v2 boosted + edit history (research, not shipped) | full | 0.697 | 0.1672 |
| Published v1 | started 2020 or later (6,524; 1,685 stopped) | 0.688 | 0.1785 |
| v2 boosted | same subset | 0.716 | 0.1755 |
| v1 recipe, in-area | in-area (97; 29 stopped) | 0.557 | 0.2166 |
| v2 boosted, in-area | in-area | 0.650 | 0.1997 |

The published v1's own card reported 0.682; that number came from finished trials' final
records, which can carry end-of-trial edits, on a different test set (trials started 2016–2019). The in-area sample (neuroimmunology, matched on
conditions and direct MeSH terms; AACT keeps no keywords, so keyword-only matches the live filter
would make are missed) is too small to say anything about the area itself. Removing site and
country features costs no AUC (0.693 either way) and 0.001 Brier (0.1692 vs 0.1682), so
`site_leak_flag` is false. The card also holds calibration
curves for every model, a calibration curve by trial-age band, and the training set's age and
start-year mix.

**Typical stop rates** (shown beside every estimate) come from the shipped refit's trials, each
counted once: 19.7% overall (industry 19.0%, other 20.7%), by phase and sponsor class in
`typical`. v1's rates (15.1% overall, from trials started up to 2019) are kept in
`filter.typical_v1`. The two are not the same population: v2's counts every trial that ended
between 2018-12 and 2026-01 while in scope.

## Leakage, and what the training data cannot see

- **Point-in-time features.** Every feature is computed from the record as it stood at the
  snapshot date (training) or the run date (live): planned or current enrollment and its type,
  running status, trial age, planned duration, months past the primary completion date, months
  since the last registry update, plus v1's design, site, sponsor and condition features. The
  end-of-trial leak that forced v1 to drop enrollment is gone.
- **Excluded:** `why_stopped`, results posted (a trial with results is out of scope), actual
  completion dates and durations, site recruitment status, start year (trial age replaces it,
  which removes v1's 2019 clamp), and edit history (research only).
- **Condition categories** for every snapshot come from the 2026-01 snapshot's MeSH tree,
  because the older archives hold only direct MeSH terms, without ancestors. A category can
  therefore reflect a condition edit made after a snapshot. Both v2 and the v1 recipe use the
  same categories, so the comparison is unaffected; live scoring uses the current tree, which
  matches.
- **Known training bias toward quick endings.** Trials that had ended by C and were observed
  from 2018-12 over-represent short trials, and young trials that ended by C are mostly early
  stops. It enters through age, planned duration and months past completion. It is not
  patched, because every patch either uses information a trainer at C lacks or discards most
  long trials. The test set is unaffected (all trials running at C), so any harm shows in the
  test numbers of v2 and the v1 recipe alike, which train on the same trials. The shipped refit,
  over a longer window, should have less of it; this is not measured.
- **Model choice on the test set.** Boosted or baseline is chosen on the same test set that
  reports accuracy, for v2 and for the v1 recipe alike, as v1 did. Both chose boosted by a wide
  margin (v2 0.693 vs 0.550; v1 recipe 0.643 vs 0.545), so the choice does not change the
  comparison.
- **Sponsor counts, as-of differences.** In training, a row at snapshot S counts the lead
  sponsor's trials in S's own table that were COMPLETED or TERMINATED with an end date before S
  (fewer than 5 counts as unknown). Live scoring reads `sponsor_history.csv`, the same rule as
  of 2026-01-01, whatever the run date, so a live count is fixed at the training data's end
  rather than counted as of the day the trial is scored. This train/serve difference is
  deliberate and is exempt from the parity test; Methods says so.

## Edit history (research, not shipped)

From the monthly extracts, over the 12 months before each snapshot: primary-completion-date
slips and total months slipped, planned-enrollment cuts of at least 20%, and status
regressions (running → not yet recruiting). Adding them to v2 gives AUC 0.697 and Brier 0.1672
against 0.693 and 0.1682 without. They are not shipped because the daily run sees only the
current record and ClinicalTrials.gov's API has no history endpoint. Caveats: a change from an
estimated to an actual primary completion date counts as a slip when the date moves; and the
earliest training rows (2018-12 onwards) have little or no prior history, so the gain is
likely understated.

## Train/serve parity

`check_risk_parity.py` took trials in scope in the 2026-01 snapshot in a seeded random order
(seed 0, 25,990 candidates), fetched their live records (1,600), kept those whose last update
date was unchanged since the snapshot (640), dropped the ones the daily run would no longer
score live (140: ClinicalTrials.gov flips lapsed records to UNKNOWN without a new update date),
and compared 500 trials feature by feature, AACT against the live API through the daily run's
code, with the same as-of date. Every shippable feature mismatched on at most 0.2% of trials
(`n_collaborators` 0.2%, all others 0%); the exempt sponsor features 1.2-1.6%. Per-feature
shares are in `comparison.parity`, counts in `filter.parity_meta`.

## Files

| File | Content |
| --- | --- |
| `model.joblib` | `{"version", "eval", "shipped"}` ensembles (main model plus 20 bootstrap refits each), lzma-compressed (about 12 MB) |
| `card.json` | metrics, comparison, filter, features, exclusions, data source, versions, dates, typical stop rates |
| `heldout.parquet` | test-set features, label and an in-area flag only: no NCT ids, no text |
| `sponsor_history.csv` | per sponsor: earlier finished trials, how many stopped, as-of date (2026-01-01) |
| `factor_labels.csv` | hand-kept plain-words labels for the factors (format below) |

`tests/unit/test_risk_card.py` reloads the committed model and held-out table and recomputes
the shipped model's and the in-area metrics. The other comparison rows (baselines, v1 recipe,
published v1, no sites, edit history) are recorded at training time only: those fits are not
saved. The model needs the scikit-learn minor version recorded in the card; the loader refuses
any other.

Each estimate's range is the spread of the 20 bootstrap refits placed around the shipped
estimate p: `lo = p - (median - q10)`, `hi = p + (q90 - median)` over the refits, clipped to
[0, 1].

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
| `enrollment` | `log_enrollment` (v2) | round(exp(value) - 1): `yes` ("Planned enrollment: 120") when the trial's `enrollment_anticipated` is 1, else `text` ("Enrollment: 120"); never shown at 0 |
| `months` | v2 month counts | `text` with whole months (half up), "1 month" or "N months", e.g. "Started 27 months ago"; never shown when it rounds to 0 or below |
| `months_ago` | `months_since_update` (v2) | as `months`, but under one month shows `no` ("Last registry update: less than a month ago") |

v2's `status_*` flags and `enrollment_anticipated` use `category`: shown only when they hold
(an `enrollment_anticipated` of 0 also covers a missing enrollment type, so "actual" is never
claimed). Month and status wording stays neutral (no "delayed", "stale" or "overdue"); age reads
"Started N months ago", true for every status (a not-yet-recruiting trial is not "running").
"Enrollment is a planned figure" is dropped when the same trial already shows "Planned
enrollment: N".

A missing value is never described, and a label already given for a trial is not repeated. The
category labels read "Registry files it under: ...", because they follow the registry's MeSH
filing rather than the disease as a clinician would name it. One filing is corrected: MeSH files
Myasthenia Gravis (and anti-NMDA receptor encephalitis) under Paraneoplastic Syndromes, whose
ancestors climb to Neoplasms through Nervous System Neoplasms. "Neoplasms" reached only through
that chain is not counted (`risk/fields.py`); a trial keeps it when a condition or an ancestor
outside the chain is itself a neoplasm (thymoma, a lymphoma, a brain tumour).

A record that lists no sites yet (often a trial not yet recruiting) has unknown site counts:
`n_sites`, `n_countries` and `multi_region` are missing (NaN), not zero, in training and live
scoring alike. Listed sites without a country count as zero countries.

`sponsor_history.csv` and `heldout.parquet` are the deliberate exceptions to "never commit
registry data": per-sponsor counts and a numeric table without ids, no trial records.

## Retrain (by hand)

From `pipeline/`. The panel build needs network and an AACT account (credentials are read at
runtime from a file passed with `--credentials`; never commit or print them). The trainer runs
offline from the panel.

```sh
# 1. Panel: resumable per archive; writes .cache/aact/panel/, deletes raw extracts.
#    --monthly-src points at the monthly studies extracts.
uv run python scripts/build_aact_panel.py --cache .cache/aact --credentials <file> --monthly-src <dir>

# 2. Parity (network: ClinicalTrials.gov API only); writes parity.json and parity.meta.json.
uv run python scripts/check_risk_parity.py --panel .cache/aact/panel --sample 500 --out <dir>/parity.json

# 3. Train, compare and apply the gates; writes every artefact to --out.
uv run python scripts/train_stop_risk_v2.py --panel .cache/aact/panel --out <dir> \
    --v1-dir tests/fixtures/risk_v1 --parity <dir>/parity.json
```

`--v1-dir` names the model the second gate compares against. Its default, `config/risk`, now
holds v2, so a retrain must pass it explicitly: `tests/fixtures/risk_v1` (the published v1,
frozen there when v2 replaced it) to reproduce this comparison, or a copy of the then-current
card's directory to compare a new model with the one that is live. A changed cutoff or outcome
snapshot means re-freezing the gates in the design spec before reading any test number.

Review the printed summary. If the card's `comparison.v2_ships` is true, copy the five files
into `config/risk/` and commit them together. If it is false, v1 (or the current model) stays
live: commit only the card, as `config/risk/v2/card.json`, for the Methods comparison (the
loader refuses a card that did not pass the gates). An unshipped card's numbers are not
recomputed in CI, because its model and held-out table are not committed.

### v1, in short

v1 (`stop-risk-20261109`, `scripts/train_stop_risk.py`) learned from finished trials' final
records pulled from the ClinicalTrials.gov API (starts 2008-2025), with enrollment excluded and
a 2019 start-year clamp; its card reported a held-out AUC of 0.682 and Brier 0.1348. Its
artefacts are frozen in `pipeline/tests/fixtures/risk_v1/`.

## Terms of use (checked 2026-11-15; design spec §10)

- **AACT** (<https://aact.ctti-clinicaltrials.org/>): no terms, licence or citation page found;
  the sign-up form shows no terms. Footer: "© 2026 Clinical Trials Transformation Initiative ·
  A project of CTTI. Data derived from ClinicalTrials.gov."
- **CTTI citation policy** (<https://ctti-clinicaltrials.org/?p=7671>): acknowledge the
  "Clinical Trials Transformation Initiative" as the source and link to it.
- **ClinicalTrials.gov terms**
  (<https://clinicaltrials.gov/about-site/terms-conditions>, last updated 2023-01-31). Data are
  available to all at no charge. In any publication or distribution of the data you should:
  attribute the source as ClinicalTrials.gov; keep the data current; clearly display the date
  the data were processed by ClinicalTrials.gov; state any modifications made, with a complete
  description. You shall not assert proprietary rights or represent it as other than a U.S.
  Government database; no use of extracted email addresses for marketing. Some data may carry
  third-party copyright. The terms apply while any of the data is retained.

**How this repository meets them:**

- **Attribution:** the card (`data_source`), this README and the site's Methods page credit
  ClinicalTrials.gov, and AACT and the Clinical Trials Transformation Initiative (README and
  Methods with links).
- **Dates:** the snapshot range (2018-12-01 to 2026-01-01), the processing date (2026-01-01,
  the date of the AACT snapshot the outcomes come from) and the training date are on the card and on Methods.
- **Modifications:** the committed artefacts (a model, a numeric held-out table without ids,
  per-sponsor counts) are derived data; this README and Methods describe in full how each was
  made.
- **Current:** the live site is rebuilt from the registry by the daily run. The committed model,
  held-out table and sponsor counts are fixed at the 2026-01-01 snapshot and dated as such.
- **No email addresses** are read or used. Raw AACT data is never committed or redistributed.
- **No proprietary claim:** registry data remains ClinicalTrials.gov's; no rights are claimed in it
  or in the artefacts derived from it here.
