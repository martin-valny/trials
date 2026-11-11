---
name: Trial Radar
description: "The Figure Plate: every route (front door, target pages, Watchlist, Approaches, Changes, Trials, trial page, Methods) set as figures of a paper on a white plate with lettered panels; Explore keeps its own styles on the same tokens."
colors:
  plate: "#ffffff"
  ink: "#111111"
  muted: "#5b6268"
  rule: "#d6dadd"
  pale: "#e4e8eb"
  ladder: "#e4e8eb"
  rubric-red: "#c8102e"
  slate: "#3b4a57"
  slate-ring: "#8796a3"
  outcome-stopped: "#222222"
  outcome-completed: "#c9d1d8"
  outcome-running: "#3c5488"
  dark-plate: "#17191c"
  dark-ink: "#eceae4"
  dark-muted: "#9b9d9f"
  dark-rule: "#34373c"
  dark-pale: "#2b2e33"
  dark-ladder: "#3d4147"
  slide-orange: "#ff8a3d"
  dark-outcome-completed: "#50575f"
  dark-outcome-running: "#8da3d6"
  disease-ms: "#3c5488"
  disease-nmosd: "#00a087"
  disease-mogad: "#8e5ea2"
  disease-mg: "#4dbbd5"
  disease-cidp: "#e0a030"
  disease-ae: "#7e6148"
  dark-disease-ms: "#8da3d6"
  dark-disease-nmosd: "#3cc7a8"
  dark-disease-mogad: "#cf8fd6"
  dark-disease-mg: "#7fd3e6"
  dark-disease-cidp: "#f0c060"
  dark-disease-ae: "#b8977a"
  outcome-unknown: "#aab3bb"
  dark-outcome-unknown: "#6a7178"
  family-band: "#62758a"
  dark-family-band: "#7a8ea5"
  category-other: "#8796a3"
  category-multiple: "#111111"
  category-none: "#c9d1d8"
  dark-category-other: "#6c7f93"
  dark-category-multiple: "#eceae4"
  dark-category-none: "#50575f"
typography:
  scale-meta:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.45
  scale-ui:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.4
  scale-body:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  scale-reading:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.6
  scale-lede:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "19px"
    fontWeight: 400
    lineHeight: 1.35
  display-front:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "30px"
    fontWeight: 500
    lineHeight: 1.15
    letterSpacing: "-0.018em"
  display-target:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "40px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.03em"
  display-page:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "34px"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  display-trial:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  plate-title:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "clamp(20px, 2vw, 28px)"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "-0.005em"
  panel-letter:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 800
    lineHeight: 1
  panel-heading:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 700
    lineHeight: 1.3
  claim:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.45
  body:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  note:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.45
  pill:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
  canvas-label:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "11.5px"
    fontWeight: 600
  canvas-numeral:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 800
rounded:
  pill: "999px"
  dot: "50%"
spacing:
  gutter: "40px"
  gutter-phone: "16px"
  column-gap: "36px"
  row-gap: "6px"
components:
  pill-segmented-on:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.plate}"
    rounded: "{rounded.pill}"
    padding: "4px 10px"
  find-input:
    backgroundColor: "{colors.plate}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "4px 12px 4px 28px"
  dropdown-rest:
    backgroundColor: "{colors.plate}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "4px 10px"
  dropdown-narrowed:
    backgroundColor: "{colors.plate}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "4px 10px"
  pill-narrowing-on:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.plate}"
    rounded: "{rounded.pill}"
    padding: "4px 10px"
---

# Design System: Trial Radar

## Scope (read first)

Since the design revision of 2026-11-10 (spec `docs/superpowers/specs/2026-11-10-design-revision-design.md`) the Figure Plate governs **every route**: the **front door** (`/`, the pipeline figure, `web/src/components/pipeline/*`), **target pages** (`/target/:slug`, `web/src/components/target/*`), the **Watchlist** (`/watchlist`), **Approaches** (`/approaches/:approach`, still `web/src/components/mechanisms/*`, root `.explore.mechanisms`), **Changes**, **Trials**, the **trial page** (`/trial/:nct`) and **Methods**. **Explore** (`/explore`, linked only from Methods) keeps its own styles in `explore.css` and `web/src/lib/explorer.ts`; it reads the shared tokens and was not otherwise revised.

- **Tokens:** one set, on `:root` in `web/src/plate.css` (plate palette, mark colours, the `--fs-*`/`--lh-*` type scale), redefined under `:root[data-theme="dark"]`. The legacy `--bg --fg --accent --card --warn-* --ok` tokens and the `:root:has(...)` re-pointing are gone; `styles.css` keeps only the site header, the theme switch, the freshness note and a few shared utilities.
- **Frame:** `.page` (plate.css) is the full-width column every non-figure route uses: max 1440px, 40px gutters (16px at 640px and below); `main:has(> .page)` drops `main`'s old 72rem frame. Target pages keep their own 40 / 24 / 18px gutters (18px on a phone, ruling R10).
- **Page head:** one shared `PageHead` (below) on Watchlist, Approaches, Changes, Trials, the trial page and Methods; the front door and target pages set their own heads to the same rules (24px under the site header, at most one computed sentence).

The front door is documented in "The Front Door", the stop-risk surfaces in "Stop-risk estimates", the revised routes in "Site pages"; the Overview to Motion sections below describe Explore and Approaches unless they say otherwise.

## Overview

**Creative North Star: "The Figure Plate"**

The page is Figure 1 of the paper you would write about the trial landscape: a white plate with lettered panels a to d, live. It is flat, ruled and typographic: hairlines and bold lowercase panel letters do the structuring work that cards, shadows and tinted panels do elsewhere. One rubric red is reserved for the single claim being tested, that a trial succeeded. In dark mode the same plate becomes a "Dark slide": warm near-black ground, off-white ink, orange in red's place. The theme is a manual choice in the shared header (System, Light, Dark; System follows the OS scheme), resolved onto `<html data-theme>` before first paint.

It refuses the category default of a three-pane analytics tool (filters left, canvas centre, details right) and the glowing dark "AI dashboard". The figure title is set as a claim ("Figure 1 |" bold, then regular). Density is high but quiet: small type (12 to 14px), tabular numerals, no ornament.

**Key Characteristics:**
- White plate, near-black ink, hairline rules; flat, no shadows.
- Red (orange in dark) means "succeeded" and nothing else.
- Bold lowercase panel letters a, b, c, d (22px/800) anchor each panel.
- Hanken Grotesk only, self-hosted (400, 500, 700, 800).
- Pills for every control, set as one legend line above the plate; the canvas is the hero and starts still (Play turns it slowly).

## Colors

Monochrome ink on white with blue-grey supporting values and a single red.

