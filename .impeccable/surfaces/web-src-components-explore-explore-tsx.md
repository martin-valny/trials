---
version: 1
slug: "web-src-components-explore-explore-tsx"
primary_target: "web/src/components/explore/Explore.tsx"
related_targets: []
---

Scope: the Explore route (web/src/components/explore/*), the site's new home. Visitor mode: Experience (the work leads from the first viewport). Audience: a hiring panel first (minutes, not hours), then clinical-ops / CI leads, then researchers. Job: understand the trial landscape in one view and test "do successful trials cluster?" in a few clicks. Constraints: static, $0, config-driven (no condition names in source), honest labelling of the success proxy.

## Direction contract

THESIS: The page is Figure 1 of the paper you would write about this landscape: a white plate with panels a–d, live. It refuses the category default of a three-pane analytics tool (filters left, canvas centre, details right) and the glowing dark "AI dashboard".

OWN-WORLD: White plate (#fff), near-black ink (#111), one rubric red (#c8102e) reserved for "succeeded"; blue-grey supporting values (#3b4a57 … #e4e8eb). Hairline rules (1px #d6dadd; a 1px ink rule above the legend). Bold lowercase panel letters (a, b, c, d) at 22px/800; figure title set "Figure 1 |" bold then regular. Hanken Grotesk throughout, self-hosted. Legend controls: the single-select Colour group is a segmented pill set, solid ink when pressed; multi-select filter pills are an ink 1px outline with ink text when on and muted text with a hairline border (swatch faded) when off. Red is used only for succeeded data — never for focus rings, ticks, links or category colours. Dark mode = "Dark slide": #17191c ground, #eceae4 ink, #ff8a3d accent.

STORY: The visitor sees every trial of the area as one rotating cloud and reads the title as a claim to test. They learn the cloud is placed only by what trials study, see red where trials succeeded, read panel b's one-sentence answer with its shuffled baseline, toggle colour and filters in the legend, click a dot and read its registry summary in d, then open the trial page or ClinicalTrials.gov.

FIRST VIEWPORT: Slim top bar (brand left; Explore, Changes, Trials, Methods right; freshness badge). Figure title across the top-left, ~28px, max 70ch. Below, a 2:1 grid: panel a (canvas) spans two rows on the left, at least 60% of viewport width and ~70% of the remaining height; panel b (success by disease bars with average tick + lift sentence) top right; panel c (trials by phase, red = moved on) bottom right. A full-width 1px ink rule, then the legend bar: Colour [Outcome|Phase|Disease], Show [disease pills], phase/outcome/type pills, "Find a trial" search, "Showing N of M trials", and panel d (selected trial line + 2-sentence summary). The canvas auto-rotates slowly; drag rotates; click selects. Primary action: click a dot.

FORM: Impeccable's pick, "The Figure Plate" (grounded candidate 1 of 7, user-chosen over the roll and two re-rolls). seed: seed:60730230eacb10e5

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
