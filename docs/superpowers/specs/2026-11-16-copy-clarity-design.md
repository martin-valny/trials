# Copy clarity pass: design

Date: 2026-11-16. Source: the critical copy review of the live site, same day (session transcript).

## Intent

The site's sentences are careful, but the site as a whole is hard to read: one idea goes by three or four names,
a few labels read as bugs, internal jargon leaks onto the page, and the front door lists views without saying
what any of them is for. The reader is a pharma/biotech R&D researcher or manager from a hiring panel who has
about a minute. Every word they see should mean one thing and be true.

## Goals

1. One name per idea, used everywhere (vocabulary table below), enforced by the existing `tests/plainWords.test.tsx` guard.
2. No label that reads as wrong: superlatives only when true, units on every bare number, footnote arithmetic that adds up.
3. No internal jargon on the page (list below).
4. The front door says, per view, what question it answers.
5. Nav names say what is behind them.

## Non-goals

- No layout or visual redesign beyond what a changed label needs (the front-door tiles gain one line of text).
- No change to the stop-risk model, the diligence agent's output or any pipeline data file.
- The internal type names (`Outcome = "succeeded"`, `ViewKey "watchlist"`, file and directory names) stay; only what a reader sees changes.

## Anti-goals

- Never call a drug that advanced "successful", or a stop-risk estimate a failure prediction.
- Never break an old link: `/watchlist` keeps working.

## Vocabulary (the rules)

| Idea | Use | Never on the page |
|---|---|---|
| The stop-risk view / estimate | **Stop risk** (nav, panel, contents strip); "chance of stopping early" in sentences | Watchlist, Stop chance |
| Drug went on to a later-phase trial | **advanced** (to a later phase) | moved on, succeeded, success, success share |
| Share of finished trials whose drug advanced | **advance rate** | success share |
| Completed trial whose drug did not advance | **Finished, not advanced** | Finished, no follow-on; finished without a known result |
| Finished trials in the advance-rate denominator | **measured** finished trials | that count, pool trials, could succeed |
| The disease area | `meta.area_label` ("MS and autoimmune neurology") | neuroimmunology (the config `name`) |
| Data date | the registry date the header badge shows (`meta.data_timestamp`) | a second, different date |
| Registry-edit feed | **Registry changes** | Changes (bare) |
| Treatment-type view | **Treatments** (nav, front door); page heading keeps "Approaches" in its sentence | — |
| Target-page mechanism panel | **Mechanism** | How it works (reserved for method explanations) |
| Diligence read | favours / mixed on / argues against **further development** | investment (except in the "not investment advice" disclaimer) |

## Specific fixes

- Pipeline margin notes: a superlative note ("Most crowded", "Most advanced", "Most stopped", "Newest wave", "Spreading")
  goes only to the row that truly tops that measure; if that row already carries a note, the rule shows nothing.
- Pipeline row stat: "53 of 123 running" and "5 companies running".
- Approaches footnote: count trials, not names: "571 trials not yet categorised (437 with a drug name not yet sorted, 134 diagnostic or not a treatment)".
- Stop-risk note rewritten (exact copy in the plan); it states accuracy in plain words ("about 7 times in 10").
- Graph key: "Pathway (Reactome)", "Pathway (Gene Ontology)", "Pathway (hand-curated)".
- Approval source: "hand-curated", not "hand".
- Changes: a slip of 365 days or more reads in years with one decimal ("slipped 3.3 years").
- Map hint: "drag to rotate".
- Drop the "Figure 1 |" / "Figure 2 |" prefixes from page titles (the sentence stays).
- Front-door tiles each carry a one-line question (exact copy in the plan).
- Investigation only, no shipped change: why "Started N months ago" is a top factor that raises the estimate on the highest-ranked trials.

## Approaches considered

1. **Copy pass in place, guarded by the plain-words test (chosen).** Edit strings where they live; extend the existing
   banned-words test so old names cannot come back. Small diffs, matches how the site already enforces wording.
2. Central copy dictionary (`lib/copy.ts`) all components import. Cleaner in theory, but touches every component for
   no reader-visible gain, and the site has no i18n need. Rejected (YAGNI).
3. Rename internals too (types, routes, directories). Bigger diff, risk to data-file contracts with the pipeline.
   Rejected; only the `/stop-risk` route is added, with `/watchlist` redirecting.

## Calls made without Martin (veto in plan review)

- "Stop risk" over "At-risk trials" or "Risk ranking": matches the Methods section name and the target panel.
- "Treatments" for the Approaches nav item (reverses the earlier "Approaches stays" rule in `plainWords.test.tsx`).
- "Finished, not advanced" over "Finished, no follow-on".
- Dropping the "Figure N |" prefixes.
- The map stays out of the nav (earlier decision kept).