### Primary
- **Rubric Red** (#c8102e, `--red`): data marks for "succeeded" only (on the front door: "advanced to a later phase", the same fact under another name): canvas dots (opaque emphasis pass), the succeeded segment of panel c's phase columns, the inline swatch in panel c's heading, and the Succeeded swatch in the figure key and the Outcome dropdown. Dark mode: **Slide Orange** (#ff8a3d) fills the same `--red` token.

### Neutral
- **Plate White** (#fff, `--plate`) / dark **Slide Ground** (#17191c): page and control ground.
- **Ink** (#111, `--ink`) / dark (#eceae4): text, bars, the rule above panel d, selected pills, focus rings, links, Phase 4 (stopped trials are the near-ink #222222).
- **Muted Slate** (#5b6268, `--muted`) / dark (#9b9d9f): secondary text, off pills, placeholder, pill borders at rest.
- **Hairline** (#d6dadd, `--rule`) / dark (#34373c): off-pill borders, sticky panel d top border on phone.
- **Pale** (#e4e8eb, `--pale`) / dark (#2b2e33): bar tracks, skeletons, unknown/early phase fill.
- **Outcomes (editorial journal)**, light: succeeded #c8102e (red, reserved), stopped #222222, completed with outcome unknown #c9d1d8 (the pale ground of the cloud, deliberately under 3:1), running #3c5488 (navy); the unknown-outcome ring stays mid grey #8796a3, distinct from completed. Dark: succeeded #ff8a3d, stopped #eceae4, completed #50575f, running #8da3d6, unknown ring #6c7f93.
- **Phase ramp** (blue-grey), light: #c9d1d7 Phase 1, #8796a3 Phase 2, #3b4a57 Phase 3, ink Phase 4. Dark: #3d4147 Phase 1, #6c7f93 Phase 2, #7fb2e5 Phase 3, ink Phase 4.
- **Mechanism and Modality modes** (no ink fill, no red). The six commonest mechanism classes over the whole file (by trial count, a trial counting in each of its classes), or the six modalities in their fixed order (small molecule, antibody, protein, oligonucleotide, cell therapy, gene therapy), take the disease series hues in order, so colours never shift when filtering. The rest are told apart by shape, not shade: a single class outside the six is a **slate** fill (#8796a3, dark #6c7f93); **more than one** class is a hollow 1px **ink ring** (#111, dark #eceae4), with a ring swatch in the key; **no known** class is the cloud's pale ground (#c9d1d8, dark #50575f, the completed-unknown values, so it stays visible on the dark plate). Hued classes are drawn in the emphasis pass. The key and dropdown swatches show only classes some trial is painted (a class seen only on multi-class trials gets no swatch).
- **Disease series (editorial journal)** (Disease colour mode; no ink, no red). Each condition keeps its own hue, dealt in the area's configured condition order (then any other first-listed condition, alphabetically), cycling past six; share plays no part, so colours never shift. Light: MS #3c5488, NMOSD #00a087, MOGAD #8e5ea2, myasthenia gravis #4dbbd5, CIDP #e0a030, autoimmune encephalitis #7e6148. Dark (tuned on real data): #8da3d6, #3cc7a8, #cf8fd6, #7fd3e6, #f0c060, #b8977a. The cyan and ochre sit near 2.2:1 on white; they are dots with a named key, never text. Trials of every condition but the largest are redrawn in the emphasis pass so small conditions stay visible.
- **Approach mode** (no ink fill, no red). The six approaches with a hue take the disease series in the vocabulary's order, the same hues as the mechanism series, so no new colour enters the plate: light Targeted drugs #3c5488, Cell & transplant #00a087, Antibody & plasma #8e5ea2, Tolerisation #4dbbd5, Broad immunomodulators #e0a030, Non-drug care #7e6148; dark #8da3d6, #3cc7a8, #cf8fd6, #7fd3e6, #f0c060, #b8977a. **Unclassified** (and "No approach" in a file built without the approach config) is the cloud's pale ground (#c9d1d8, dark #50575f) with a hairline-bordered swatch, as "no known mechanism" is. A trial in **more than one** approach is the hollow 1px ink ring. Hued approaches are drawn in the emphasis pass. The key lists the hued approaches some trial is painted, then "More than one approach", then Unclassified.
- Selection ring on the canvas uses ink (the stopped colour), never red.

### Named Rules
**The Only-Succeeded Rule.** Red is used only for succeeded data. Never for focus rings (ink, 2px, 2px offset), ticks, links, selection, errors or category colours.
**The Shape-Not-Shade Rule.** Greys are told apart by shape, not shade. "Unknown outcome" is a hollow 1px ring; in Mechanism and Modality modes "more than one" is a hollow 1px ink ring, "other" a slate fill and "no known" the pale ground. Every fix to a label or colour problem is made by shape, weight or position, never by a new hue, fill or chrome.

## Typography

**Font:** Hanken Grotesk (self-hosted via @fontsource, weights 400/500/700/800), fallback `system-ui, sans-serif`.

**Character:** One family; hierarchy comes from weight (500 vs 800) and size, not from a second face.

### Type scale (every route)
Six steps, as `--fs-*` / `--lh-*` tokens on `:root` (`plate.css`); the eight sizes between 11 and 15px that were in use before 2026-11-10 (11, 11.5, 12, 12.5, 13, 13.5, 14, 15) were snapped onto them.

| Step | Token | Size / line | Use |
|---|---|---|---|
| Meta | `--fs-meta` | 12 / 1.45 | captions, notes, sub-lines, column heads, the freshness note, the diligence strip's label, HTML axis labels |
| UI | `--fs-ui` | 13 / 1.4 | controls and pills, table cells, panel headings (700), the contents strip, the diligence strip, company names |
| Body | `--fs-body` | 14 / 1.5 | panel prose, stop reasons, memo text, trial-page facts |
| Reading | `--fs-read` | 15 / 1.6 | Methods prose, PageHead sentences, the target lede on a phone |
| Lede | `--fs-lede` | 19 / 1.35 | the target-page lede (desktop), Methods h2 |
| Display | (px) | 30 / 1.15 front-door headline (24 on a phone); 40 / 1 target title (34 on a phone); 34 / 1.1 PageHead title (28 on a phone); 28 / 1.15 trial title | page heads |

Outside the steps on purpose: the 20px target panel letter and 22px Explore panel letter, the 30px front-door key numbers (22 on a phone), the 15px front-door row name and 19px running count, the 17px brand (`--fs-brand`), and 16px (`1rem`) on phone text inputs so iOS does not zoom.

**12px is the floor for text.** Allowed 11px exceptions: the front door's uppercase family band labels (`.fam`, 11px/700, +0.09em; 12px on a phone, `.pfam`) and the "Mostly historical" divider label in the same style; HTML axis labels of a scale (`.rk-axis` on the stop-risk scale, `.years-scale` in the Years range; ruling R4); canvas numerals (800, 11px) and Explore's canvas cluster labels (11.5px). The target timeline's SVG (`TargetTimeline.tsx`) sets its sizes on the scale too: year ticks 11px (an axis-tick exception), the "Data as of" label 12px/600, the lane sub-line ("45 trials · 20 running") 12px, the lane name 13px/700 (12px above the lane on a phone); `TargetTimeline.test.tsx` holds it there. `css-scale.test.ts` allows a rem or em size only when it is a scale step (×16), and `1rem` only on an input, textarea or select (16px stops iOS zooming on focus); the 11px exceptions match whole class names. Measured share of text under 12px at 1280 (`type.mjs`, real data): front door 5% (46% before), target page 2% (37%), Watchlist 0% (31%), Methods 0%, Trials 0%.

### Hierarchy
- **Plate title** (500, clamp(20px, 2vw, 28px), 1.2, -0.005em): "Figure 1 |" in 800 then the claim in 500; max 70ch, balanced wrap.
- **Panel letter** (800, 22px, 1): lowercase a-d, 10px right margin, sits left of the panel heading.
- **Panel heading** (700, 13px, 1.3).
- **Claim** (500, 14px, 1.45, ink, max 52ch): the one-sentence answer in panel b.
- **Body / panel d / bars** (400, 13px, 1.5): panel d's key at 700 in ink; values muted. The figure key is 12px.
- **Note** (400, 12px, 1.45, muted, max 52ch); phase labels 12px (11px on phone).
- **Pill** (400, 13px). **Canvas cluster label** (600, 11.5px, ink on a plate-coloured 2px halo); a cluster's disease prefix ("MS · ") is set in 400 muted, the mechanism or type part in 600 ink. **Canvas numeral** (phone only, 800, 11px, ink on a 3px plate halo).
- **Header note** (12px, muted): the freshness line; when stale, "Data may be stale." in ink 700, then "registry as of 6 Nov 2026" muted.
- Numerals are tabular wherever counts sit in columns (bars, pill counts, "Showing N of M").

### Named Rules
**The Lowercase Letter Rule.** Panels are labelled with bold lowercase letters only; no uppercase tracked labels above panels. Field labels are sentence case (the trial page's facts, table heads); the only uppercase text left is the front door's kicker, family bands, "Mostly historical" divider and red margin-note kickers. The trial page's "Main factors" heading over the stop-risk factors (`.rk-fh`) is 12px muted sentence case like every other small label.

## Layout

A column filling the viewport: slim shared header, title, toolbar, plate, ink rule, panel d.

- **Toolbar** (a `role="group"` named "Map controls", above the plate, 40px gutters, closed by a 1px hairline inside the gutters so it reads as the figure's legend line): Find, Colour (segmented: Outcome, Phase, Disease, Mechanism, Modality, Approach), the Results posted narrowing pill, the filter dropdowns (Disease, Phase, Outcome, Treatment, Mechanism, Modality, Approach, Years), Reset all, and "Showing N of M trials". Groups sit 18px apart, controls within a group 6px. Side by side (901px and up) it is always set on two deliberate lines: find, colour, then Results posted and the count at the right; under them the filters, and Reset all at the right. From 901 to 1199px the find field narrows to 11.5rem and the colour parts to 7px padding; from 901 to 1099px Results posted opens the filters' line instead of the first. On a phone the six colour modes are a three-by-two block in the same hairline frame (13px corners). Only the count sits out of DOM order.
- **Header** (shared): brand, the freshness note, nav, theme switch on one line; at 1279px and below the switch drops its "Theme" word.
- **Plate:** `flex: none`, so panel d follows it at a fixed gap rather than being pinned to the viewport bottom. A 2fr/1fr grid (3fr/2fr at 901 to 1279px, so panel b's bars stay long enough to compare) with two rows and a 36px column gap. Panel a (canvas) spans both rows on the left; side by side it is sized to the viewport, `max(420px, min(62vh, 100dvh - 330px))`, not stretched to the right column, so its key and caption land above the fold. Under panel a's heading sits the **figure key**: one 12px line of swatches and words for the active colouring, closed by a "View as list" link; under the canvas, the "Dot size" caption. Panel b (success by disease: bars, average tick, lift sentence) is top right; panel c (trials by phase, columns, red = moved on) bottom right.
- **Panel b group by:** a segmented pill (By disease | By modality | By mechanism | By approach). Where panel b is narrow (901 to 1099px, and phones) the pill is a two-by-two block. Outside By disease a success is credited only to the groups of the drug that moved on (1b), and a second note says so. Disease keeps the area's order and lists every condition; modality and mechanism list the eight groups with most finished trials; approach lists all of them in the vocabulary's order with Unclassified last, the order of Figure 2's rail and the Approach key, and draws Non-drug care as the rail does: no track, a 12px muted dash, "—" and "success not defined" (the two figures never disagree). A trial counts in each group it touches, and the note says so ("Trials with several modalities count in each" / "mechanisms"). A group under min_group (10 finished) shows no percentage ("—" in the share column): the outline bar, its counts ("1/5") and "too few to tell" in 11px muted under the count; the rows share one column set (subgrid), so tracks stay aligned. "Outlined: fewer than 10 finished trials." follows whenever such a row shows.
- Under the claim a note says what "similar" means for the statistic (disease, treatment type, molecule, population; mechanisms are the By mechanism view).
- **Panel d:** below the plate a full-width 1px ink rule opens a two-column key/value block (6.5rem key column, 18px gap) holding only panel d (the selected trial line and summary).

Bars: grid of label (6 to 10.5rem; capped at 8.5rem at 901 to 1279px, words wrap), track (at least 110px, 12px tall), share, count; the average is a 2px ink tick with a 1px plate knockout; a bar with too few finished trials is an outline, not solid.

Responsive:
- **<= 900px:** single column; panel a min-height 60vh; once a trial is selected, a short sticky line (plate ground, 1px hairline top border) keeps it in view at the bottom with a link down to panel d.
- **<= 640px:** gutters 16px; panel a's canvas is a square; each bar sets its label and numbers on one line above a full-width track; dropdowns open as a bottom sheet; cluster labels become numerals with a numbered key under the canvas (see Shapes).

## Elevation & Depth

Flat. No shadows, no blur, no tonal layers. Depth comes from the canvas's perspective (dot size and alpha scale with depth) and from hairline and ink rules. The only box-shadow is a zero-offset 1px plate-coloured knockout around the average tick. The canvas separates overlapping marks with a 1px plate-coloured ring on emphasised dots.

## Shapes

Rules are 1px square lines; bars and tracks are square-ended rectangles. Every control is a full pill (999px). Dots, swatches (9px, 1px border) and rings are circles.

**Canvas dot encoding** (`PlateCanvas.tsx`):
- Position: placed only by what trials study; centred on centroid and scaled so the 98th-percentile trial sits on the unit circle, computed over all trials so filtering never moves the cloud. **Fit:** the still view's projected box (no turn, the plate's tilt, with perspective), trimmed to the 1st-99th percentile on each axis, fills 94% of panel a at one isotropic scale, centred on the box rather than the centroid. The turn keeps that scale and shift, so outliers beyond the trim may clip while it plays.
- Radius (CSS px): (1.6 + sqrt(min(enrollment, e98)) / 7) x k x perspective, where e98 is the 98th-percentile enrollment (the cap) and k = clamp(sqrt(600 / count), 0.75, 1) is the crowding scale.
- Alpha: visible dots 0.8 to 0.9 by depth; filtered-out dots 0.08.
- Emphasis pass: in Outcome mode succeeded trials, in Disease mode every trial whose first condition is not the dominant one, in Mechanism and Modality modes every trial painted a series hue (exactly one class, among the six), are redrawn on top, opaque, radius at least 3px, with a 1px plate knockout ring. Phase mode has none.
- Hollow 1px rings: unknown outcome (Outcome mode); more than one class (Mechanism and Modality modes, ink).
- Selected and hovered: 1.5px ring 4px outside the dot, in ink.
- **Labels** (a quiet switch beside Play: Clusters · Diseases · Off, the chosen word in ink and underlined). Clusters: the named HDBSCAN clusters, at most 8 side by side (6 on a phone), each with at least 15 trials, each name once (its largest instance); slots are reserved by kind (5 mechanism-named + 3 type-named, 4 + 2 on a phone; a kind with fewer gives its spare slots to the other, mixed clusters fill what remains), mechanism labels first. Diseases: each condition at its own densest region (same-condition neighbours weighted by their share of all neighbours, so it is not anchored in the shared centre); the background condition (over 60% of trials) gets none.
- **Label placement** (`placeLabels`, every frame): 8 directions around each anchor (east first) at leaders of 6, 18, 32 and 48px (the cap), scored against a 10px grid of the visible dots (a box may cover at most 3 dots within a dot's reach of its edge), the dots its leader runs through, distance and crossings with other leaders. A label never touches another label, the control band (Labels, Play, Reset view) or the canvas edge, and a leader never runs through another label. A label with no fit becomes a margin callout beside the cloud's box (any side) where its leader crosses the fewest dots; with no room at all it is dropped, never overprinted. Each label remembers its side, so labels do not flicker while the map turns. Set in ink on a 2px plate halo with a 1px ink leader (none when the label touches its dot).
- **Phone labels (<= 640px):** no names on the canvas: small ink numerals 1-6 (800, 11px, 3px plate halo) at the anchors, placed by the same rule, and a numbered 12px key under the canvas ("**1** MS · anti-CD20 (ocrelizumab)", prefix muted), journal figure-key style. No key when labels are off.

## Components

### Pills
Single family, `border-radius: 999px`, `padding: 4px 10px`, 13px, 1px border.
- **Segmented (Colour: Outcome | Phase | Disease, single-select):** one pill split in three (muted outer border); the chosen mode is solid ink with plate text.
- **Hover:** border goes to ink. **Focus-visible:** 2px ink outline, 2px offset, everywhere.

### Find a trial
Pill-shaped search in the toolbar, 13px (16px on a phone, so iOS does not zoom), 12.5rem wide (full width on a phone), muted border, a drawn 12px hairline-ink magnifier inside its left edge. Enter opens the first match in panel d.

### Dropdown (filters) and phone sheet
A pill button with a 9px hairline ink chevron (turns 180° when open, 160ms, motion-safe only). **At rest** (shows every value) it reads only its name ("Mechanism ⌄") on a hairline (`--rule`) border; the value stays in its accessible name ("Mechanism: all"). **Narrowed:** ink border, and ": value" joins the name, the value in 700 ("Phase: **4 of 6**"). The popover is a flat plate inset: 1px hairline frame with an ink top edge, no shadow, 16 to 24rem wide, opening from the button's right edge where it would leave the viewport. Inside: Select all / Select none as underlined words, then a checklist of square 11px hairline boxes with an ink check, optional 9px swatch (in the active colour mode), label, and a tabular count flush right. Disease (when long) and Mechanism get a filter field: a hairline (`--rule`) pill, no native ring, one 2px ink outline at 2px offset on `:focus-visible` only. Mechanism and Modality list classes by trial count (modality in its fixed order), each trial under every class it has, and a "No known mechanism / modality" row last. Escape, a press outside, or Tab out closes it. **Phone (<= 640px):** a bottom sheet capped at 44dvh with a 1px ink top rule, a title and Done; opening it scrolls the page so the map sits just above the sheet.

### Years range
A dropdown ("Years: all" or "Years: 2014–2019") holding From and To pill fields (tabular, four digits) over a hairline track; the chosen span is a 2px ink bar between two square-ended 10px plate handles with ink borders (14px wide, 28px tall on a phone). Moving one end past the other drags it along. Not shown when no trial has a start year.

### Narrowing pill (Results posted)
Off is "show all", so it is never struck through: ink text, muted border. On: solid ink, plate text. Carries a tabular count of trials with results posted.

### Reset all
A word, not a pill: muted and idle while nothing is narrowed; ink with a muted underline once there is something to reset; resetting hands focus to Find.

### Figure key
Under panel a's heading: one 12px line of 8px swatches and words (ink), wrapping as needed, naming the active colouring; nothing to press. Unknown outcome and "More than one mechanism / modality" are ring swatches. Mechanism and Modality list the series classes painted, then "Other mechanism" / "Other", "More than one …" and "No known …" (a hairline-bordered pale swatch). Disease mode lists conditions in the area's order (the order their hues are dealt in), and only those some trial lists first (the Disease dropdown shows swatches for the same set). "View as list" (ink link) keeps to the line's end.

### Hover card
Mouse and pen only, never touch. Two lines (id and title, 2-line clamp; then drugs, mechanism, modality, the first approach with its kind in brackets and "+n" for more, treatment, phase, years) on a flat plate with a 1px ink border, 12px, max 18rem, no pointer events. Centred above the hovered dot with its bottom edge 10px above the dot's ring, flipped below only at the panel's top edge, kept 4px inside the panel horizontally; a 1px ink leader runs from the card to the ring, like the cluster labels' leaders. The spin pauses while a dot is hovered.

### Play / pause
Quiet text plus a drawn 10px glyph (1.5px ink stroke) in panel a's top-right corner, not a filled pill: "Play" when still, "Pause" while turning; its accessible name says what a press will do ("Play rotation" / "Pause rotation"), with no pressed state. Absent under `prefers-reduced-motion: reduce`.

### Reset view
Shown only while the map is zoomed past 1x, beside Play (to its left) in panel a's top-right corner, in the same quiet style: 13px text and a drawn 10px four-corner frame glyph (1.5px ink stroke), hairline border on hover, ink only (never red). A press returns to 1x and hands focus to the map.

### Theme switch
In the shared header: one quiet text control, "Theme" (muted) then the choice, cycling System, Light, Dark; a 9px key circle is empty for Light, solid for Dark, half-filled for System. At 1279px and below the word "Theme" is dropped (glyph and choice stay).

### Freshness note
In the shared header, after the brand: one muted 12px note, never a tinted pill. Fresh: "Last updated … · registry data as of …". Stale (over 36 hours): "**Data may be stale.**" in ink 700, then "registry as of 6 Nov 2026" muted (the last update's date when there is no registry date); the full timestamps sit in its title. No amber, no red.

### Mechanisms (Figure 2): rail, tree, side panel
`/approaches/:approach` is Figure 2: "**Figure 2 |** Approaches: every trial by how its treatment works, from drugs with a molecular target to the approaches without one.", set in the shared PageHead (same 24px top gap and 40px left edge as the other tabs) at the plate-title size (clamp(20px, 2vw, 28px)/500, "Figure 2 |" in 800). Under the title a one-line toolbar with only the Disease and Outcome dropdowns (the map's filter model; the Outcome swatches key the outcome strips), Reset all, and "Showing N of M trials". Filters apply to the rail and the canvas together. Three columns side by side: the rail (14 to 17rem), the canvas, and panel c (18 to 22rem) when a kind is open; 36px gaps.
- **Rail (panel a, "Approaches")**, a figure legend: one button per approach in the vocabulary's order, all seven always listed (a filtered-out approach shows 0, never disappears). Row: label and tabular count on one line (13px), then the success line: a 5.5rem x 4px pale track with an ink fill at the raw share and "17% succeeded" in 11px muted; under `min_group` an outline fill and "too few to tell (1/5)"; with none finished "none finished yet"; Non-drug care a 12px muted dash and "success not defined". The selected row (`aria-pressed`) has a 2px ink rule on its left and its label in 700, never a filled pill. A note under the rail says success is credited to the drug that moved on.
- **Chips (<= 900px):** the rail becomes one horizontally scrolling row of pills (label and count, no bar) that bleeds into the gutters and scrolls on its own (no page scroll, scrollbar hidden); the selected chip is solid ink.
- **Canvas (panel b):** heading "**Cell & transplant** · 68 trials · 40 in the success pool, 1 succeeded" (the summary in 400 muted); Non-drug care adds one note that success is not defined. Then a one-line strip key (Succeeded, Stopped early, Completed, Running, Status unknown as a ring). Targeted drugs holds the graph (below). An approach with no matching trials says "No trials match these filters." with Reset filters (or "No trials in this approach yet." when nothing is narrowed).
- **Tree:** a typeset list, not a graph. Group heading 13px/700 over a hairline; kind rows indented 14px: label, a dotted muted leader, "35 trials" (tabular), the outcome strip and the share (a percentage, "too few to tell" in 11px muted, or empty when none finished; no share column for Non-drug care). Groups and kinds run by trial count. A group longer than 20 rows shows the first 20 and a "Show 471 more, 475 trials" text button. The tree is capped at a 46rem measure, so a row's share sits by its strip however wide the canvas is (with panel c closed the canvas is far wider than the tree needs). Rows are buttons; the open one takes the same 2px ink left rule and 700 label as the rail.
- **Outcome strip:** a 6px square-ended bar whose length is the kind's trials against the largest kind in the tree, split by outcome in the order succeeded (red, the only red), stopped (ink), completed (pale), running (navy), unknown (a hairline outline, as the map's ring).
- **Rationale:** 12px muted under the group (when all its kinds share one) or under the kind: "**proposed** paracrine immunomodulation… source", the leading "Proposed" of the config text replaced by the bold tag, the source an ink link.
- **Unclassified:** "Not yet sorted" lists the unsorted names by trial count (the mapping backlog), "No experimental treatment listed" holds trials with no experimental treatment kept, and "Not a treatment" its kinds. A fourth group, last, "Not yet sorted, in trials of other approaches", lists the unsorted names carried only by trials sorted elsewhere (an unmapped drug beside a mapped one; 73 names, 66 trials on the real data), so no unsorted name is hidden; the note under the tree says so. Added by the whole-branch review (2026-11-08) and outside spec §7.2: **awaiting Martin's sign-off** (the alternative is to drop it and let those names go unshown).
- **Panel c (side panel):** behind a hairline left rule, sticky to the viewport: "**c** kind" with a Close word, "Approach › Group" muted, counts by outcome and the pool sentence, the rationale, "List these {n} trials →" (`/trials?nct=…&from=…`), then every trial (NCT in 800, title, outcome muted) between hairlines. It takes focus on open; Escape or Close returns focus to the row. **<= 900px:** a bottom sheet (max 60dvh, ink top rule, plate ground), as the filter sheets are.
- **Graph (Targeted drugs, panel b):** a 2D canvas (`GraphCanvas`, 22rem to 42rem tall, 64vh; 24rem on a phone) between two hairlines, the seeded layout stretched to a 28px-padded frame. Above it, the find pill "Find a drug, target or pathway" on a right-aligned line of its own (a combobox; matches in a flat inset with an ink top edge, the active row on the pale ground; on a phone at full width), then the key on one line directly over the frame (circle drug, square target, diamond Reactome pathway, a diamond with an inner diamond for a GO term, a dashed outline for curated, the share ramp "Success share, 0 to N%", "Hollow: too few to tell", "Size: trials"); one line at 1280, wrapping only where the canvas is narrower (panel c open, phones). The key is never taller than its lines: a compact wrapping block (`align-content: flex-start`, 4px/14px gaps, 6px/12px on a phone) so the canvas starts right under it. Marks: size by trials reaching the node (3 to 12px radius); fill by pool success share from the pale ground to the success red at the figure's highest share; under `min_group` a hollow mark on the plate (shape, not shade); 1px strokes. Edges are hairlines: GO edges finely dotted, curated dashed, shared-gene links sparse dots and never followed. **At rest** everything at reduced ink with only top-level pathways labelled in muted 11px, greedy with a 3px gap between labels. **Phones (<= 640px)** carry no names at rest: ink numerals 1 to n (800, 11px, 3px plate halo) beside the top-level pathways, most trials first, each in the first spot (right, left, above, below) clear of other labels and of other nodes' marks, and a numbered 12px key under the canvas ("**1** Immune System"), as Explore's phone map does. Lit nodes are still named. **Hover** (mouse or pen) puts the node and its one-hop neighbours in full ink with labels; **click** focuses the chain (drug → target → pathway → ancestors, or a pathway's targets and drugs) and opens panel c; Escape or a click on empty space clears. Everything not lit fades to faint context (0.14). **Filters light up instead of hiding**: the nodes the shown trials reach go to full ink, and paths credited with a success (1b, the drug that moved on) are drawn in the success red, the only red. Labels: the hovered or focused node in 700 first, then lit nodes by size, at most 32, greedy without overlap, each with a 3px plate knockout and cut with an ellipsis rather than leaving the canvas. Under the figure, when the node cap left drugs out, a muted caption gives the cut ("Showing 66 of 515 drugs: every drug credited with a success and those in 4 or more trials."); then a one-line note says what is lit and ends "Pathways from Reactome release 98.", then "Where successes converge": up to five pathways below the top level, by pool share, as a numbered list of node links with "5 of 10 · 50%" in muted tabular figures, and the note "Pathways below the top level, ranked by success share among pool trials." Find also lists the drugs the cap left out, marked "not drawn"; choosing one (or a `?node=` link to one) puts a muted note under the find bar ("abatacept is not drawn: it is in 3 trials, and the graph shows …") with the link "List its 3 trials →". No `mechanisms.json`: "The graph appears after the next update."
- **Panel c for a node:** the same frame as a kind's: "**c** label", "Targeted drugs › Drug / Target / Pathway · source" (curated in 700), then a two-column fact list (muted terms): Mechanism and Acts on (with the action) for a drug; Acted on by and Pathways for a target (a class node says "no pathway: a molecular class with no gene target"); Part of, Contains and Targets for a pathway. Related nodes are underlined text buttons that move the focus. Then the source links (Reactome, Gene Ontology, the curated reference, ChEMBL), the trials shown by outcome and the pool sentence, "Show these trials on the map", and the trials (the first 40, then "Show all N trials"). A top-level pathway says it is never counted where successes converge.
- **Map hand-over:** on Explore, `?nct=` narrows the map to those trials on top of the filters, announced in one ink line under the toolbar ("Only the 35 trials of mesenchymal stem cells. Show all trials"); Reset all and Reset filters clear it as well. Panel d links back with "Show in mechanism graph": `/mechanisms/targeted?node=drug:<its first targeted drug>` for a targeted trial, else `/mechanisms/<first approach>?kind=<its kind>`.
- **Checked on real data (2026-11-08, snapshot 2026-11-06, after the no-experimental-arm fallback and the 300-node cap):** rail 1,062 / 72 / 58 / 15 / 52 / 1,222 / 570; graph 300 nodes (66 of 515 drugs), 18 top-level pathways numbered 1 to 18 on a phone; the longest trees (Non-drug care, six groups; Unclassified, whose Not yet sorted backlog ends in "Show 471 more, 475 trials", then the fourth group's "Show 77 more, 77 trials") run past one screen, so the canvas column scrolls with the page while panel c stays sticky. Screenshots are taken from a fresh page per view: a hash-only navigation keeps the filters, so a capture after a filtered view shows the filtered state.

### Panel d (selected trial)
Under the ink rule, left key "d". Empty state is muted. Selected: bold-800 facts line (NCT, drugs, mechanism, "Targets: …", modality, each approach with its kinds in brackets ("Targeted drugs; Non-drug care (other device)"), phase, outcome, enrollment, sponsor), two-sentence summary, source label, links (Trial page, ClinicalTrials.gov, Show in mechanism graph; ink, muted underline darkening on hover, 3px offset). On narrow screens a sticky facts line links down to it (see Layout).

### Loading and empty
Skeleton in plate shape using Pale blocks; opacity pulse 1 to 0.55 over 1.6s only under `prefers-reduced-motion: no-preference`. Empty canvas shows a bold centred message and a button.

### Motion
The canvas starts still. Play turns it slowly (0.0022 rad per frame, tilt 0.32) until Pause; it also pauses while a dot is hovered and stops drawing while scrolled off screen. Dragging rotates (0.008 rad per px); a click (under 4px travel) selects.

**Zoom.** Wheel (only while the pointer is over the canvas, which then never scrolls the page), trackpad or touch pinch, and `+` / `-` / `0` while the focusable canvas has focus zoom from 1x to 8x about the pointer (keys: about the centre). It is a screen-space transform after projection: positions scale; dots, rings, labels and leaders keep their size, so dense clusters separate. Pan is clamped so the 1x frame always fills the canvas. Zoomed in, a plain drag pans and Shift-drag turns; a cluster label whose anchor leaves the canvas is hidden. Zoom is not kept across reload or a theme change, and reduced motion does not affect it (zoom is not motion). Under `prefers-reduced-motion: reduce` there is no turn and no Play control, and the canvas redraws only on change.

## The Front Door

Shipped 2026-11-08 (snapshot 2026-11-06). The home page is a **pipeline figure** and each of its rows opens a **target page**; both read only `pipeline.json` (about 178 KB raw) and `meta.json`, and extend the plate without changing it: Hanken Grotesk, hairlines, ink, no gradients, no panel chrome. Written down from the code and the real-data screenshots, not from the comp.

### Tokens
The plate palette, the mark colours and the type scale are one token set on `:root` in `web/src/plate.css`, used by every route and the Trial card: **`--run`** (running, #3c5488; dark #8da3d6), **`--stop`** (#222; dark #eceae4), **`--fin`** (finished, no follow-on, #c9d1d8; dark #50575f), **`--unk`** (status unknown, #aab3bb; dark #6a7178), **`--fam`** (the family band ink, #62758a; dark #7a8ea5, chosen to pass 4.5:1 on the plate) and **`--ladder`** (panel e's untouched ladder steps, #e4e8eb; dark #3d4147). `--red` stays Rubric Red and is **Slide Orange (#ff8a3d) in the dark theme** for "advanced". `.pipeline` and `.target-page` set 13px/1.5 Hanken Grotesk (the UI step), tabular and lining numerals, max width 1440px, and `main` loses its padding there.

### Mark vocabulary
One dot per trial. **Advanced** = solid red (orange in dark). **Running** = hollow ring in `--run`, 1.6px (1.3px at 6px). **Stopped** = solid `--stop`. **Finished, no follow-on** = solid pale `--fin`. **Status unknown** = dashed 1.2px ring in `--unk`. A trial that spans two phases ("1/2", "2/3") is drawn in the higher column with a 5px muted tail to its left (the `cb` mark). Size is 8px on desktop and 6px on a phone strip (and in tight lists such as the company lines). The hit area is 2px larger on every side. Advanced follows 1b and R21: only the drug that moved on, and under a disease only where it moved on there; any other succeeded placement is drawn finished and its tooltip and card say "Advanced, through {drug}". The legend repeats the five marks with plain words ("Advanced to next phase", "Still running", "Stopped", "Finished, no follow-on", "Status unknown") plus, on desktop only, "One mark per trial, oldest first" (or, By disease, "a trial in several diseases appears in each") and the tail glyph "spans two phases".

### Pipeline figure (`/`)
- **Lede:** 24px above, a 12px/700 uppercase kicker on its own line ("MS and autoimmune neurology · drug pipeline", muted; kept on its own line at desktop to name the disease area for a cold visitor, hidden on a phone, ruling R15), then a headline in 500, 30px/1.15 (24px on a phone), -0.018em, max 42ch (the narrowest measure that sets today's sentence on two lines at 1280; 34ch gave three), balanced. The first sentence is a finding drawn from the data ("185 targeted-drug trials are running." in `--run`), then "B-cell depletion leads, with 64 of them; CD20 alone has 53." in ink. With a company lens the company name is 800 and its running and advanced counts take `--run` and red. Right of it two **key numbers** (30px/500: advanced in red, companies with a running trial in ink; 12px muted captions under, max 13ch). There is no running key: the headline states it. On a phone the two keys sit on one line under a hairline, each number beside its caption.
- **Source line** (12px muted; one line at desktop, two or three lines on a phone, where it wraps): "693 of 2,987 trials test a targeted drug in these 28 classes. Registered trials only. How rows are built →", the link to `/methods#rows-and-companies`; By year adds "; {n} trials without a start year are not drawn" to its sentence. Under it the **diligence line** (12px muted, `.source.dg-line`): "An AI agent drafts a checked diligence memo on each target page." then "See an example: CD20 in MS →" to `/target/cd20?disease=MS&panel=g` once the recorded example run ships (`EXAMPLE` in `web/src/lib/diligence.ts`, the same pair panel g's offline link uses, ruling R7), and until then "How it works →" to `/methods#diligence`. The spec's "New:" was dropped (ruling R6). The full caveat ("693 of 2,987 trials test a targeted drug in one of these 28 classes; 369 more … (see all in Approaches). ClinicalTrials.gov registered trials only: no preclinical programmes, company pipeline disclosures or EU-only trials.") opens the footer. On a phone the source and diligence lines follow the figure, above the footer (ruling R16).
- **Controls** (from 1100px two lines: arrangement, disease and company lens, then the Sort select at the left with the **legend** at the right of the same line; below 1100px one wrapping line with the legend on its own line under it). The front-door legend is `.p-legend` (12px muted), its own class so Explore's global `.legend` key bar and it never style each other: an arrangement segmented pill (**By phase | By disease | By year**, selected = solid ink); under By phase a second, quieter segmented pill for the disease (All diseases, then the disease codes in the area's figure order: MS, MG, NMOSD, CIDP, MOGAD, AE), whose selected part is a pale tint with a 2px ink underline, not a second filled pill (it scrolls sideways on a phone); the **company lens** (a pill with a magnifier, "Company lens: find a company"; "Find a company" on a phone, where the long placeholder clipped, a combobox listing industry parents by trial count, then others; once picked it becomes an ink chip "Roche ✕"); and a "Sort" select (most running, most advanced, newest activity, A-Z). State is in the URL (`?disease=&company=&sort=&view=`, defaults omitted). By disease has the diseases as columns, so the disease filter does not apply there; By year (`view=year`) keeps it. The legend lists the five marks, then the arrangement note ("One mark per trial, oldest first") and "spans two phases" with the tailed mark as its own item, 18px apart like the rest (desktop only; the phone drops the note).
- **Grid** (desktop): a 200px label column, the phase or disease columns, a 116px "Running" column and a 210px margin-note column; column heads 12px/700 muted over a 1px ink rule, with a 12px sub-line ("incl. early phase 1", "incl. 1/2", "incl. 2/3", "phase 4" under **Approved use**). Cells are dotted 1px left hairlines with the marks wrapping in 3px gaps, oldest first. **By phase** columns are equal; **By disease** columns are weighted by the square root of each disease's mark count (floor 0.7fr, ceiling 2.2fr, `minmax(0, N fr)`), so a crowded column gets room and an empty one stays readable; an empty disease cell shows one 4px pale dot ("no registered trial of X in Y"). **Floor rule** (By disease only): a cell with at least one approved drug that is not withdrawn gets a 2px `--ink` rule along its bottom edge, inset 6px (3px on a phone strip), also on an otherwise empty cell, above its pale dot; its tooltip title sits on the rule and reads "Approved for {disease}: {drugs}.", repeated in visually hidden text. The company lens never dims it: approval belongs to the target. A key item (a short ink rule, "a drug on this target is approved for this disease") follows the mark styles in By disease only. Between 641 and 1099px the grid drops the margin-note column under each row (red kicker and leader kept); on a phone see below.
- **By year** (third arrangement, same rows, family bands, sorts and company lens): columns are start-year bins on an axis from 2000, the first bin labelled **≤2001** (trials from before 2000 fall in it). Bins are 2 years wide on desktop and 3 on a phone (`yearBins` in `web/src/lib/`). Ticks sit every 5 years and label the bin that contains each multiple of 5 (controller ruling). Marks are the same size as in the other arrangements (8px, 6px on a phone) and stack bottom-up in state order (advanced, running, stopped, finished, unknown); a hairline `asof` rule marks the data date. Column heads are the tick labels only (screen-reader text for the rest). It has its own margin notes, at most one per row: **Rising** (recent bins hold the growth), **Fading** (activity dropped; also requires more than half of the row's trials to be pre-2012) and **Longest run** (the longest span of years with starts). The By phase and By disease notes do not appear here.
- **Family bands:** a row group opens with its family label in 11px/700, +0.09em, uppercase, `--fam`, over a hairline (B-cell depletion, IgG and complement, Cell therapy, Kinases, Cytokines and co-stimulation, Lymphocyte trafficking, Broad immune modulation, Repair and protection, Symptom relief). Rows run in the sort order within a family; bands are dropped under the A-Z sort and under a company lens.
- **Row:** the whole row is a link to its target page (an overlay link, with the accessible name "CD20: 123 trials, 53 running, 11 advanced, 8 stopped. Open target page."); the pale `--pale` hover tint. Label cell: the class in 15px/700, a muted 12px sub-line (gene or format, e.g. "MS4A1 · antibodies"), and under it up to three industry parents as text links (dotted muted underline, ink on hover, **wrapping inline with the sentence**, never boxed) then "+5 · 31 academic" muted; "academic sponsors only" when there is no company. Clicking a company sets the lens (and does not follow the row link). Stat cell: the running count 19px in `--run`, "of 123", a 3px bar scaled to the row with most running trials, "5 companies". Rows with at most one running trial and 12 or more trials are **historical**.
- **Mostly historical divider:** a dashed hairline with the 11px/700 uppercase label "Mostly historical" and, desktop only, "— many past trials, at most one running"; those rows follow the divider at 62% opacity (Interferon-β, CD52, fampridine, α4-integrin on the snapshot). With the lens on, rows without the company drop to 45%.
- **Margin notes** (at most 4, one per row, none with the company lens): a 16px red leader and a 12px/700 uppercase red kicker over a 12px sentence. Every note is computed from the data so it cannot go stale: "Spreading" (By disease only: running in 3 or more diseases), "Most crowded" (5 or more running; "53 trials running, from 5 companies plus academic groups."), "Newest wave" (60% or more started in the last five years), "Most advanced" (3 or more), "Most stopped" ("13 stopped; 5 of them by Biogen. Reasons on the target page.").
- **Company lens:** the matching rows move to the top; on desktop the rest fade to 45% and marks of other sponsors drop to 13% opacity while the company's marks take a 1.5px ink outline; the headline becomes "Roche: 72 trials across 6 target classes; 20 running, 4 advanced." On a **phone** non-company rows would be unreadable faded, so they are hidden behind a full-width 44px "Show {n} other rows" toggle (ruling: one deviation from the desktop fade, phones only). A lens with no trials says "Nothing for X." with "Clear the company lens →".
- **Phone (<= 640px):** no grid. A sticky column header (12px/700, "Ph 1, Ph 2, Ph 3, Approved"; By disease uses the codes, long ones cut to three letters, so NMOSD reads NMO) over rows set as: name in 15px/700 and "{n} running" at the right, a strip of the same columns with 6px marks, the companies line, and the note with its red kicker. The legend note is dropped; the kicker is hidden; the headline, the two keys (on one line) and the controls stack with 18px gutters.
- **Hover and tap:** a mark's tooltip (ink ground, plate text, 8px corners, max 280px, the only shadowed surface besides the card) names the trial title, drug and parent, then NCT, phase, start year and state. A click opens the **trial card**.
- **States:** a skeleton of pale blocks; "The pipeline figure isn't available for this data refresh" with a link to Trials when `pipeline.json` is absent (R19); an empty plate line "No targeted-drug trials in X. Show all diseases →" under a ruled top edge. Footer: "'Advanced' means the drug has a later-phase trial on the registry. It does not mean the drug worked or was approved." and links to Methods and Approaches.

### Trial card
One component for the figure and the target page. A 10px-cornered plate card with a 1px ink border, 330px wide, anchored under the mark (flipped above when it would leave the viewport); on a phone a bottom sheet (14px top corners, max 80dvh, safe-area padding). Header: the NCT in 12px/700 muted and a 26px close; the title in 14px/600; a facts list (muted terms, 62px column): Drug, Sponsor (parent, with the registered name in muted brackets when different), Phase ("Phase 4 (approved use)"), Dates ("2019 to 2026 (expected)"), State (the mark and its words, "Advanced, through X" when 1b says so). A stopped trial adds the registry's reason as a quotation with a 2px ink left rule. Actions on a hairline: **Open trial page**, **ClinicalTrials.gov ↗** (the map link was dropped when Explore left the nav). It takes focus, closes on Escape or a press outside, and the disease filter rides along on its links.

### Trials list banner (`/trials`)
Every former "on the map" link is now **"List these {n} trials →"** to `/trials?nct=…&from=…` (target page footer, Approaches panel c and graph notes; the trial card has no list link). With `?nct=` the list shows a one-line banner "Showing {n} trials from {from} · Clear" and only those trials; Clear drops `nct` and `from`. `disease` stays in the URL but the list does not filter by it (deferred minor).

### Target page (`/target/:slug`)
Breadcrumb ("Pipeline / B-cell depletion", 12px muted, dotted underline link, which keeps the disease), then the header (`.thead`; plate tokens only, no card):
- **Title row:** the class in 40px/600 (-0.03em, line-height 1; 34px on a phone) with a muted 15px line beside it ("gene MS4A1 · B-cell depletion · antibodies"; 13px under the title on a phone). From 1100px the **disease chips** (pills with a tabular count, "MS 99", selected = solid ink) sit at the right of the title row and wrap there; below 1100px they are one line under the header that scrolls sideways and bleeds into the gutters, the selected chip kept in view (landed one gutter in). They are rendered in one place at a time, so reading and tab order match the screen. A chip re-scopes the whole page and its URL and keeps `?panel=`.
- **Lede:** one 19px sentence (`--fs-lede`, 1.35; 15px on a phone): "**41 of 99 trials are running** (`--run`), from 3 companies and academic groups. **6 advanced** (red) to a later phase; 7 stopped." At 1100px and up max 100ch with balanced wrap (46ch below). It is the only place the running / advanced / stopped counts appear: **there are no key numbers** (they repeated the sentence).
- **Diligence strip** (`DiligenceStrip.tsx`, `.dstrip`): one 13px muted line under the lede, plate tokens only, never red or orange; its action is a 600 ink text button with a muted underline. It reads the same run state as panel g (`useDiligence`, one fetch, one poll; `stripView` in `web/src/lib/diligence.ts`). States: **intro** with the agent configured: "AI diligence: an agent searches ClinicalTrials.gov, ChEMBL, Europe PMC and openFDA, writes a cited memo, and a second model checks every claim." + **Run diligence →** (starts the run, as panel g's button does, and scrolls to g); **intro offline** (no endpoint configured): the same sentence + " Offline at the moment." + **How it works →** to `/methods#diligence`; **running**: "AI diligence running · 12 s" + **Follow it →**; **read**: "AI read: {favours further investment | mixed | argues against further investment} · {confidence} confidence · {n} of {m} claims supported · Recorded {date}" (a withheld judgement reads "AI read: judgement withheld", never a stance; tails " · data has changed since", " · the latest run failed", " · daily run limit reached, try again tomorrow"; a run finished in this tab says "New run, {date}") + **Read the memo →**; **failed**: "The last diligence run failed." + **Run again →**; **capped** with no run: "Daily run limit reached, try again tomorrow."; **hidden** when the page's disease has no trials on the target; **loading**: a pale 10px bar at the strip's height, `aria-hidden`. Every state with a stance or memo adds the fixed label "AI judgement from public data, not investment advice" (12px/700 ink, word for word). **Print:** only the "AI read" state prints, without its action button or link; every other state (intro, running, failed, capped, loading) is left off paper, as are panel g's run button and the claim flag buttons and form (`plate.css`). **Phone (<= 640px):** the "what it does" sentence becomes "AI diligence: a cited memo from public sources, checked claim by claim." (panel g keeps the full one). **Reserved height**, so nothing below moves when the state changes: 42px below 1100px (sentence line + the label on its own line), 62px on a phone (ruling R8), and from 1100px one line (20px) with the label set inline 18px after the action (ruling R13); a rare long read line or tail may still wrap and grow by one line.
- **Contents strip** (`ContentsStrip.tsx`, `contents-strip.css`), then panel a. A `<nav aria-label="Panels on this page">` with one link per panel that renders (with no trials in scope only e and g): "**a** Timeline · **b** Companies 8 · **c** Stops 7 · **d** Mechanism · **e** Diseases 6 · **f** Stop chance 10 above · **g** Diligence not run"; the letter in 800, the name in 500, the number in 400 muted tabular, 13px, 24px apart (20px apart in 24px gutters below 1100px; 18px apart in 18px gutters on a phone). The numbers are the panels' own (companies listed, stopped trials, diseases listed, trials above their typical rate); g's word comes from the run (`contentsWord`: "recorded 9 Nov", "not run", "running", "offline"). Plain text on the plate, never pills: the current panel (an IntersectionObserver plus a scroll settle) takes `aria-current="location"` and a 2px ink underline; a hairline closes the strip. It is **sticky** at the top of the viewport on the plate ground; panel headings carry `scroll-margin-top` of the strip's measured height (`--strip-h`) + 16px, and panel g's sticky trace sits below it. **Click or Enter** scrolls to the panel (smooth only with no reduced-motion preference), moves focus to the panel heading (`tabIndex=-1`) and sets `?panel=g` with `replace`; the clicked item stays current through the scroll. A **deep link** `?panel=f` is read once on load and scrolls (without moving focus) once the panel has rendered; it survives a disease change and is dropped when that panel no longer renders. **Phone:** letter and name only, one line that scrolls sideways with the current item kept in view, items 44px tall, 18px gutters. **Print:** hidden.

Then the lettered sections, the same lowercase 20px/800 letter on a 1px ink rule as the plate's panels, each heading 13px/700:
- **a. Every {row} trial over time, by drug.** An SVG timeline (a 150px label column on the left on desktop: drug in 13px/700 and "45 trials · 20 running" in 12px muted, year ticks 11px; on a phone the lane name, 12px/700, sits above its lane and the plot is inset 14px). One lane per drug with at least four trials, variants of a root drug merged into it ("efgartigimod ph20" joins efgartigimod), the rest pooled as "Other {row}" last. Lanes pack dated trials into the fewest tracks, oldest first. The axis starts at the five-year mark before the earliest start, never before 2000, with hairline ticks every five years and ends a year after the latest expected end (cap 2032). **Encoding:** a line from start to end; **stroke weight is the phase** (1.8px phase 1, 2.6px phase 2, 3.6px phase 3 and 4; 2.4px on a phone); colour is the mark state; **running** trials start with a hollow circle and run to the data-as-of rule in `--run`, then continue as a thinner dashed line to their expected end; **advanced** ends in a solid red dot; **stopped** ends in a short ink tick; **unknown** is dashed; **finished** is the pale line. A vertical 1px ink rule marks "Data as of 6 Nov 2026" (12px/600 under the plot, set right of the rule, or left of it when it would run past the plot's right edge, as on CD38 at 1280, and always on a phone). Hovering (mouse) gives the tooltip; a click opens the card. A legend line under it (the same four glyphs) and, when some trials have no date, "{n} undated trials are not drawn"; **List these trials** opens a plain list (mark, NCT button, title, drug, sponsor, phase, dates, state) so no information is chart-only.
- **b. Who is working on {row}** ("by parent company"). One line per industry parent by trial count (seven, then "+2 more"): name as a dotted-underline link to the pipeline with that company lens, its top two drugs in muted 12px, its trials as a wrapping string of 8px marks (advanced first, then running, stopped, finished; each a button that opens the card), and "35 · 15 running" at the right. A last line "Academic and other" pools the rest.
- **c. What stopped, and why** ("8 trials"). **Reason pills** (`.reason-pill`: full 999px pills on a hairline border, 12px, no tint; Business or strategy 3, Sponsor or investigator decision 2, ...; hidden when "Other" would be more than 15% of the given reasons), then the registry's own words in quotation marks between hairlines (14px, a stop dot beside; drug, sponsor, phase, year and NCT in 12px muted), the first six and "Show all 8". Without any: "No {row} trial has stopped."
- **d. How it works.** A chain of ink-outlined pills joined by 38px arrow lines: the drugs (names in red, "14 drugs" under, the one red-outlined pill), the gene ("CD20" over "gene MS4A1"), the most specific pathway (clamped to two lines, source muted: Reactome, Gene Ontology, Curated) and its top-level pathway. On a phone the chain runs down a column with vertical connectors. The chain is computed in the browser from `mechanisms.json`. At the right of the heading (under the chain on a phone, a 44px line) "Open in the mechanism graph →" hands off to `/approaches/targeted?node=target:GENE&from=<row id>` (only when the graph holds the gene); under it the row's blurb and "Related on the pipeline: CD19 · CD20 CAR-T". Footer: "List these 123 trials →". Every outgoing link carries the disease.
- **e. {Row} by disease.** After panel d, one line per disease with a trial in the row or an approval, in the figure's order: disease name, trial count with "{k} running" in `--run`, a four-step phase ladder (Phase 1, Phase 2, Phase 3, Approved use; the furthest reached in ink, earlier steps in the family ink, later ones pale, each with its trial count beneath), and the drugs approved for the disease (name linking to its source, source in muted small text, withdrawn drugs last with a muted "withdrawn" tag) underlined by the same 2px floor rule when one is not withdrawn; "None approved" in muted otherwise. The selected disease is in ink weight. It has no success rate, on purpose (see Methods). Without approval data the header says "Approval data not available" and lines show the ladder only. On a phone (<= 640px) each disease is a block: name with "{n} trials · {k} running" at the right, the ladder, then the drugs.
- **g. Diligence (AI agent)** (letter **a** and first when the agent is open; see "Diligence centrepiece"). After stop-risk's panel f (`TargetDiligence.tsx`, `diligence.css`; plate tokens only, no red). A status line ("Recorded run, 9 Nov 2026", " · data has changed since" on a stale replay, "Running · 12 s") with an ink-outlined "Run diligence" / "Run again" pill when the agent URL is configured; offline with no run, "The diligence agent is offline" and, once that example has a recording, a link to it. Side by side (1100px and up) the **trace** is a 17 to 22rem column, sticky at the contents strip's height + 16px so the strip never covers it: a hairline-ruled log of numbered steps (kind as a word, tool name in 700, its one-line result, time taken), "Waiting for the next step…" while running, never a spinner. The **memo** beside it opens with an AI-written note, then under an ink rule Read (three numbered lines), Judgement (stance in 600, confidence, reasons as links to their sentences, or "Judgement withheld: claims behind it could not be verified" with each reason's verdict; always the label "AI judgement from public data, not investment advice") and What would change this view; then the four sections, each sentence followed by hairline citation chips (11px, linking to CT.gov, PubMed, Europe PMC, ChEMBL, DailyMed) and, on runs from the backend, a muted "Flag"; a partly supported sentence takes a dotted underline and the words "partly supported — {reason}" (a half-filled mark is decoration); "Removed by the checker" lists struck-through plain text and the reason, never links; then run details. Under 1100px the trace sits above the memo. The panel's note links "How the agent works" to `/methods#diligence` (`DiligenceMethods.tsx`): plain Methods typography (h2, h3, paragraphs, one list of evaluation figures, no chart); evaluation numbers come only from `diligence/eval-report.json` and, until it exists, one line says results are published with the first recorded evaluation.
- Under 861px panels b and c stack; under 641px the section captions drop. Unknown slug: "No target called 'x'." with a link home.

### Navigation
The shared header reads Brand, freshness note, nav, theme. The nav is **Pipeline** (`/`), then **Diligence** (`/diligence`, second, only once the agent is open; see "Diligence centrepiece" below), **Watchlist** (`/watchlist`), **Approaches** (`/approaches`, opens Targeted drugs), **Changes**, **Trials**, **Methods**: Pipeline · Watchlist · Approaches · Changes · Trials · Methods while the agent is closed (Pipeline · Diligence · Watchlist · Approaches · Changes · Trials · Methods when open), with no Explore entry and no drawer (the UMAP trial map was judged meaningless: its clusters replay the input features). `/explore` still works but is linked only from Methods ("Similarity map (experimental)"). On a phone the nav is a 36px menu button ("≡", "✕" when open) that opens a full-width sheet of the same entries, with the freshness line inside the sheet; the theme control is icon-only beside it. The old `/mechanisms/...` paths redirect to `/approaches/...`.

### Front-door rules
- **The Advanced Rule.** "Advanced" always means "the drug has a later-phase trial on the registry", never "worked". The footer says so on both pages, and the headline never claims more than that. There is no "open opportunity" or "white space" wording anywhere.
- **Running is not failing.** Running trials have their own colour and a hollow ring, and the figure always says "data as of".
- **Computed, not written.** Every sentence on these pages (headline, margin notes, ledes, captions) is generated from the data so it stays true after a daily refresh.
- Departures from "flat": the tooltip, the trial card, the company-lens list and the phone nav sheet carry a soft shadow because they float over the figure. Nothing else does.

## Site pages: page head, Changes, Trials, trial page, Methods

Moved onto the plate on 2026-11-10 (spec section 7). Same tokens, type, controls and frame as the plate pages; no new features. Shared code: `PageHead.tsx` / `page-head.css`, `ContentsStrip.tsx` / `contents-strip.css`, the registry-words formatter in `web/src/lib/format.ts`.

### PageHead
One head for Watchlist, Approaches, Changes, Trials, the trial page and Methods: an optional crumb (12px muted), the title (h1, 34px/600, -0.02em, 1.1; 28px on a phone), at most one computed sentence (15px/1.6, max 72ch, `text-wrap: pretty`), and an optional aside that sits at the right of the title row from 1100px and under the sentence below that (after the sentence in DOM order). 24px from the site header, no kicker, inside `.page`'s gutters (40px, 16px on a phone). Pages override locally through a class (`trial-head`, `.mechanisms`). Front door and target pages keep their own heads, built to the same rules.

### Shared rules
- **Links** in ink with a muted underline that darkens to ink on hover (3px offset); focus ring 2px ink, 2px offset everywhere (`:focus-visible` in styles.css). No blue anywhere.
- **Registry words:** `statusLabel` (Recruiting; Active, not recruiting; Completed; Terminated; Withdrawn; Unknown …), `phasesLabel` (Phase 1, Phase 1/2, …, "No phase" for NA, ruling R1); enum fields are sentence-cased, free text never (acronyms such as NIH, NMOSD survive).
- **One date format:** "6 Nov 2026"; month and year ("Aug 2028") when the registry gives no day; "(estimated)" / "(actual)" after a registry date where it says so.
- **Status mark** beside the word wherever a status shows (`.tr-mark`, 8px): running ring in `--run`, stopped dot `--stop`, finished pale dot `--fin`, unknown dashed ring `--unk`; never colour alone.
- **Tables** are the Watchlist's: 13px, tabular, head row 12px muted over a 1px ink rule, hairline rows. On a phone, two lines per row, no cards, no uppercase labels.

### Changes (`/changes`)
PageHead "Changes" with "{n} changes to tracked trials in the last 7 days; {k} notable.". One filter line: the time window as a segmented pill (1 day / 7 days / 30 days, selected = solid ink), **Sponsor** and **Field** as the Watchlist's dropdown pills with counts, **Notable only** as the narrowing pill. The table (trial: NCT 600 linked, title and sponsor muted; field; change: old value struck through in muted, new value in ink, "slipped 212 days" in 700; why notable; source) keeps the `table.changes` class for the tests but is styled only in `changes.css`. A short old or new value (a date, a status, a number: `keepWhole`, up to 28 characters) never breaks inside itself ("Jul 2027" stays whole; the arrow between old and new may wrap), and "slipped 212 days" stays whole on a phone; long values (names, outcome lists) wrap. Phone: line 1 NCT, field and change; line 2 the title (truncated), the date with its year ("6 Nov 2026", as on Trials; ruling R27) and why it is notable (ruling R19).

### Trials (`/trials`)
PageHead "Trials" with "2,987 tracked trials, most recently changed first.". The find pill (15.5rem; full width on a phone) searches every trial; **Status** is a dropdown pill with counts. "Showing 50 of 2,987 trials", then 50 rows and "Show 50 more, 2,987 trials" (the Watchlist's pattern); any change of query or filter starts again at 50. Columns: trial (NCT 700, the title in 13px, sponsor muted), status mark and word, phase, primary completion, last change. Phone: line 1 NCT, status, phase; line 2 the title (truncated) and the last-change date. The `?nct=` banner ("Showing 35 trials from CD20 · Clear") keeps its behaviour in plate type. Page height at 1280 went from 285,616px to 5,103px.

### Trial page (`/trial/:nct`)
PageHead with the crumb "Trials / NCT…" (a breadcrumb naming the place, linking to `/trials`, ruling R21), the title in 28px/600 (balanced, long titles wrap), and one 13px muted line "NCT… · View on ClinicalTrials.gov ↗". Then the **facts** as a two-column list from 900px (muted sentence-case terms in an 8.5rem column, 14px values): Status (with the mark, ruling R22), Phase, Lead sponsor, Enrollment, Start, Primary completion, Study completion, Conditions, Interventions, Sites, and "Why stopped" across both columns. Then plainly headed sections (13px/700 over a full-width 1px ink rule; a record, so no letters): **Chance of stopping early** (the stop-risk block, its sentence, factors and note held to 40rem and the scale to 22rem inside the full-width section; "14% (11–20)" never breaks), Summary (15px reading prose, max 72ch), then, when a front-door row draws the trial, one 13px link line "Target: {row} →" to `/target/{id}` (from `pipeline.json`; nothing when no row draws it or the file is missing; ruling R26), Timeline (dated status and date changes between hairlines), Change history (the hairline table, short values kept whole as on Changes). The status mark (`.tr-mark`) lives in `marks.css`, shared with Trials. Empty states are one 14px muted line.

### Methods (`/methods`)
PageHead "Methods" with "How the 2,987 trials are collected, compared, grouped and scored, and what each number on the site can and cannot tell you.". From 1100px a 16rem **contents column** on the left (the `ContentsStrip` in its column orientation, `<nav aria-label="On this page">` under a muted "On this page"), sticky at 24px and scrolling on its own when taller than the viewport; the current section has a 2px ink rule on the left and ink text, the rest muted, 13px. Below 1100px the same list is a block at the top, wrapped into up to three columns. On arrival the first section is marked current while it is in view, before it reaches the reading line (the target page's row strip marks nothing until a panel reaches its line). Click or Enter scrolls to the section and focuses its h2; the choice is kept in `?s=` (`replace`). Arriving by `?s=` or by an old `#fragment` (other pages link to `/methods#stop-risk`) scrolls there and re-scrolls as data files land, until the visitor scrolls by hand. Prose 15px/1.6 at a **29.4rem measure** (`--measure`; about 56ch of Hanken at 15px, which holds lines to at most 75 characters; 68ch reached 92, ruling R24); h2 19px/700 over an ink rule, h3 15px/700, h4 14px/700. The stop-risk and diligence sections keep their figures and tables. The contents column is hidden in print. The Limitations section names the one AI-written text on the site: "The only AI-written text on the site is the diligence agent's memo on target pages, labelled as such; every other value comes from the registry record or is computed from it." (ruling R23).

## Diligence centrepiece: band, page, panel order

Shipped 2026-11-11 on `feat/diligence-centrepiece` (spec `docs/superpowers/specs/2026-11-10-diligence-centrepiece-design.md`). The agent is promoted from one panel to three entry points, behind a release gate. All plate tokens, no new colour, no red.

- **Release states** (`useDiligenceRelease`, `web/src/lib/diligenceRelease.ts`): **pending** (index not yet read), **closed** (no `diligence/index.json` with a run, no backend URL), **recorded** (index with at least one run), **live** (`diligenceEndpoint() !== null`). Closed is exactly the site before this work: panel g at the bottom, the front-door example line, no band, no nav item, `/diligence` redirecting to `/methods?s=diligence`. Pending shows neither the example line nor the band, so nothing flashes; one shift on first load in the recorded state is accepted. The index (`agent/scripts/site_index.py` writes `web/public/diligence/index.json`) lists only pairs: the site derives stance and claim counts from each memo, and the counting rule stays in TypeScript (`claimCounts`).
- **Panel-order rule** (`panelLetters`, `web/src/lib/diligencePanels.ts`): when the agent is open, diligence is panel **a** on a target page and the others move down one letter (b Timeline ... g Stop chance); closed, it stays **g**. `pairHref` builds `/target/{id}?disease=..&panel=a`; the contents strip and `?panel=` deep links follow the same letters. With no memo for the pair, the strip's word is "not recorded", the header strip reads "AI diligence: no memo recorded for this target yet · See recorded memos →" and panel a reads "No recorded memo for this target yet." with the same link. It never says "offline" while the gate is open. These "no memo" surfaces show no judgement, so they carry no not-investment-advice label.
- **Front-door band** (`DiligenceBand.tsx`, `diligence-band.css`): a named region between the lede and the figure, hairline above and below, no fill. "AI diligence" in 13px/700, one 14px sentence, a target and disease picker (`PairPicker`, native `<select>`s) with **Open memo →** as an ink-outlined pill (the figure keeps the only filled control above the fold), **Read how it works →** to `/diligence`, and the fixed label "AI judgement from public data, not investment advice" in 12px. **Under 768px there is no picker**: the band is the name, the sentence, one link (**Open a recorded memo →**; live: **Choose a target →**) to `/diligence`, and the label. The picker never starts a run; only the Run button on a target page does. Measured cost to the first figure row (fixture data, the same offsets as the session-12 real-data measurement): +104px at 1280 (398 to 502), +140px at 375 (501 to 641). The full phone band with stacked selects cost +299px and was rejected.
- **Diligence page** (`/diligence`, `DiligencePage.tsx`, `diligence-page.css`; a `PageHead` with the fixed label as its aside): How it works (three numbered steps), Recorded memos (a hairline table: target, disease, AI read as stance and confidence or "withheld", claims supported "n of m", removed, recorded date, **Open memo →**; two-line rows on a phone), How well it does (the evaluation's headline figures; a figure the report lacks is left out), and in the live state **Any target** with the picker. Any text the agent wrote shows only on the target page; this page shows its read.
- **Form controls:** `select` joins `input` and `textarea` in the 1rem (16px) iOS no-zoom exemption (`css-scale.test.ts`).

## Stop-risk estimates

Shipped 2026-11-09 on branch `feat/stop-risk` (snapshot 2026-11-06). One shared scale, one standing note and one set of copy rules serve four surfaces: target-page panel f, the Watchlist, the trial page and the Methods calibration figure. It extends the plate without changing it: hairlines, ink, no gradients, no cards; styles in `web/src/components/risk/risk.css` and `web/src/components/watchlist/watchlist.css`.

### The scale grammar (`RiskScale`)
A hairline track from 0 to 60% (axis labels 0, 20, 40, 60% set once above a column of scales by `RiskAxis`). On it: the **estimate** is a ring in `--run` (a running trial's colour, hollow like the running mark); the **range** is a pale band behind it, never an error bar with caps; the **typical rate** for comparable trials (the trial's phase, from the card) is a short ink tick. The ring never sits on a band edge (the range is placed around the estimate). Past 60% nothing is cut silently: an estimate above 60% turns the ring into a right-pointing arrowhead pinned to the axis end, and a range that runs on past 60% ends in a smaller band-toned arrowhead (an open end). The scale has an `img` role and a text label with the estimate, range and typical rate; the estimate is always also written as a number. Ends under 0.5% print "<1%", never "0%".

### Panel f on the target page: "Running trials, estimated chance of stopping early"
The sixth lettered section, f, after "By disease" (same 20px/800 letter on a 1px ink rule). Under the heading a **claim line** computed from the data ("7 of 40 running CD20 trials sit above their phase's typical rate."), a muted sub-line (row, disease, count, which typical rate the tick means), then the **8 highest estimates** (`RISK_SHOWN`) and a text button "Show all 30 running trials" that reveals the rest in place and moves focus to the first new row (not kept in the URL; print shows every row), one row per scored running trial, highest estimate first: trial name (drug and company, NCT linked to its trial page), the scale, the estimate and range in numbers with a vs-typical word (above, near or below; "near" whenever the range contains the typical rate), and up to three **factors** in words. On a phone factors sit behind a disclosure with a bare text look, not a button. It respects the page's disease chip; with no scored trial it says so in one line; with `per_trial` off it shows only a target summary sentence ("Median estimate 22% across 40 running trials; typical 15%"). Absent without `risk.json`.

### The Watchlist (`/watchlist`)
A page on the plate's toolbar and table vocabulary: the shared PageHead ("Watchlist", 34px/600) with one computed sentence ("237 running drug trials, ranked by estimated chance of stopping early; 79 sit above their phase's typical rate.", one line at desktop, max 90ch), then three multi-select filters (**Disease**, **Company**, **Target**, each with counts; Company is searchable past 8) and a sort (**Estimate** or **Difference from typical**). Filters and sort live in the URL, and a single chosen disease travels on to the target page. The standing note sits directly under the filters at 12px full contrast, sharing its line with the table's key where they fit. The table has trial, target and disease, the scale with its axis, estimate against typical, and factors. It shows **50 rows and a "Show N more, M trials" button** that adds 50 more; any change of filter or sort starts again at 50. On a phone rows stack and factors are a disclosure with bare text, as in panel f. With `per_trial` off the page lists targets by median estimate with their summaries instead of trials. With no `risk.json`: "Estimates appear after the next daily update."

### Trial page
Under the facts, a section headed "Chance of stopping early" like the page's others, then "Estimated chance of stopping early: **22%** (14–33), typical 15% for phase 2 drug trials", the scale with its axis, the factors under a 12px muted "Main factors", the standing note, and the CT.gov link the page already has. A trial that is not scored shows nothing there (the reason is in `risk.json`'s `not_scored`); nothing at all with `per_trial` off.

### Methods calibration figure
`/methods#stop-risk` ("How good is the stop-risk model?", in `RiskMethods`). An SVG **calibration figure** on the plate for the shipped model: estimated chance against the share that actually stopped early, one ink point per tenth of the held-out trials joined by a line, hairline axes with 11px tabular ticks and a dashed muted diagonal for a perfect match; the caption says points above the line mean more trials stopped than estimated. A metrics table (n, stopped, AUC, Brier) sits beside it. Around it plain paragraphs: what it predicts, how it is tested, which model is used, what is left out and why, comparison with published models, a dated "What we tried: trial text" paragraph (static text, a one-off result), how to read an estimate, and retraining. The in-area metric reads "too few to judge" under 300 trials (the number in muted text).

### Stop-risk rules
- **Wording.** "Estimated chance of stopping early", never "risk of failure" or "likely to fail". The typical rate is always beside the number. Factors state the trial's own value ("Sites planned: 112", "Sponsor's earlier trials: 3 of 24 stopped early (registry)") and a separate word says whether it raises or lowers the estimate, so a label can never contradict the value; start year is never a factor.
- **Standing note on every surface** (`RiskNote`, fixed copy): "Statistical estimate from public registry data. Not a statement about any sponsor or trial. The model is often wrong; see Methods for accuracy." The last words link to `/methods#stop-risk`.
- **Honest ends.** Ranges are never clipped silently (open-end arrowhead), nothing prints as "0%", and the model's measured accuracy is on Methods in plain words.
- **Computed, not written.** Claim lines, summaries and the typical-rate caption are generated from `risk.json`.
- **Colour is not the only carrier.** The estimate is a ring and a number; above, near and below are words; factor direction is "raises" or "lowers" in text beside the arrow, which is decoration.
- A scoped design-hook ignore (`.impeccable/config.json`) covers the `side-tab` finding in `risk.css`: the range's open-end arrowhead is a CSS border triangle, not a side accent.

## Do's and Don'ts

### Do:
- **Do** letter panels with bold lowercase a, b, c, d at 22px/800.
- **Do** separate regions with 1px rules: ink above panel d, hairline (#d6dadd) under the toolbar and elsewhere.
- **Do** keep controls as pills: solid ink = single-select chosen or narrowing on; hairline with only its name = a dropdown at rest; ink border with ": value" in 700 = a dropdown that narrows.
- **Do** size dots by capped square-root enrollment and encode unknown and "more than one" by ring shape.
- **Do** fix label and colour problems by shape, weight and position, never by a new hue, fill or chrome.
- **Do** honour both schemes via the `:root` tokens in `plate.css` (`--ink --plate --muted --rule --pale --red`, the mark colours, `--fs-*`); do not hard-code hex or off-scale sizes in components.
- **Do** open every page with one head: title, at most one computed sentence, 24px under the site header, on the 40px (16px phone) edge.
- **Do** keep text at 12px or larger; 11px only for the listed exceptions (family bands, scale axis labels, canvas numerals).

### Don't:
- **Don't** use red (or dark-mode orange) for anything but succeeded data.
- **Don't** add shadows, glows, gradients or card chrome to panels.
- **Don't** reorder the layout into filters-left / canvas-centre / details-right.
- **Don't** read "advanced" as "worked", fade running trials, or hand-write a headline or margin note: the front door's text is computed.
- **Don't** draw the approaches without a target as a graph: a tree, so no connection is implied that does not exist.
- **Don't** hide a panel behind a tab, picker or toggle: the contents strip points at panels, every panel stays on the page and in print.
- **Don't** state a fact twice in a head (a sentence and key numbers saying the same thing), or put a caveat between the title and the data; standing notes and AI labels stay where they are, at full size.
