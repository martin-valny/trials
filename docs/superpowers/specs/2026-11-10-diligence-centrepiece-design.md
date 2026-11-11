# Diligence as a centrepiece — design

Date: 2026-11-10. Status: draft for Martin's approval.
Builds on: the diligence agent (spec `2026-11-09-diligence-agent-design.md`, plan Tasks 1–10 built) and the design
revision (spec `2026-11-10-design-revision-design.md`, built on the same branch).

## 1. Intent

The diligence agent is meant to be a main part of Trial Radar, and the part closest to the role the site is a
showcase for (AI prototyping). Today it is buried: panel g at the bottom of a target page, one line in the target
header, and a small line on the front door. A visitor who does not scroll a target page to the end never learns it
exists. Martin's words: "you have no idea it exists up until you scroll all the way down on one subpage".

Goal: a first-time visitor meets the agent on the front door, can reach it from the nav, and finds it first on every
target page.

## 2. Goals, non-goals, anti-goals

Goals
- Three entry points: a front-door band, a Diligence page in the nav, and diligence as the first panel (a) on target pages.
- Ships with diligence Task 11: the new surfaces appear only once recorded runs or a backend exist (section 4).

Non-goals
- No change to the agent, the checker, costs, caps or the backend API.
- No change to the Watchlist or the stop-risk model (Martin: leave it as is for now).
- No new kind of memo view; the memo renders as it does in today's panel.

Anti-goals (a failure even if it works)
- A prominent control that leads nowhere: a run button without a backend, an example link that 404s, a "coming soon".
- Diligence pushing the real data out of the first view: the pipeline figure stays the front door's main figure.
- Starting a paid run from a link or a page load. A run starts only from a click on the Run button on a target page.
- Showing the synthetic test recording (`web/tests/fixtures/diligence/cd20__MS.json`) as if it were real.

## 3. Constraints

- Static site, $0 running cost; the backend is optional and set at build time (`VITE_DILIGENCE_URL`). The daily deploy
  takes it from the repository variable `DILIGENCE_URL` (`.github/workflows/daily.yml`); with no variable set, the
  public site is in the offline state.
- Recorded runs ship as `web/public/diligence/{target}__{disease}.json`, and the evaluation report as
  `web/public/diligence/eval-report.json`, both written by `agent/scripts/record_eval.py` in Task 11. Today the folder is
  empty.
- Labels and wording rules from the diligence spec hold everywhere: "AI-written", "AI judgement from public data, not
  investment advice", a withheld judgement shown as withheld.
- One design (Figure Plate, DESIGN.md), the six-step type scale, 12px floor, 375px phones, light and dark.
- Never port 4173; never call AWS; never push.

## 4. Release gate: what decides which layout shows

Three states, decided at run time from what the build ships:

| State | How it is known | What the site shows |
|---|---|---|
| Nothing yet (today) | no `diligence/index.json`, no backend URL | exactly today's site: panel g at the bottom, header strip, no band, no nav item |
| Recorded only | `diligence/index.json` loads with ≥1 run; no backend URL | band, nav item, page and panel a; links open recorded memos; no Run button anywhere |
| Live | backend URL set at build time | as above, plus Run on target pages and any target in the picker |

Martin's decision: after Task 11 the public site runs in the **recorded-only** state (the `DILIGENCE_URL` variable
stays unset at first). Recorded-only carries the main design, test and screenshot effort; the live state is built and
unit-tested so that setting the variable later needs no new work, and its any-target picker gets a basic type-to-filter
list rather than a phone-polished design.

`index.json` is new (section 6). Its presence is the switch: no feature flag. Before Task 11 nothing visible changes,
so this can be merged at any time.

## 5. Approaches considered

1. Build all three entry points now, released with Task 11 by the gate above (chosen by Martin).
2. Build and release now with "coming soon" controls: visible sooner, but the panel sees a main feature that does not work.
3. A single entry point (front-door band only, or nav page only): cheaper, but the target page would still hide it at panel g.

## 6. The design

### 6.1 Recorded-runs index (new data file)

