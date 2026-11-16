# Trial age as a stop-risk factor

Date: 2026-11-16. Model: shipped v2 (`config/risk/model.joblib`). Data: `config/risk/heldout.parquet`, the
12,154 test trials running in December 2021 and followed to January 2026. Script: `2026-11-16-trial-age-factor.py` beside this note (run from `pipeline/`;
loads the artefacts with `trialradar.risk.artefacts.load`, SHAP contributions via `trialradar.risk.explain.contributions`).
No code changed; this note is for Martin's decision.

## Why look

On the live Stop risk page, the highest estimates (around 76%) go to trials that started 2 to 8 months ago, and
"Started N months ago ↑ raises" is a top factor on most of them. A domain reader sees "it just started, so it will
probably stop" as backwards.

## What the data shows

**1. In the test set, younger trials did stop more often, and the model matches that.**

| Age in Dec 2021 | Trials | Stopped early | Mean estimate | Mean age contribution (log-odds) |
|---|---|---|---|---|
| under 6 months | 2,294 | 27.1% | 27.2% | +0.48 |
| 6–12 months | 1,832 | 24.6% | 24.5% | +0.31 |
| 12–24 months | 2,573 | 25.5% | 25.6% | +0.12 |
| 24–36 months | 1,826 | 23.1% | 24.5% | −0.10 |
| 36–60 months | 2,204 | 22.4% | 21.6% | −0.33 |
| 60 months and over | 1,425 | 16.1% | 16.1% | −0.66 |

**2. Age's share of each explanation is larger than its effect on the observed rate, and points the wrong way in Phase 1.**
Across all phases the age contributions span 1.14 log-odds (+0.48 to −0.66), while the observed rates span about 0.66.

| Phase | under 6 m | 6–12 m | 12–24 m | 24–36 m | 36–60 m | 60 m+ |
|---|---|---|---|---|---|---|
| Phase 1: stopped | 18.6% (751) | 18.0% (522) | 23.9% (645) | 23.5% (429) | 24.5% (478) | 18.1% (299) |
| Phase 1: age contribution | +0.44 | +0.29 | +0.13 | −0.10 | −0.34 | −0.70 |
| Phase 2: stopped | 34.3% (1,064) | 31.1% (810) | 27.8% (1,269) | 25.5% (932) | 23.8% (1,191) | 15.4% (805) |
| Phase 3: stopped | 24.4% (479) | 20.8% (500) | 22.6% (659) | 17.8% (465) | 17.6% (535) | 16.2% (321) |

In Phase 1, the youngest trials stopped *less* often (18.6% under 6 months against 24.5% at 36–60 months), yet the age
contribution is still +0.44. Age is standing in for something else, probably planned duration and the way the
outcomes are selected (point 3). So "Started 2 months ago ↑ raises" is not a fair plain-language reason.

**3. The young trials at the top come from a biased sample.** Every test trial had a clear outcome by January 2026.
Trials that were young in December 2021 *and* planned to run a long time were much more likely to make it into that set
if they ended early, and an early end is mostly a termination. (A trial planned for 36–48 months that started in
early 2021 could still finish on schedule by January 2026, so this is a tilt, not a rule.) The 7,106 trials still running were left out.

| Young (under 12 months) trials, by planned duration | Trials | Stopped early | Mean estimate |
|---|---|---|---|
| under 24 months | 3,080 | 19.4% | 18.4% |
| 24–36 months | 662 | 40.0% | 43.2% |
| 36–48 months | 260 | 54.6% | 55.6% |
| 48 months and over | 124 | 54.8% | 59.3% |

Trials that were already old (36 months or more) show nothing like this:

| Old (36 months or more) trials, by planned duration | Trials | Stopped early | Mean estimate |
|---|---|---|---|
| under 24 months | 25 | 8.0% | 14.2% |
| 24–36 months | 151 | 19.9% | 19.1% |
| 36–48 months | 697 | 22.4% | 21.0% |
| 48 months and over | 2,756 | 19.4% | 19.1% |
 Training has the same structure
(it learns from trials that had ended; Methods already notes that young endings over-represent stops). The model is
well calibrated *on that sample*, but for a trial that is young and long-planned today, the sample over-states the chance.
These are exactly the trials at the top of the live page: in the test set's top 5% of estimates, 79% have age among
their three main factors, and their median age is 8 months against 20 overall.

## Conclusion

The pattern is partly real (early terminations for slow enrolment happen), and, by inference from point 3 rather than
shown directly, largely an artefact of how outcomes are selected. It is strongest for exactly the trials the page ranks highest. The calibration figures in Methods do not show
it, because they are measured on the same selected sample.

## Options

1. **Fix the target (recommended, v3 model work).** Predict "stopped early within N years" from a snapshot,
   counting still-running trials as not stopped (a fixed horizon), or use a survival model with censoring. Then young,
   long trials are scored against everything that happened to their peers, not only the ones that ended.
2. **Now, before (1): say so on the page.** For trials under 12 months old with a planned run over 36 months, mark
   the estimate "early in its run: likely over-stated" and leave them out of the default ranking's top, or sort them
   below a divider. Small change, honest, keeps the numbers.
3. **Now, at minimum: stop giving age as a reason.** Add `age_months` (and possibly `planned_duration_months`) to
   `HIDDEN_FEATURES` in `pipeline/src/trialradar/risk/explain.py`, as already done for `start_year`. This removes the
   odd reason but leaves the inflated numbers, so on its own it would hide the problem rather than fix it.

My recommendation is 2 now and 1 as the next model task. Option 3 is acceptable only together with 2.
