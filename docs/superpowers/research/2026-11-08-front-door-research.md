# Front-door redesign: research and newcomer audit (2026-11-08)

This note supports the front-door redesign brainstorm (HANDOFF §00, "Session 7b"). It has two parts. The first is outside research on onboarding and first-look clarity. The second is a newcomer audit of the built app, done from the real-data screenshots and the source.

The audit's screenshots predate work item A. They show Unclassified at 831 and Non-drug care at 1,062; current figures are in HANDOFF §00. Its file:line references are as of `8f24ad7`.

Verification marks: **V** means confirmed in a source during the research, **U** means not verified. Fetch any U item before quoting it.

## Part 1. Outside research

### Onboarding and narrative

- **Segel & Heer 2010, "Narrative Visualization" (V, via secondary sources).**
  - Places narrative visualizations on a spectrum from author-driven to reader-driven.
  - The **martini glass**: a tight author-led stem (the framing and the finding) that opens into free exploration.
  - https://homes.cs.washington.edu/~jheer/files/narrative.pdf
- **Stoiber et al. 2022, comparing onboarding methods (V, abstract).**
  - 596 participants. A step-by-step guide did not improve correctness for familiar chart types; it helped only for the least familiar type.
  - Readers preferred video, then scrollytelling, then step-by-step.
  - *Implication:* a dot timeline is a familiar form; UMAP is the unfamiliar one and the one that would need onboarding.
  - https://jku-vds-lab.at/publications/2022_visinf_compare_evaluations_onboarding/
- **Stoiber et al. 2025, "Inconspicuous Guides" (V, abstract).**
  - Light, optional guides were rated helpful; compulsory tours less so.
  - https://www.scitepress.org/PublishedPapers/2025/131359
- **Borkin et al., "Beyond Memorability" (V, secondary).**
  - Titles are looked at first and recalled most.
  - A title that states the takeaway, plus text annotations, improves recall of the message.
  - https://vcg.seas.harvard.edu/files/pfister/files/infovis_submission251-camera.pdf
- **Hullman & Diakopoulos 2011, "Visualization Rhetoric" (V, secondary).**
  - Headlines and annotations frame the reader's view.
  - *Implication:* always state the denominator and the data date.
  - https://mucollective.northwestern.edu/project/vis-rhetoric
- **Gap:** no direct experiment comparing a guided tour with on-chart annotation was found.

### How data journalism opens

- **Datawrapper (Lisa Charlotte Muth) (V, snippets).** Tell the reader the point with an annotated chart, and put the headline in the chart.
  - https://www.datawrapper.de/blog/readers-time
  - https://www.datawrapper.de/blog/weekly33
- **Our World in Data (partly V).**
  - Charts open with a finding-style title, a subtitle giving units and years, and a source line.
  - Shared links and thumbnails keep the exact chart state.
  - https://ourworldindata.org/redesigning-our-interactive-data-visualizations
- **NYT Upshot, The Pudding, FT, Reuters (U).** The usual pattern is a headline finding, then an annotated hero graphic, then scroll or explore.

### Clinical-trial and pipeline tools

- **Cummings et al., the yearly Alzheimer's drug-pipeline review in Alzheimer's & Dementia: TRCI (V, news summary).**
  - Counts by phase and by mechanism are the headline.
  - The 2025 edition: 182 trials of 138 drugs.
  - This is the genre that pharma and biotech readers already know.
  - https://www.eurekalert.org/news-releases/1127975
- **Commercial tools: Trialtrove, Cortellis, GlobalData, Evaluate, BioPharmCatalyst, Open Targets (U).** These open on tables, phase funnels or swimlanes; none gives a one-glance read of the field.

### UMAP and t-SNE for lay readers

- **Chari & Pachter 2023, "The specious art of single-cell genomics" (V).** 2D embeddings distort substantially and can mislead.
  - https://doi.org/10.1371/journal.pcbi.1011288
- **Wattenberg, Viégas & Johnson 2016, Distill (V).** Cluster sizes and the gaps between clusters may mean nothing.
  - https://distill.pub/2016/misread-tsne/
