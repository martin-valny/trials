# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Primary: a hiring panel reviewing this project as a showcase for a Forward Deployed Engineer role (AI prototyping, life sciences). They give it a few minutes, so the first view has to impress and clicking around has to show real depth. Secondary: clinical-operations and competitive-intelligence leads who track competitor trials in one therapeutic area and ask "what changed, and does it matter?". Tertiary: researchers asking which kinds of trials tend to succeed.

## Product Purpose
Trial Radar tracks every ClinicalTrials.gov interventional trial in one therapeutic area (default: neuroimmunology), detects field-level changes between daily snapshots, flags notable ones, and publishes a static site. The next surface puts the whole set of trials in one explorable space, laid out by what each trial studies, so outcomes such as phase, completion and later drug progress can be overlaid to see whether success clusters. Success means a visitor understands the landscape in one view and can test a hypothesis in a few clicks.

## Positioning
Built from a real, deployed, daily-updating pipeline over public registry data, with honest labelling: outcome labels are kept out of the layout and only overlaid, every proxy for "success" is named for what it is, and features that do not exist yet are called "coming next".

## Operating Context
A static site on GitHub Pages, rebuilt daily by GitHub Actions. Visitors arrive from a link (a CV or application, or a colleague) on desktop more often than mobile, but the site must work at 375px.

## Capabilities and Constraints
- $0 running cost, no server, no secrets, no user accounts, public data only.
- A new therapeutic area is a config change only; no source file names a condition.
- Routes (the nav, in order): Pipeline (`/`, the front door: a pipeline figure whose rows open target pages), Diligence (`/diligence`, second in the nav, only once the agent is open), Watchlist, Approaches, Changes (1/7/30-day feed), Trials (searchable list, 50 at a time), Methods; plus target pages and trial pages. Explore (`/explore`, the similarity map) is linked only from Methods. Every route shares one design (the Figure Plate, DESIGN.md).
- Stack: Vite + React 19 + TypeScript, HashRouter.
- Registry facts available: conditions, interventions (type, name), phases, status, why stopped, enrollment, sponsor, countries, outcomes, dates. Brief summary, sex and age eligibility are cheap to add. Race/ethnicity is not in the protocol and is out of scope.
- "Success" has no registry field. Proxies: completed vs stopped early (all trials), the drug progressing to a later phase or approval (needs drug mapping), and primary endpoint met where results are posted (a minority).
- Molecular pathway views depend on drug → target → pathway enrichment that does not exist yet.
- Stop-risk model (shipped): each running drug or biologic trial in Phase 1 to 3 gets an estimated chance of stopping early, with a range, the typical rate for its phase and up to three plain-words factors, on target pages, trial pages and a Watchlist route; accuracy is published on Methods (held-out AUC 0.682, in-area sample too small to judge). Trained by hand and committed under `config/risk/`; the daily run only scores. A per-trial switch in `config/area.yaml` can reduce it to target-level summaries. Wording rules: "estimated chance of stopping early", never "risk of failure"; the typical rate always beside the number; the standing note on every surface.
- Diligence agent (built, optional backend): an AI agent drafts a cited memo from public sources, then a checker removes what the sources do not support; judgement shown only when at least two of its reasons are verified (a failed reason is dropped and lowers the confidence one level). Always labelled AI-written, "not investment advice"; a draft for a person to verify. Three entry points once the agent is open: a band on the front door above the figure (pick a recorded target and open its memo; on a phone one link to the page), a Diligence page (`/diligence`, second in the nav: how it works, the recorded memos with the agent's read, how well it does), and the target page, where diligence is panel a. A one-line strip in every target-page header says what the agent concluded or that no memo is recorded. **Release gate:** nothing shows while no memo is recorded and no backend is set (the site is exactly as before and `/diligence` goes to Methods); recorded memos open it; setting the `DILIGENCE_URL` repo variable at build time makes it live (any target, Run button on target pages). Costs and daily caps are bounded and stated on Methods; recorded runs and evaluation numbers are published only once recorded.

## Brand Commitments
None yet. The user asked to avoid the glowing black-and-neon "AI dashboard" look.

## Evidence on Hand
Live data on the `data` branch (Parquet), web fixtures in `web/tests/fixtures/data/`. No testimonials, users or adoption figures exist; never invent them.

## Product Principles
1. Honest over impressive: name proxies, label AI-generated or synthetic content, never claim unbuilt features.
2. Outcomes are overlays, never inputs to the layout.
3. Show the real data at work in the first view.
4. Every view links back to the source record on ClinicalTrials.gov.
5. A prediction is shown with its typical rate, its range and its measured accuracy, and says it is often wrong.

## Accessibility & Inclusion
Colour is never the only carrier of meaning (status and outcome always also as text or shape); keyboard-reachable controls; light and dark themes; reduced-motion users get a still layout.
