---
name: Trial Radar
description: "The Figure Plate: the Explore route set as Figure 1 of a paper, a white plate with live panels a-d."
colors:
  plate: "#ffffff"
  ink: "#111111"
  muted: "#5b6268"
  rule: "#d6dadd"
  pale: "#e4e8eb"
  rubric-red: "#c8102e"
  slate: "#3b4a57"
  slate-mid: "#7d8a95"
  slate-ring: "#8796a3"
  slate-light: "#8592a0"
  dark-plate: "#17191c"
  dark-ink: "#eceae4"
  dark-muted: "#9b9d9f"
  dark-rule: "#34373c"
  dark-pale: "#2b2e33"
  slide-orange: "#ff8a3d"
typography:
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
    fontSize: "12.5px"
    fontWeight: 400
  canvas-label:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "11.5px"
    fontWeight: 600
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
  pill-filter-on:
    backgroundColor: "{colors.plate}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "4px 10px"
  pill-filter-off:
    backgroundColor: "{colors.plate}"
    textColor: "{colors.muted}"
    rounded: "{rounded.pill}"
    padding: "4px 10px"
  find-input:
    backgroundColor: "{colors.plate}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "4px 12px"
---

# Design System: Trial Radar

## Scope (read first)

The Figure Plate governs the **Explore route only** (`web/src/components/explore/*`, tokens in `explore.css` and `web/src/lib/explorer.ts`). Changes, Trials and Methods still use the older plain styles in `web/src/styles.css` (system 16px/1.5 body, `.badge`, tables, `.filters`). A broader restyle is a follow-up. While Explore is mounted, `:root:has(.explore)` re-points the shared header's tokens (`--bg --fg --muted --line --accent --ok`) to the plate palette, so the shared top bar matches there; on other routes it does not. New work outside Explore should not assume this system has been applied to it.

## Overview

**Creative North Star: "The Figure Plate"**

The page is Figure 1 of the paper you would write about the trial landscape: a white plate with lettered panels a to d, live. It is flat, ruled and typographic: hairlines and bold lowercase panel letters do the structuring work that cards, shadows and tinted panels do elsewhere. One rubric red is reserved for the single claim being tested, that a trial succeeded. In the OS dark scheme the same plate becomes a "Dark slide": warm near-black ground, off-white ink, orange in red's place.

It refuses the category default of a three-pane analytics tool (filters left, canvas centre, details right) and the glowing dark "AI dashboard". The figure title is set as a claim ("Figure 1 |" bold, then regular). Density is high but quiet: small type (12 to 14px), tabular numerals, no ornament.

**Key Characteristics:**
- White plate, near-black ink, hairline rules; flat, no shadows.
- Red (orange in dark) means "succeeded" and nothing else.
- Bold lowercase panel letters a, b, c, d (22px/800) anchor each panel.
- Hanken Grotesk only, self-hosted (400, 500, 700, 800).
- Pills for every control; the canvas is the hero and auto-rotates slowly.

## Colors

Monochrome ink on white with blue-grey supporting values and a single red.