- **Guidance:** an embedding is fine for "find this trial's neighbours". If kept:
  - show no axes;
  - label it as a similarity layout;
  - offer a nearest-neighbour hover;
  - never narrate the gaps between clusters.

### Animated transitions and censoring

- **Heer & Robertson 2007, "Animated Transitions in Statistical Data Graphics" (V).**
  - Animated transitions can improve perception.
  - Complex changes should be staged, and each dot keeps its identity and colour.
  - https://idl.uw.edu/papers/animated-transitions
- **Showing right-censored items (V, indirect).**
  - Survival and event plots show ongoing items with an open mark or a dashed continuation, plus a "data as of" cut-off line.
  - Example: https://www.jmp.com/support/help/en/18.0/jmp/event-plot.shtml
  - No trial-landscape tool doing this was found (U), which is an opportunity.

### Ranked recommendations from the research

1. Use a headline that states a finding, with real numbers, a source and a date.
2. Write two to four annotations on the chart when it loads, not a tooltip tour.
3. Open author-led, then hand over to exploration (the martini glass).
4. Give running trials an explicit "still running" look and a "data as of" line. Never colour them as failures.
5. Stage the transitions between arrangements.
6. Label the similarity map as similarity, with no axes.
7. No forced tour. At most, one optional and dismissible prompt.
8. Use a pipeline count by phase and mechanism as the anchor.
9. Keep the URL state shareable.
10. State the framing: the denominator, the inclusion rules and the date.

## Part 2. Newcomer audit of the built app

### Three visitors, first 60 seconds

- **Hiring manager.**
  - The first bold words are "Data may be stale." (`FreshnessBadge.tsx:36`).
  - Next come six colour modes, eight filters and a scatter with no axes.
  - The boldest sentence in panel b is a null result, p = 0.061.
  - They leave thinking "pretty, but nothing found".
- **MS clinician.**
  - "Acts on MS4A1": nobody says MS4A1, they say CD20.
  - Rituximab sits under Targeted, not "Antibody & plasma", which reads as a contradiction.
  - The known negative OLYMPUS trial (NCT00087529) shows "Completed, outcome unknown".
  - "17% succeeded" means a drug advanced to a later phase, not efficacy, and that definition is in small print.
  - Graph labels such as "Hemostasis" and "Sensory Perception" look unrelated to the disease.
- **Data scientist.**
  - Likes the permutation test and the "too few to tell" handling.
  - Notices that panel b ignores the filters while panel c follows them (`Explore.tsx:425` vs `:430`).
  - The map rotation adds nothing analytic.
  - The time bias of "success = later phase" is not stated.
  - Filter state is not in the URL.

### Top first-look problems, ranked

1. **No front page and no headline.** The route goes straight to the scatter (`App.tsx:30`).
2. **The loudest finding is a null result in statistical wording** (`PanelSuccess.tsx:159`, text from `explorer.ts:776`).
3. **The definition of "succeeded" is buried** (`PanelSuccess.tsx:167`).
   - Next to "974", the rail's "17% succeeded" reads as 17% of 974; the real figure is 54/310 (`ApproachRail.tsx:25`).
   - "Completed, outcome unknown" on known negative trials reads as a data error (`format.ts:85`).
4. **The map doesn't read as 2,987 trials.**
   - Dots stack and there are no axes.
   - "Embedding of…" explains nothing (`Explore.tsx:343`).
   - Some cluster labels are vague, for example "MS · other interventions".
5. **Four overlapping taxonomies with no explanation:** Treatment, Mechanism, Modality and Approach (`explorer.ts:400-407`, `Toolbar.tsx:222-245`).
6. **Mechanisms opens on the hairball graph** (`App.tsx:32`).
   - "Where successes converge" lists five IL pathways, each at "5 of 10 · 50%": probably one shared-receptor drug family counted five times. **Check this.**
7. **Unclassified sits in the rail as a peer approach** and lists names like "a", "balance" and "101 part a". It reads as a data-quality failure.
8. **Phone graph layout gaps** (fixed since, in `529b38f`). Also "Hover a node…" is shown on touch screens (`MechanismsPage.tsx:548`).

### Jargon visible in the UI, with plain replacements

