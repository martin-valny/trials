# By year arrangement, Explore retired from the nav (design)

Status: for Martin's approval. Amends `2026-11-08-front-door-pipeline-design.md` (§5 nav, §7.1a arrangements, §7.5 trial map). Mockup: `docs/superpowers/mockups/2026-11-08-front-door/by-year.png` (real data; source `by-year-template.html`, data injected from a real `pipeline.json`; axis from 1995 and 1-year bins in the mock, see §By year for the build values).

## Why
Martin, on the shipped front door (2026-11-09): the trial map (UMAP) doesn't make sense to him. "It was supposed to be something people just see and understand… but it's just like wtf." The critique holds: its clusters replay the features we fed it (disease, treatment type, molecule, mechanism), so it shows nothing a filter wouldn't, its one statistic is null, and distances mean nothing. A whole-registry timeline was mocked and dropped: for an R&D reader it mostly adds non-drug care, and its targeted-drug row was a squashed copy of the pipeline. What that reader does want, "what's rising, what's fading", fits the pipeline figure as a third arrangement.

## Goals
1. **By year arrangement** on the pipeline figure: `By phase | By disease | By year` (URL `view=year`). The same rows, families, "Mostly historical" divider, Running column, company lens, sort, disease filter and legend; the columns become start years.
2. **Explore leaves the nav:** Pipeline · Approaches · Changes · Trials · Methods. No drawer.
3. **"Show … on the map" links become "List these trials"** → `/trials?nct=<comma list>&from=<label>` (plus `disease` when set), and the Trials page honours it with an arrival banner "Showing {n} trials from {from} · Clear" (the map's banner pattern).
4. **The similarity map stays reachable only from Methods:** one line in the `map-statistic` section, "Similarity map (experimental): trials laid out by how alike they are →" to `/explore`. No other work on it.

## Non-goals and anti-goals
- No standalone timeline page. No new work on the UMAP. No deletion of the map code (Martin chose keep-but-unlinked).
- By year never claims "rising opportunity" or similar; notes state trial-start facts only.

## By year: what the visitor sees
- **Columns:** start years from **2000** to the current year; **2-year bins on desktop and tablet, 3-year bins on phone** (≤ 640px). Header ticks every 5 years. Trials starting before 2000 go in the first bin, which is labelled "≤2001" (or "≤2002" on phone); trials with no start year are not drawn, and the source line says how many.
- **Cells:** one mark per placement (same mark styles as the figure), stacked bottom-up in the bin, ordered advanced → running → stopped → finished → unknown; marks the same size as the other arrangements (8px desktop, 6px phone), cells wrapping onto more lines where a bin is dense. The "data as of" rule is a vertical ink hairline at the snapshot date across every row.
- **Notes (data-written, this arrangement only, replacing the By phase rules):** in order, each on a distinct row, max 4, hidden under the company lens:
  1. **Rising:** highest share of trials started in the last 5 years (min 5 trials, ≥ 60%): "{r} of {n} trials started since {year}."
  2. **Fading:** row with ≤ 1 running and the most trials started before 2012 (min 15): "{k} trials before 2012; {run} running now."
  3. **Longest run:** widest span of start years among rows with ≥ 20 trials (min 15 years): "Trials every few years since {first year}."
  (The mock produced CD19 CAR-T / Interferon-β / Cannabinoids.)
- **Headline:** unchanged from By phase (running counts don't depend on the arrangement).
- Phone: the strip shows the year bins instead of phases; sticky header shows ticks every 5 years.

## Explore retirement: details
- `SiteNav`: remove the Explore drawer (desktop and phone sheet). `/explore` route stays.
- Replace every map link with a trials-list link (current sites: `TargetPage.tsx` "Show these {n} trials on the map", `TrialCard.tsx` "Show on map", `SidePanel.tsx` kind and node "Show these trials on the map", `Methods.tsx` not-yet-categorised groups, `MechanismsPage.tsx` "Show its … on the map", and the footer/intro links in `PipelinePage.tsx` and `TargetPage.tsx` "Trial map"). Wording: "List these {n} trials →" / "List this trial" is not needed on the trial card (it has "Open trial page"; drop "Show on map" there).
- `TrialsList`: read `nct` (comma list), `from`, `disease`; filter to that set; banner "Showing {n} trials from {from} · Clear" (Clear removes the params). Unknown NCTs ignored; empty result says "None of these trials are in the current data."
- Methods: the similarity-map line in `map-statistic`; copy elsewhere that says "on the map" is rephrased.
- The graph stays reachable via Approaches → Targeted and target pages' "Open in the mechanism graph".

## Approaches considered
- **A. Whole-registry timeline replacing the map (dropped):** readable, but redundant with the pipeline for this reader and mostly non-drug care.
- **B. Legible UMAP (dropped):** labels and 2D help, but it still replays its inputs.
- **C. By year on the pipeline + map unlinked (chosen):** answers rising/fading for the targets the reader cares about, reuses the figure, lens and URL state.

## My calls
1. Axis starts at 2000 with a "≤2001" first bin (the mock's 1995 start left most rows empty on the left).
2. 2-year bins desktop, 3-year phone.
3. By year has its own three note rules; By phase's rules don't apply there.
4. Trial card drops its map link instead of gaining a list link (a single trial already has "Open trial page").

## Testing
- `lib/pipeline.ts`: year binning (pre-2000 into the first bin, null years excluded and counted), the three note rules with thresholds, `view=year` URL round-trip.
- Pipeline page: arrangement switch renders bins, notes, hidden disease control stays visible (By year keeps the disease filter), phone strip.
- Trials page: `?nct&from&disease` filter, banner, Clear, unknown NCTs, empty state.
- Nav: no Explore item; `/explore` still renders; Methods link present; no "on the map" copy outside Methods/Explore (plain-words test).
- E2E: front page `view=year`; target page "List these trials" → Trials with banner; nav has no Explore.
- Real-data screenshots of By year (1280/375, light/dark) and the Trials banner.
