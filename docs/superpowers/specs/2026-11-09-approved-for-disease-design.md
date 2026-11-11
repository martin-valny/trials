# Approved for this disease (scorecard round 2) — design

Status: for Martin's approval. Implements `2026-11-08-front-door-pipeline-design.md` §13 "Round 2" and replaces `2026-11-06-mechanism-scorecard-design.md` §5.1 `indications.csv` (a pointer is added there as §12). Mockups, real data (snapshot 2026-11-06): `docs/superpowers/mockups/2026-11-09-approvals/marker-options.png` (chosen: C, floor rule) and `panel-e-options.png` (chosen: E1).

## 1. Intent

The reader is a pharma or biotech R&D researcher or manager sizing up MS and autoimmune neurology. For each pipeline row (target class) and each disease (MS, MG, NMOSD, CIDP, MOGAD, AE) they want to know **whether any drug on that target is already approved for that disease**, by any regulator. That separates the settled cells (CD20 in MS) from the open ones (CD20 in MG, still in phase 3), which is the white space a drug-discovery bet looks for. It shows in two places:

1. a small "approved" marker in the **By disease** cells of the pipeline figure;
2. a new target-page **panel e "By disease"**: per disease, how many trials, how far they got, and which drugs are approved, with their sources.

## 2. Goals, non-goals, anti-goals

**Goals**
- G1. Every approved row × disease cell is marked, and every marked cell names its drugs and says where the approval comes from (ChEMBL, an FDA label, or a hand-sourced row with regulator, year and link).
- G2. The data scales to another area (config swap): the hand work per area is reviewing disagreements between sources, not sourcing every approval.
- G3. The daily run never fetches approvals; it reads a committed file. Missing or bad file → the figure and target page render without approvals (R19).

**Non-goals**
- No success rate in panel e (§6.3 explains). It stays on the Approaches page.
- No Open Targets genetics (dropped in front-door §13). No Open Targets link either (my call 7).
- No marker in By phase or By year (By phase already has the "approved use" column).
- No disease subtypes (relapsing vs progressive MS); approval is at disease level.

**Anti-goals** (failure even if it technically works)
- A well-known approval shown as not approved (C5 in MG). An expert stops trusting the whole page.
- An approval inherited from a different modality or an unrelated drug (CD19 CAR-T showing inebilizumab; the cladribine row showing mitoxantrone).
- A number that reads as "approved classes fail" (the success rate, §6.3).

## 3. What the data check found (2026-11-09)

ChEMBL REST, release **ChEMBL_37** (2026-05-01), all 28 rows, script in the session scratch:

- **Disease mapping is clean** on MeSH headings: MS = "Multiple Sclerosis", "Multiple Sclerosis, Chronic Progressive", "Multiple Sclerosis, Relapsing-Remitting"; MG = "Myasthenia Gravis" (not "Lambert-Eaton Myasthenic Syndrome", whose EFO term says myasthenia gravis); NMOSD = "Neuromyelitis Optica"; CIDP = "Polyradiculoneuropathy, Chronic Inflammatory Demyelinating"; AE = MeSH "Autoimmune Diseases of the Nervous System" only when the EFO term is "autoimmune encephalitis" (infectious encephalitis excluded). **MOGAD has no ChEMBL term.** Nothing is approved for MOGAD or AE (satralizumab for MOGAD has an FDA decision due 2027-01-10).
- **ChEMBL misses well-known approvals:** eculizumab, ravulizumab and zilucoplan in MG (max phase 3); eculizumab and ravulizumab in NMOSD (3); efgartigimod in CIDP (2; FDA 2024); nipocalimab in MG (FDA 2025); nabiximols in MS (EU/UK, not in ChEMBL's CB1 set). Eculizumab's MG and NMOSD rows cite only ClinicalTrials.gov.
- **FDA labels (openFDA `drug/label`, `indications_and_usage` text) catch most of those:** eculizumab MG and NMOSD, nipocalimab MG, efgartigimod CIDP. Zilucoplan is not in openFDA. US only.
- **The "same target, same action type" widening misfires** on: cladribine (picks up mitoxantrone, approved in MS), clemastine (every H1 antihistamine), CD19 CAR-T (inherits the CD19 antibodies, so inebilizumab's NMOSD approval). ChEMBL types CAR-T products as `Cell` (tisagenlecleucel) or `Gene` (lisocabtagene maraleucel).
- **Expected result after the fixes** (draft, the builder's script decides): about 19 approved cells. MS 12 (CD20, S1P receptor, α4-integrin, fumarates, DHODH, CD52, interferon-β, cladribine, glucocorticoids, ACTH, fampridine, cannabinoids), MG 2 (FcRn, C5), NMOSD 4 (CD19, IL-6 receptor, C5, CD20 via rituximab in Japan, to confirm), CIDP 1 (FcRn).

## 4. Approaches (data source)

- **A. ChEMBL plus a hand overrides file.** The existing `drugs.csv` + `overrides.csv` pattern. ChEMBL's misses sit exactly in the cells this reader checks first, and every new area needs its misses found by hand.
- **B. Hand-curated `approvals.csv` as the source,** ChEMBL as a cross-check. Every cell has a regulator and year, but in a bigger area (oncology) that is hundreds of hand rows. Martin: doesn't scale.
- **C. Two automatic sources plus a small hand file (chosen).** ChEMBL (max phase for the indication = 4, any regulator) and FDA label indications text. A cell is approved if either says so. A short hand file adds what neither finds (today: zilucoplan, rituximab NMOSD Japan, nabiximols) and can exclude a false hit. The script prints only the doubtful cells for review. Cost: two fetchers instead of one, each with recorded fixtures.

## 5. Data

### 5.1 Area config (`config/area.yaml`)
Each condition gains an optional `approvals` block, so a config swap brings its own vocabulary and no code holds disease names:

```yaml
- label: Myasthenia gravis
  code: MG
  approvals:
    mesh: ["Myasthenia Gravis"]                 # ChEMBL drug_indication.mesh_heading, exact
    efo: []                                     # optional: (mesh, efo_term) pairs needed for AE
    label_terms: ["myasthenia gravis"]          # FDA label indications text, case-insensitive whole phrase
```
AE uses `efo: [["Autoimmune Diseases of the Nervous System", "autoimmune encephalitis"]]` and `label_terms: ["autoimmune encephalitis"]`. MOGAD has no `mesh`, and `label_terms: ["myelin oligodendrocyte glycoprotein antibody", "MOGAD"]`, so a 2027 satralizumab label is picked up on the next run. A condition without an `approvals` block is never approved.

### 5.2 Which drugs count for a row
Seeds: the row's mapped drugs (`drugs.csv` + `overrides.csv`, `mapped`/`manual`, by `classes`) or, for a row defined by `drugs` with no `classes` (cladribine, clemastine), those named drugs only.
- **Class rows:** widen through ChEMBL. For each seed, take its ChEMBL mechanisms (`ChemblClient.mechanisms`, giving target ids and action types) and add every molecule (parent) with a mechanism on the same target id, with the same action type **and** the same modality group **as that seed** (matched per seed as an (action, modality) pair, never as a cross product of all the row's actions and modalities). Modality groups from ChEMBL `molecule_type`: `Antibody`; `Protein`; `Small molecule`; `Cell` and `Gene` together (cell therapy); anything else its own group. This keeps CD19 CAR-T apart from CD19 antibodies.
- **Named-drug rows:** no widening.
- Two rows on the same target (CD19 antibodies, CD19 CAR-T) stay apart through the modality pair; no further disjointness rule.
- New client calls needed: molecules by target (`mechanism?target_chembl_id=`), `drug_indication` by parent molecule, and `molecule` for `molecule_type` (all paged, cached).
- The widening is the scorecard spec's "broad meaning" (any drug sharing the mechanism counts, tracked in a trial or not), kept.

### 5.3 Script `pipeline/scripts/fetch_approvals.py` (hand-run, needs network)
1. Load rows, the mechanism CSVs and the area's `approvals` blocks. Build each row's drug set (§5.2), via the existing `ChemblClient` (cache, retry, `--record` for fixtures).
2. **ChEMBL:** `drug_indication` for each molecule; a hit is `max_phase_for_ind == 4` on a configured MeSH heading (or MeSH + EFO pair). Record the molecule's `withdrawn_flag` (ChEMBL `molecule`).
3. **FDA labels:** for each molecule (ChEMBL pref name and synonyms where needed), openFDA `drug/label` by `openfda.generic_name`; a hit is a configured `label_terms` phrase in `indications_and_usage`. Keep the label `set_id` for a DailyMed link and the matched sentence for the review print. A small `OpenFdaClient` beside `ChemblClient` (same cache, retry and record behaviour).
4. Apply `config/approvals/overrides.csv` (hand: adds and excludes).
5. Write `config/approvals/approvals.csv` and print the review: cells found by **one source only**, cells where **the sources disagree**, every hand row, and every FDA match sentence containing "not indicated" or "limitations of use" near the term. Print counts per disease.

Flags: `--config`, `--out config/approvals`, `--cache`, `--record DIR`. On this Mac, `SSL_CERT_FILE` as for `map_mechanisms.py`.

### 5.4 Files (`config/approvals/`, committed)
- **`approvals.csv`** (generated; do not hand-edit): `row_id,disease,drug,chembl_id,sources,withdrawn,regulator,year,url`. `withdrawn` is `1` when ChEMBL flags the molecule as withdrawn (or a hand row says so), else blank. One line per row × disease × drug. `sources` is `;`-joined from `chembl`, `fda_label`, `hand`. `regulator`, `year` only from hand rows (blank otherwise). `url`: the hand row's `source_url`, else the DailyMed label (`https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=…`), else the ChEMBL compound page.
- **`overrides.csv`** (hand; the script never writes it): `action,row_id,disease,drug,regulator,year,withdrawn,source_url,note`. `action` is `add` or `exclude`; `withdrawn` (`1` or blank) on an `add` row, or on an `add` row naming an automatic drug, marks it withdrawn. `source_url` is required for `add`. Seed rows, each verified before commit: zilucoplan MG (FDA 2023), rituximab NMOSD (PMDA, Japan; confirm year and link, drop if not confirmed), nabiximols MS (MHRA 2010; confirm). Any of these the FDA fetch finds by itself is not added.
- **`README.md`**: what "approved" means here, the sources with release and fetch date (ChEMBL_37; openFDA date), licences (ChEMBL CC BY-SA 3.0; openFDA public domain), how to re-run, how to review the print, and the hand file's rules.

### 5.5 Pipeline
The `pipeline_figure` stage reads `config/approvals/approvals.csv` (path from the area config, default beside the other config dirs) and adds to each row in `pipeline.json`:

```json
"ap": { "MS": [ { "d": "ocrelizumab", "src": ["chembl", "fda_label"], "url": "https://…" } ],   // "wd": true when withdrawn (omitted otherwise)
        "NMOSD": [ { "d": "rituximab", "src": ["hand"], "reg": "PMDA", "y": 2022, "url": "https://…" } ] }
```
Omitted when the row has none (the slimming rule). Rows and diseases not in the figure are ignored; an unknown `row_id` or disease code is a warning `approvals_unknown: …`, not a failure. A missing file → warning `approvals: missing` and no `ap` keys anywhere; a malformed file → `approvals: <file>:<line>: <problem>` and no `ap` keys (R19: the figure still builds). Expected size: about 3 KB on the real data. `scripts/pipeline_report.py` prints approved cells per disease.

The daily workflow does not run the script and makes no network call for approvals.

## 6. What the visitor sees

### 6.1 Pipeline figure, By disease
- **"Approved" means ever approved by any regulator; withdrawn drugs are kept and labelled (Martin, 2026-11-09, option a).** The floor rule marks a cell only when at least one of its approved drugs is not withdrawn; panel e lists every drug, a withdrawn one with a muted "withdrawn" tag.
- **Floor rule (option C):** a cell with a not-withdrawn approved drug gets a 2px ink rule along its bottom edge, inset 6px (3px on the phone strip). `--ink` in both themes. It also shows on an empty cell (an approved cell whose trials are all elsewhere), above the nodot.
- **Key:** By disease only, after the mark styles: a short ink rule, "a drug on this target is approved for this disease".
- **Hover and focus:** the cell's tooltip reads "Approved for {disease}: ocrelizumab, ofatumumab, ublituximab." The same text is in the cell's accessible name (visually hidden), so the information isn't hover-only (spec G7). Phones: tapping the row opens the target page as now, where panel e names the drugs.
- The company lens doesn't dim the rule: approval belongs to the target, not the company.
- Not in By phase or By year.

### 6.2 Target page, panel e "By disease" (option E1)
Placed after panel d. Head: "**e** {Row} by disease", aside "furthest phase reached by trials on the registry · approved for the disease, by any regulator". One line per disease that has a trial in the row or an approval, in `figure_order`:
- **Disease** name (full label).
- **Trials:** count, and "{k} running" in the running colour.
- **Phase ladder:** four segments (Phase 1, Phase 2, Phase 3, Approved use), each with its trial count beneath, filled up to the furthest phase reached (the furthest in ink, earlier ones in the family ink, later ones pale). Phase column per trial is the mark's `c`.
- **Approved for this disease:** each drug (withdrawn ones last, with a muted "withdrawn" tag) with its source in muted small text ("ChEMBL · FDA label", or "PMDA 2022 · hand"), the drug name linking to `url`, the group underlined by the same floor rule as the figure. The floor rule underlines the group only when a drug is not withdrawn. Otherwise "None approved" (muted).
- `?disease=` set: that disease's line is emphasised (ink weight), the others stay.
- No `ap` in the file (R19): the column reads "Approval data not available" once, in the header aside, and each line shows the ladder only.
- Phone (≤ 640px): one block per disease: name with "{n} trials · {k} running" on the right, the ladder, then the approved list.

### 6.3 Why panel e has no success rate
"Advanced, of finished" can't see approval: approved-use trials can never advance, and the phase 3 trials that won approval count as failures because their next step was a regulator, not a trial. On the real data, CD20 in MS reads 6 of 55 (its 26 finished phase 3 trials, which include the trials behind three approvals, score 0) and interferon-β 1 of 69, while BTK, with nothing approved, reads 4 of 17. Restricting to phase 1–2 trials leaves 3 cells with 10 or more finished. Martin chose E1 on 2026-11-09. Methods says this in a sentence.

### 6.4 Methods
A short "Approved for this disease" section: the definition (any drug on the target with the same action and modality, approved for the disease by any regulator), the three sources with release and date, that MOGAD has no ChEMBL term and nothing approved yet, that the figure's "approved use" column is a trial phase and not this, and why panel e shows no success rate. The plain-words test covers the new copy.

## 7. Constraints
- Config swap: no disease names or codes in code; vocabularies come from `area.yaml`.
- Never commit real registry data; `approvals.csv` is reference data like `drugs.csv` and is committed.
- `pipeline.json` stays under the 200 KB gate.
- Design: DESIGN.md's plate (Hanken Grotesk, ink, red only for "advanced"), both themes, 16px gutters on phones, no hover-only information.
- Process: Martin pushes; no Workflow tool; SDD with Sonnet implementers and reviewers, Opus final review.

## 8. My calls (for Martin to check)
1. Modality groups from ChEMBL `molecule_type`, with Cell and Gene together.
2. Rows defined by named drugs are never widened.
3. FDA match is a whole phrase in `indications_and_usage`; negations are printed for review, not parsed.
4. Hand file can also `exclude` a false hit, so a wrong automatic approval has a fix that survives re-runs.
5. Regulator and year shown only for hand rows (ChEMBL and openFDA don't give them reliably); automatic rows show their source and link.
6. Panel e goes after d, keeping the letters in order.
7. No "View on Open Targets" link (front-door §13 allowed one; it would point at the dropped genetics).
8. Under `?disease=`, panel e emphasises that disease rather than hiding the others.
9. The floor rule also shows on an empty cell when there is an approval.

## 9. Testing
- Script: ChEMBL and openFDA recorded fixtures (`--record`); unit tests for the withdrawn flag (ChEMBL and hand),  disease matching (MeSH, MeSH + EFO, LEMS excluded, infectious encephalitis excluded), widening (modality groups, named-drug rows), FDA phrase match, overrides add and exclude, output columns and order (deterministic), the review print.
- Pipeline: `ap` join, omitted when empty, unknown row or disease warning, missing and malformed file (R19), size; `pipeline_report.py` line.
- Web (`lib/pipeline.ts` and components): floor rule only in By disease, on empty cells too, accessible name and tooltip text, lens doesn't dim it; panel e lines, ladder fill, counts, approved list and links, "None approved", no-`ap` fallback, `?disease=` emphasis, phone layout. Fixture `pipeline.json` gains `ap` for two rows.
- E2E: By disease shows a rule on a fixture cell; target page shows panel e with a drug link.
- Network: the controller (the orchestrating session) records fixtures and runs the real fetch, with `SSL_CERT_FILE` as for `map_mechanisms.py`; implementers build against recorded fixtures. The §3 cell list is a guide, not a gate: differences are reviewed with Martin before `approvals.csv` is committed.
- Real-data check: run the script, review its print with Martin's eye on the hand rows, rebuild, screenshots at 1280 and 375, light and dark (By disease, panel e for CD20, FcRn, C5, BTK).

## 10. Left to the builder
- `OpenFdaClient` details (search syntax, synonyms when the generic name misses, paging).
- Exact cell markup for the rule and tooltip, within the existing figure components.
- Where the approvals path lives in the area config.