| Term | Where | Replacement |
|---|---|---|
| "Embedding of N trials (…)" | Explore.tsx:343 | "N trials; similar trials sit close together" |
| "Share that succeeded, of finished trials that could succeed" | PanelSuccess.tsx:72 | "How often the drug advanced to the next phase" |
| "cluster no more than chance would (p = …)"; "shuffled labels" | explorer.ts:776-782 | "Successful trials aren't concentrated in one part of the map" (p-value to Methods) |
| "success pool" | MechanismsPage.tsx:318, SidePanel.tsx:133/291/296 | "finished trials that count" |
| "Succeeded (drug moved to a later phase)" | format.ts:83 | "Advanced to next phase" |
| "Completed, outcome unknown" | format.ts:85 | "Finished, no next-phase trial found" |
| "Succeeded via another drug" | SidePanel.tsx:97 | "Advanced, through [drug]" |
| "credited to the drug that moved on" | ApproachRail.tsx:73, PanelSuccess.tsx:146, MechanismsPage.tsx:547 | "counted for the drug that advanced" |
| Treatment / Mechanism / Modality / Approach | Toolbar.tsx:222-245 | Intervention type / Drug target class / Drug format / Treatment family, each with a one-line hint |
| "Unclassified", "Not yet sorted…", "No experimental treatment listed", "Not a treatment" | approaches.ts:14-28 | "Not yet categorised", moved below the rail or into Methods |
| "proposed" tag | KindTree.tsx:91 | "Thought to work by:" |
| Graph key: "Reactome pathway", "GO term", "Hollow: too few to tell" | MechanismsPage.tsx:423-438 | "Biological pathway", "Pathway (other source)", "Size = number of trials" |
| "Acts on MS4A1 (binding agent)" | SidePanel.tsx:224 | "Target: CD20 (gene MS4A1)" |
| "panel d", "Click a dot in **a**" | Toolbar.tsx:177, SelectedTrial.tsx:100 | "the trial card below", "the map" |
| "Data may be stale." | FreshnessBadge.tsx:36 | "Registry data from 6 Nov 2026" |
| "drag to turn", "Play" | Explore.tsx:78/416 | Drop the rotation |

### Keep

- The typography, restraint and dark-mode parity.
- The honest "too few to tell" handling.
- **The best moment in the app:** the rituximab focus chain, drug → CD20 → BCR signalling → immune system, with its trial list.
- The Outcome = succeeded filter lighting red paths.
- The trial rows in the side panel.
- The kind trees with their rationale and sources.
- "Show these trials on the map" and its arrival banner.
- The phone numbered key, and "Nothing here uses AI".

### Hand-offs between the two pages

- **Explore → Mechanisms:** only through one selected trial (`SelectedTrial.tsx:123`). Panel b rows, the Approach key and the cluster labels are not links.
- **Mechanisms → Explore:** works, but there is no way back ("Back to rituximab").
- **Filters don't travel,** and they are not in the URL.

### Verdict

The similarity map is a good Figure 2 or 3 but a weak front door.

A newcomer wants these, in order:
1. What this is, and the key numbers.
2. What worked: the advanced drugs and their targets.
3. What is running now.
4. Only then the map.

## Data facts checked for the competitive-intelligence angle (2026-11-08)

- `explorer.json` per trial has `lead_sponsor`; `trials.json` also has `sponsor_class` and `why_stopped`.
- **Sponsor names need normalising to a parent company.** Examples from real data:
  - Hoffmann-La Roche 46 + Genentech 9;
  - Novartis Pharmaceuticals 70 + Novartis 11;
  - Merck KGaA 20 + EMD Serono 19;
  - Alexion 20 (AstraZeneca).
- **Academic sponsors are a large share** (Johns Hopkins 34, Kessler Foundation 28, …) and must be marked as non-industry.
- **Top industry sponsors:** Biogen 111, Novartis Pharmaceuticals 70, Roche 46, Sanofi 39, Teva 24, argenx 21, GSK 18.
- **Limit to state plainly:** the data is ClinicalTrials.gov registered trials only. There are no preclinical programmes, no company pipeline disclosures and no EU-only trials.