`web/public/diligence/index.json`: one entry per recorded run, with target id, target label, disease code, disease
label, stance (or withheld), confidence, claims supported n of m (the existing `claimCounts` rule), sentences
removed, recorded date, cost in dollars.

(Claude's call.) The index is built from the memo files actually present in `web/public/diligence/` (every
`{target}__{disease}.json`), by a small offline step in `agent/` that needs no AWS and no paid rerun. Both
`record_eval.py` (after any run, including `--only`) and `eval_report.py` call it, so the index can never drift from
the memo files or shrink to one entry. The memo-publishing rule in `record_pair` stays as it is; a failed report gate
keeps only `eval-report.json` off the site, and the page then simply shows no quality numbers. The site never derives
this list from file names.

(Ruling during build.) The built index carries pairs only, `{"runs": [{"target", "disease"}]}`; the site derives
stance, confidence, claim counts, removed sentences and the recorded date from each pair's memo, and shows only
pairs whose target (and disease, unless `all`) is still in `pipeline.json`.

### 6.2 Front door band

A band between the page head and the pipeline figure, replacing today's example line:

```
 AI diligence   An agent drafts a cited memo on a target, then a checker removes
                every claim its sources do not support.
                [Target ▾] [Disease ▾]  Open memo →        Read how it works →
                AI judgement from public data, not investment advice
```

- Picker: recorded state lists only recorded pairs; live state lists every pipeline row and its diseases.
- "Open memo →" goes to that target page at panel a (`?disease=…&panel=a`). It never starts a run.
- "Read how it works →" goes to the Diligence page.
- Phone: one sentence, the two pickers stacked, the button full width. It sits above the figure; accepted cost is the
  front door's data starting about 60–90px lower on phones (measured and reported, not a hard target).

### 6.3 Diligence page (`/diligence`, second in the nav)

Nav order: Pipeline · Diligence · Watchlist · Approaches · Changes · Trials · Methods. Uses PageHead.

1. Head: title "AI diligence", one sentence on what it does, the not-investment-advice label.
2. How it works: three steps in one row (one column on phones): draft with citations → checker removes unsupported
   claims → judgement shown only if its reasons survive. Plain text and rule lines, no illustration.
3. Recorded memos: a table from `index.json`: target · disease · AI read (stance, confidence or "withheld") · claims
   supported n of m · removed · recorded · → opens the target page at panel a. Phone: two-line rows.
4. How well it does: the headline numbers from `eval-report.json` (support rate, checker agreement, judgement shown
   rate, mean cost) with a link to Methods for the method. Absent numbers are not shown.
5. Live state only: the picker from 6.2 for any target.

Methods keeps the full method; the page links to it rather than repeating it.

### 6.4 Target pages: diligence first

When the gate is open, the diligence panel becomes panel a and the others shift down a letter (Timeline b … Stop
chance g). The contents strip, the header strip's links, `exampleHref` and every `?panel=` use the new letters. When
the gate is closed, today's order stays (diligence g), so nothing changes before Task 11. The design revision is not
pushed, so no outside links to the old letters exist.

Panel a's content per state:
- Recorded run for this pair: the memo, as today.
- Live, no run yet: what the agent does plus Run, as today.
- Recorded only, no run for this pair: one line, "No recorded memo for this target yet" plus a link to the Diligence
  page's list. Not the "agent is offline" message.

(Claude's call.) The two strips follow the same rule in the recorded-only state for a pair with no memo: the header
strip reads "AI diligence: no memo recorded for this target yet · See recorded memos →" (to `/diligence`), and the
contents strip's word for panel a is "not recorded". With the gate closed, both keep today's offline wording.

### 6.5 What goes

- The front door's example line (replaced by the band).
- The "agent is offline" message as a visible state once the gate is open.

## 7. Left to the builder

- Component and file names, CSS, and how the gate is read (one shared hook is expected).
- Exact copy within the wording rules above.
- Tests: unit tests for the three gate states on each surface, the index writer in `agent/`, and an e2e pass at
  1280 and 375 with a fixture `index.json` that is clearly synthetic (fixtures only, never in `web/public`).
- Screenshots of all three states at 1280 and 375, light and dark, on a port ≥4180.