### Primary
- **Rubric Red** (#c8102e, `--red`): data marks for "succeeded" only: canvas dots (opaque emphasis pass), the succeeded segment of panel c's phase columns, and the inline swatch in the caption. Dark mode: **Slide Orange** (#ff8a3d) fills the same `--red` token.

### Neutral
- **Plate White** (#fff, `--plate`) / dark **Slide Ground** (#17191c): page and control ground.
- **Ink** (#111, `--ink`) / dark (#eceae4): text, bars, rules above the legend, selected pills, focus rings, links, stopped trials, Phase 4.
- **Muted Slate** (#5b6268, `--muted`) / dark (#9b9d9f): secondary text, off pills, placeholder, pill borders at rest.
- **Hairline** (#d6dadd, `--rule`) / dark (#34373c): off-pill borders, sticky panel d top border on phone.
- **Pale** (#e4e8eb, `--pale`) / dark (#2b2e33): bar tracks, skeletons, unknown/early phase fill.
- **Blue-grey ramp** (light): #3b4a57 (Phase 3), #7d8a95 (completed, outcome unknown), #8796a3 (Phase 2, unknown-outcome ring), #8592a0 (running, 3.2:1 on white), #c9d1d7 (Phase 1). Dark ramp: #7fb2e5 Phase 3, #6c7f93 Phase 2, #3d4147 Phase 1, #7d8287 completed/unknown, #5f666e running.
- **Disease series** (Disease colour mode, assigned by condition order, cycling): light #111, #7a5c2e, #5f8a7a, #3b6ea5, #7aa6c2, #8a8f94; dark #eceae4, #c8a96a, #7fb2e5, #e5c07b, #8fc29a, #7d8287.
- Selection ring on the canvas uses ink (the stopped colour), never red.

### Named Rules
**The Only-Succeeded Rule.** Red is used only for succeeded data. Never for focus rings (ink, 2px, 2px offset), ticks, links, selection, errors or category colours.
**The Shape-Not-Shade Rule.** "Unknown outcome" is a hollow 1px ring, distinguished from filled dots by shape, so greys stay legible.

## Typography

**Font:** Hanken Grotesk (self-hosted via @fontsource, weights 400/500/700/800), fallback `system-ui, sans-serif`.

**Character:** One family; hierarchy comes from weight (500 vs 800) and size, not from a second face.

### Hierarchy
- **Plate title** (500, clamp(20px, 2vw, 28px), 1.2, -0.005em): "Figure 1 |" in 800 then the claim in 500; max 70ch, balanced wrap.
- **Panel letter** (800, 22px, 1): lowercase a-d, 10px right margin, sits left of the panel heading.
- **Panel heading** (700, 13px, 1.3).
- **Claim** (500, 14px, 1.45, ink, max 52ch): the one-sentence answer in panel b.
- **Body / legend / bars** (400, 13px, 1.5): legend keys at 700 in ink; values muted.
- **Note** (400, 12px, 1.45, muted, max 52ch); phase labels 12px (11px on phone).
- **Pill** (400, 12.5px). **Canvas cluster label** (600, 11.5px, ink on a plate-coloured 2px halo).
- Numerals are tabular wherever counts sit in columns (bars, pill counts, "Showing N of M").

### Named Rules
**The Lowercase Letter Rule.** Panels are labelled with bold lowercase letters only; no uppercase tracked labels above panels.

## Layout

A column filling the viewport: slim shared header, title, plate, ink rule, legend. The plate is a 2fr/1fr grid with two equal rows and a 36px column gap; 40px side gutters. Panel a (canvas) spans both rows on the left (min-height 62vh); panel b (success by disease: bars, average tick, lift sentence) is top right; panel c (trials by phase, columns, red = moved on) is bottom right. Below the plate a full-width 1px ink rule opens the legend: a two-column key/value grid (6.5rem key column, 18px gap) holding panel d (selected trial line and summary), then Colour, Show, phase/outcome/type pills, Find a trial, and "Showing N of M trials".

Bars: grid of label (6 to 10.5rem), 12px track, count, share; the average is a 2px ink tick with a 1px plate knockout; a bar with too few finished trials is an outline, not solid.

Responsive:
- **<= 900px:** single column; panel a min-height 60vh; once a trial is selected, panel d sticks to the bottom of the viewport (plate ground, 1px hairline top border) while the page scrolls.
- **<= 640px:** gutters 16px; panel a is a square (aspect-ratio 1/1); the legend collapses to one column; flow columns tighten.

## Elevation & Depth

Flat. No shadows, no blur, no tonal layers. Depth comes from the canvas's perspective (dot size and alpha scale with depth) and from hairline and ink rules. The only box-shadow is a zero-offset 1px plate-coloured knockout around the average tick. The canvas separates overlapping marks with a 1px plate-coloured ring on emphasised dots.

## Shapes

Rules are 1px square lines; bars and tracks are square-ended rectangles. Every control is a full pill (999px). Dots, swatches (9px, 1px border) and rings are circles.

**Canvas dot encoding** (`PlateCanvas.tsx`):
- Position: placed only by what trials study; centred on centroid and scaled so the 98th-percentile trial sits on the unit circle, computed over all trials so filtering never moves the cloud.
- Radius (CSS px): (1.6 + sqrt(min(enrollment, e98)) / 7) x k x perspective, where e98 is the 98th-percentile enrollment (the cap) and k = clamp(sqrt(600 / count), 0.75, 1) is the crowding scale.
- Alpha: visible dots 0.8 to 0.9 by depth; filtered-out dots 0.08.
- Emphasis pass (Outcome mode): succeeded trials are redrawn on top, opaque, radius at least 3px, with a 1px plate knockout ring.
- Unknown outcome: hollow 1px ring (Outcome mode).
- Selected: 1.5px ring 4px outside the dot, in ink. Cluster labels sit beside each condition's densest trial with a 1px ink leader.

## Components

### Pills
Single family, `border-radius: 999px`, `padding: 4px 10px`, 12.5px, 1px border.
- **Segmented (Colour: Outcome | Phase | Disease, single-select):** rest = plate ground, muted border, ink text; pressed = solid ink fill, plate text.
- **Filter pills (Show, phase, outcome, type; multi-select):** on = plate ground, 1px ink outline, ink text; off = muted text, hairline border, `line-through`, swatch at 35% opacity. Each carries a 9px swatch (ring for unknown) and a tabular count.
- **Hover:** border goes to ink. **Focus-visible:** 2px ink outline, 2px offset.

### Find a trial
Search input, pill-shaped, 13px, 4px 12px padding, muted border, width up to 22rem.

### Panel d (selected trial)
Under the ink rule, left key "d". Empty state is muted. Selected: bold-800 facts line, two-sentence summary, source label, links (ink, muted underline darkening on hover, 3px offset). Sticky on phone (see Layout).

### Loading and empty
Skeleton in plate shape using Pale blocks; opacity pulse 1 to 0.55 over 1.6s only under `prefers-reduced-motion: no-preference`. Empty canvas shows a bold centred message and a button.

### Motion
The canvas auto-rotates slowly (0.0022 rad per frame, tilt 0.32); dragging rotates (0.008 rad per px); click (under 4px travel) selects. Under `prefers-reduced-motion: reduce` there is no auto-rotation and the canvas redraws only on change.

## Do's and Don'ts

### Do:
- **Do** letter panels with bold lowercase a, b, c, d at 22px/800.
- **Do** separate regions with 1px rules: ink above the legend, hairline (#d6dadd) elsewhere.
- **Do** keep controls as pills: solid ink = single-select chosen; ink outline = multi-select on; muted, hairline, struck-through = off.
- **Do** size dots by capped square-root enrollment and encode unknown by ring shape.
- **Do** honour both schemes via tokens (`--ink --plate --muted --rule --pale --red`); do not hard-code hex in components.

### Don't:
- **Don't** use red (or dark-mode orange) for anything but succeeded data.
- **Don't** add shadows, glows, gradients or card chrome to panels.
- **Don't** reorder the layout into filters-left / canvas-centre / details-right.
- **Don't** claim the rest of the site follows this system; Changes, Trials and Methods do not yet.
