# Trial Radar — research notes: ways to get unique insight out of the data

Status: brainstorming input, not a design. 2026-11-06. Three research passes (analogues from other fields, joinable data, methods). Citations marked [unverified] were not checked by search.

## The asset that matters
Almost every idea that came back as *new* rests on one thing most people don't use: the **edit history of each trial record** (what changed, when, how often, in which direction). Diffing alone exists (COMPare, a commercial protocol-diff scraper); using the edits as **signals** mostly does not.

Caveat: our own daily snapshots start 2026-11-05, so history-based methods need CT.gov's per-record version history (the "History of Changes" behind each record; the access path needs checking, it is not in the documented v2 API). And neuroimmunology alone is small (pool 478, 66 successes): predictive models should train on a wider CT.gov slice and be *applied* to neuroimmunology.

## Ideas grouped by the decision they serve

### A. "Is this trial quietly in trouble?" (competitive intelligence, clinical ops)
- **Text-drift signal** — finance, Lazy Prices (Cohen, Malloy & Nguyen, J Finance 2020): firms that rewrite filings underperform, nobody notices on the day. → similarity between consecutive versions of eligibility/outcome/summary text; test whether rewriting predicts termination / no results. No prior CT.gov work found.
- **Zombie trials** — ecology, extinction from sighting records (Solow 1993, R `EDE`). → each record update is a sighting; flag "Recruiting" trials whose silence is improbable given their own update rate.
- **Fat-tailed slips** — megaprojects (Flyvbjerg et al. 2022): overruns are power-law. → reference-class forecast of true completion date by phase, sponsor type, slips so far.
- **Indecision** — Wikipedia revert wars (Yasseri 2012) [unverified]. → fields that flip back and forth (enrollment up/down/up) vs one-way slips.
- **Bad news on Fridays** — DellaVigna & Pollet 2009. → do terminations/endpoint downgrades cluster before weekends, holidays, ECTRIMS/AAN? Cheap; no prior work found.
- **Competing-risks hazard** with time-varying covariates from the edit log (Fine & Gray 1999; lifelines) + **conformal intervals** (Candès, Lei & Ren 2023) for honest per-trial bounds.
- **Fate probabilities** — single-cell CellRank 2 (Weiler 2024) on *observed* version-to-version transitions: absorption into terminated / completed / results-posted. Real velocity, not inferred.

### B. "Which mechanism, in which disease, is worth betting on?" (translational / portfolio scientist)
- **Genetic support × trouble** — Minikel et al., Nature 2024 (genetically supported mechanisms ~2.6x more likely to succeed). Join Open Targets (CC0) on target. New angle: does lack of genetic support show up early as operational turbulence (slips, cuts, endpoint edits), not only as eventual failure?
- **Where on the map do failures concentrate** — single-cell Milo differential abundance (Dann 2022) on the trial kNN graph: statistically defined "graveyard" and "sweet-spot" neighbourhoods, with sponsor/era as covariates.
- **Mechanism spillover across diseases** — scientometrics "sleeping beauties" (Ke 2015) [unverified] + knowledge-graph link prediction (TxGNN 2024, PyKEEN), validated on a time split: which MS mechanisms are next to move into MG / NMOSD / MOGAD / CIDP, and how long that took historically.
- **Competitor contagion** — Krieger, Mgmt Sci 2021: firms terminate ~2x more after a same-mechanism competitor fails (project level). Trial level with Hawkes processes (Crane & Sornette 2008 for shock vs endogenous bursts) would be new.
- **Novelty × influence** — patents (Kelly et al. 2021): breakthrough = unlike the past, like the future. → find template-setting trials (first use of an endpoint or design), not just successful ones. Molecular novelty via Krieger, Li & Papanikolaou 2022.
- **Target biology** — CELLxGENE Census (CC BY 4.0): which cell types express the target in MS tissue/CSF; do CNS-resident-cell targets behave differently in progressive MS? (Your home turf.)

### C. "How should I design my trial?" (clinical development scientist)
- **Protocol genealogy** — legislative text reuse (Wilkerson et al., AJPS 2015). → align eligibility text across trials: who copies whose criteria; do inherited templates recruit/finish better?
- **Design programs** — cNMF (Kotliar 2019) over eligibility/endpoint terms + design features: additive "programs" with usage per trial, tracked over time and against termination.
- **Safety-signal response time** — openFDA FAERS / label changes (CC0) × edit log: days from a safety signal to eligibility changes in same-mechanism trials. Only possible with field-level diffs.
- **Site competition** — Milo/Hawkes on a site co-occurrence graph: are too many same-mechanism trials competing for the same centres? Plus species-distribution models (MaxEnt) for "suitable but unoccupied" geography.
- **Shocks as natural experiments** — COVID stringency (OxCGRT, CC BY) and conflict events (UCDP) × site countries × slips.
- **Enrollment truck factor** — OSS (Avelino 2019): how few sites carry the trial; detect sponsor changes (asset sold) and their outcomes.

### D. "Is the registry telling the whole story?" (meta-science; also fixes our own success proxy)
- **Imperfect detection** — ecology occupancy models (MacKenzie 2002) / positive-unlabeled learning (Elkan & Noto 2008): "results posted" is an imperfect detection of "finished well". Main bias in the current success proxy.
- **Dark trials** — maritime "dark vessels" (Paolo et al., Nature 2024). → programmes visible in EU CTIS/EudraCT, ChiCTR (via WHO ICTRP, non-commercial terms), ChEMBL clinical-phase drugs or sponsor filings but absent or silent on CT.gov.
- **Disclosure lag** — SEC EDGAR 8-K text × registry timestamps: what investors hear vs what the registry says, and "business reasons" terminations vs cash-runway disclosures.
- **Publication timing** — Europe PMC/PubMed NCT links: was a primary-endpoint edit made before or after the first paper?

## Already done (cite, don't claim)
Outcome switching from version histories (COMPare; Mathieu 2009; oncology phase 3 PMC10193180), termination prediction from registration fields (Elkin & Zhu 2021, AUC 0.73; HINT), results-reporting compliance (FDAAA TrialsTracker), registry status lag (PMC5652524), competitor-failure learning at project level (Krieger 2021), completion delay rates (ESMO Asia 2023 abstract), protocol diffing as a product.

## Licence notes
Fine to publish: Open Targets, openFDA, OpenAlex (CC0); CELLxGENE, PatentsView, OxCGRT (CC BY); NIH RePORTER, SEC EDGAR, FDA (public domain). Derived numbers only: WHO ICTRP, GBD. Avoid: Google Trends (alpha API), Reddit, redistributing stock prices. Check: Retraction Watch, UCDP, Human Protein Atlas (CC BY-SA).
