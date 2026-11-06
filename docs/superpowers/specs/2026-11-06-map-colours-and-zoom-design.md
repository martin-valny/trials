# Map colours (editorial journal) and zoom — short design

Status: approved by Martin · 2026-11-06. Small change on `feat/explorer-figure-plate`.

**Why:** the map's light-theme colours were never tuned: the disease hues are dark and desaturated, and "completed" and "running" are near-identical greys. Martin saw options A–H on real data and chose **C · Editorial journal**, which fits the "Figure 1 of a paper" direction. He also wants to zoom into the UMAP.

**Approaches considered:** the current palette (A), clear categorical/Okabe–Ito (B), editorial journal (C, **chosen**), quiet majority (D), and four techy/AI palettes (E–H; rejected: "don't like much any").

## Colours
- Light disease series by condition: MS `#3c5488`, NMOSD `#00a087`, MOGAD `#8e5ea2`, Myasthenia gravis `#4dbbd5`, CIDP `#e0a030`, Autoimmune encephalitis `#7e6148`.
  - This replaces the quiet-dominant grey rule from the phase-1 finish review: MS is navy now.
  - Minority conditions are still drawn in a pass on top, so small diseases stay visible.
- Light outcomes: succeeded `#c8102e` (unchanged, red stays reserved), stopped `#222222`, completed-unknown `#c9d1d8`, running `#3c5488`. The unknown-outcome ring stays a mid grey distinct from completed.
- Dark ("Dark slide") outcomes: succeeded stays `#ff8a3d`. Builder tunes the rest by eye on real-data screenshots.
- Dark disease series: brighter versions of the same hues, e.g. MS `#8da3d6`, NMOSD `#3cc7a8`, MOGAD `#c49ad6`, MG `#7fd3e6`, CIDP `#f0c060`, AE `#b8977a`. Builder tunes by eye.
- Swatches in the colour key, the dropdowns and the hover card follow automatically. `DESIGN.md` and `.impeccable/design.json` get the new series.

## Zoom
- Wheel or pinch zooms centred on the pointer, from 1× to 8×. When zoomed, drag pans; Shift-drag (or a two-finger rotate gesture where available) turns the map. At 1× drag turns, as today.
- Dots, rings, labels and leaders keep their on-screen size as you zoom, so dense clusters separate.
- Hover, click and hit-testing work at every zoom.
- A "Reset view" text button appears once zoomed, next to Play. It is keyboard-reachable and in the same Figure Plate style.
- `+` and `-` keys zoom when the canvas has focus; `0` resets.
- Zoom is not persisted: reload or theme change returns to 1×. Reduced motion has no effect on zoom (zoom is not motion).
- Page scroll is never hijacked at 1× without intent: the wheel zooms only while the pointer is over the canvas. Accepted trade-off: the panel must not scroll the page while the pointer is over the map.
