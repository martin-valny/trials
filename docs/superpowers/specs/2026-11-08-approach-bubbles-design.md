# Approach bubbles: a home for every treatment, molecular or not — design

Status: approved by Martin · 2026-11-08 (he handed execution over to run unattended). Amends `2026-11-06-mechanisms-and-graph-design.md` §6–7 (phase 3, the `/mechanisms` page). Builds on phase 2 (branch `feat/explorer-figure-plate`, unpushed) and the mapping-gaps research (`docs/superpowers/research/2026-11-07-mapping-gaps-report.md`). Visual rules: `DESIGN.md`.

## 1. Intent

The mechanism work assumed every treatment has a molecular mechanism. Many don't: aHSCT, mesenchymal stem cells, IVIG/SCIG, plasma exchange, ATG, vaccines, peptide tolerisation, glatiramer, and every non-drug trial (rehab, devices, diet, behavioural). These are about 1,670 of the 2,986 trials. Today they either fall out silently ("unmapped") or get squeezed into `mechanism_class` as placeholder labels ("mesenchymal stem cells"). That puts a cell product in the same list as "BTK inhibitor", and Martin found this confusing.

Martin's decisions (2026-11-08):
- These treatments **cannot go into the molecular mechanism graph**, but they must be **logged and visible**.
- A **two-layer view**. The first layer is a few high-level "approach" bubbles. Clicking a bubble opens its second layer. The targeted-drug bubble opens into the planned drug → target → pathway graph. The others open into a simpler structure.
- **Every trial with a molecular mechanism belongs to the Targeted drugs bubble.**
- **Non-drug trials are included**, at a high level.
- How trials are sorted: **approach A** (below).
- Page layout: **rail + canvas** (below).

The question behind it, for the visitor: *across these diseases, which kinds of treatment are being tried, and how do they fare?* The molecular graph answers this for drugs. The other bubbles answer it, more coarsely, for everything else.

## 2. Precedent (research, 2026-11-08)

- **Two separate axes are the norm.** One says what the product is (ClinicalTrials.gov intervention type, ChEMBL `molecule_type`, the EMA advanced-therapy categories, commercial pipeline databases' "origin" field). The other says the mechanism.
- **"No target" is recorded, not left blank.** ChEMBL stores glatiramer as mechanism "Unknown" with no target, and IVIG as "Replacement therapy, immunomodulatory effects" with no target. ATC uses "Other" bins.
- **Target graphs exclude these products.** Open Targets drops vaccines, blood products and cell therapies from its target layer (platform-docs.opentargets.org/drug).
- **System-level grouping exists.** Examples are the MeSH Therapeutics tree E02 (Cell- and Tissue-Based Therapy, Plasmapheresis, Rehabilitation, Nutrition Therapy; public domain) and, in MS, Sorensen & Sellebjerg 2019 (pulsed immune reconstitution vs continuous maintenance; PMC6440030).
- Avoided: KEGG (licence), commercial schemas (proprietary), ATC beyond labels (WHO reuse limits).

## 3. Goals, non-goals, anti-goals

**Goals**
1. Every trial lands in at least one approach bubble, or visibly in **Unclassified**.
2. The Targeted drugs bubble is exactly the trials with at least one experimental drug that has a molecular mechanism. It opens into the phase 3 graph.
3. Each other bubble opens into a tree: approach → group → kind → trials. Each kind carries a one-line *proposed* rationale with a citation.
4. The `mechanism` field, colour mode, filter, panel b "By mechanism" and the layout feature carry only molecular mechanisms. No-target kinds move to their own field.
5. The hand work stays small: one row per kind, not per drug name. The molecular rule is enforced in code.

**Non-goals**
- A mechanism for the treatments without a target. The rationale line is labelled "proposed", is never drawn as a molecular edge, and is never fed into the pathway graph.
- Fine-grained classification of non-drug trials beyond group → kind (for example, exercise dose or device brand).
- The "pulsed reset vs continuous" tag (Sorensen & Sellebjerg). It cuts across bubbles, including molecular ones (alemtuzumab, cladribine, aHSCT). It is a good later addition, as a highlight across bubbles (§9).
- Changing the success definition (R21) or the pool (R18).

**Anti-goals**
- A trial disappears from the figure without a trace.
- A treatment without a target shown as if it had a molecular mechanism (a target node, a pathway edge, or a mechanism colour).
- A "success rate" for a group where success is undefined (non-drug trials, see §6.3).
- Per-name hand classification that drifts out of step with the drug mapping.

## 4. Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **A (chosen)** | Code puts every drug with a molecular mechanism in Targeted drugs. Drugs without one carry a *kind* defined once in `config/approaches/kinds.csv` (about 25–30 rows). Non-drug interventions are sorted by ClinicalTrials.gov intervention type plus a reviewed keyword table. Leftovers go to a visible Unclassified bubble. | Small hand work; the rule cannot drift; the current mix-up goes away. Needs a new loader and a new per-trial field. |
| B | An `approach` column on every row of `drugs.csv` / `overrides.csv`. | Easy to read, but about 900 rows kept by hand, and nothing stops a targeted drug landing in the wrong bubble. |
| C | One-off bulk classification of every intervention name (by an agent), then review. | Fast to start; breaks the "nothing guessed" rule unless every row is reviewed, and the review grows with each snapshot. |

Page layout options (shown as mockups; Martin chose **3**):
1. Expand in place: one canvas, and the clicked bubble grows. Rejected: hardest to build, cramped on a phone.
2. Overview, then a separate view per bubble with a breadcrumb. Rejected: you lose the side-by-side comparison inside a bubble.
3. **Rail + canvas (chosen):** the approaches sit in a column like a figure legend; the canvas shows the selected one.

## 5. The approach vocabulary

Seven approaches. Keys are stable; labels can be reworded.

| key | label | what goes in | second layer (groups → example kinds) |
|---|---|---|---|
| `targeted` | Targeted drugs | any experimental drug with a molecular mechanism (ChEMBL / GtoPdb / a manual molecular row), including CAR-T, anti-FcRn, cladribine (DNA) and cemdisiran (C5 mRNA) | the phase 3 graph: drug → target → pathway |
| `cell` | Cell & transplant | aHSCT, MSC, tolerogenic DCs, T-cell vaccination, EBV-specific T cells, NK cells, neural stem cells | Haematopoietic reset → aHSCT · Mesenchymal cells → MSC (bone marrow / adipose / cord), MSC-NTF · Immune cells → tolerogenic DCs, T-cell vaccination, virus-specific T cells, NK · Neural cells |
| `plasma` | Antibody & plasma | IVIG, SCIG, plasma exchange, immunoadsorption, ATG (polyclonal) | Immunoglobulin replacement → IVIG, SCIG · Removal → plasma exchange, immunoadsorption · Polyclonal depletion → ATG |
| `tolerisation` | Tolerisation | myelin / AChR peptides, T-cell receptor peptides, helminths (vaccines are `not_a_drug`, §9) | Antigen-specific tolerisation → myelin peptides, AChR peptides · Microbial → helminth therapy |
| `diffuse` | Broad immunomodulators | products with a stated effect but no defined target: glatiramer, high-dose biotin, lipoic acid, gold nanocrystals | one group per product family |
| `nondrug` | Non-drug care | experimental-arm interventions of type Behavioural, Device, Procedure, Dietary Supplement (without a molecular mechanism), Radiation | Rehabilitation & exercise · Behavioural & psychological · Devices & neuromodulation (TMS, tDCS, wearables) · Diet & supplements · Procedures · Other non-drug |
| `unclassified` | Unclassified | trials that land in no other bubble | Not a treatment (diagnostic, sampling, imaging) · Not yet sorted (unmapped names, arm placeholders) |

Notes:
- A Dietary Supplement with a molecular mechanism goes to Targeted, because Martin's rule wins (vitamin D → VDR).
- Plasma exchange, aHSCT and other procedures go to their own bubble by keyword, whatever their ClinicalTrials.gov type. Type is only the fallback.
- Arrived-at numbers are not in this spec. The first build prints the counts per approach and group (§7.4).

## 6. Data and rules

### 6.1 Files (`config/approaches/`, committed, hand-written)
- **`kinds.csv`**: `kind, approach, group, label, rationale, source_url`. One row per kind without a target (`mesenchymal_stem_cells, cell, Mesenchymal cells, Mesenchymal stem cells, "Proposed paracrine immunomodulation; no single molecular target", https://…`). `rationale` is one short sentence, shown with the word "proposed". `source_url` is required (MeSH, NCIt, a review, or a label).
- **`nondrug_rules.csv`**: `pattern, types, kind`. `pattern` is a casefolded whole-word phrase matched against the cleaned intervention name and its description's first sentence. `types` is an optional `;`-list of ClinicalTrials.gov intervention types the rule applies to; empty means any. `kind` must exist in `kinds.csv`. A non-drug intervention takes every kind whose rule matches.
- **`type_fallback`** (in `kinds.csv`, rows with approach `nondrug` or `unclassified` whose kind key is `type:<TYPE>`): the kind for an intervention that nothing else sorted, by ClinicalTrials.gov type:

  | type | fallback |
  |---|---|
  | BEHAVIORAL | Non-drug care › Behavioural & psychological › other behavioural |
  | DEVICE | Non-drug care › Devices & neuromodulation › other device |
  | PROCEDURE | Non-drug care › Procedures › other procedure |
  | RADIATION | Non-drug care › Procedures › radiation |
  | DIETARY_SUPPLEMENT (no row in the drug mapping, or `unmapped`) | Non-drug care › Diet & supplements › other supplement |
  | DIAGNOSTIC_TEST | Unclassified › Not a treatment |
  | OTHER, GENETIC, COMBINATION_PRODUCT, DRUG, BIOLOGICAL | Unclassified › Not yet sorted (OTHER is the registry's catch-all, "standard care", questionnaires and samples among it; guessing a bubble for it would hide the backlog) |
- README in the folder: what each file is, who edits it, the MeSH/NCIt sources used for rationales and their licences.

### 6.2 How a drug row gets its approach (code)
- **Which names are looked up in the drug mapping:** Drug and Biological (as today), plus **Dietary Supplement, Genetic and Combination Product**. `map_mechanisms.py` takes these types as input too, so vitamin D (VDR) and a gene therapy get mechanism rows. These extra names enter `mechanisms`, `targets`, the Targeted bubble and the graph. They do **not** enter `experimental_drugs`, the R18 pool, R21 success or the `molecule` feature, so the pool and the published statistic are unchanged.
- **Order for every intervention name, whatever its type:**
  1. a resolved row in the drug mapping (`mapped`, `manual`, `not_a_drug`) wins;
  2. otherwise a matching keyword rule;
  3. otherwise the type fallback.
  
  A drug-typed name that is unmapped but matches a keyword (aHSCT typed Biological, plasma exchange typed Drug) is sorted by the rule and counts as sorted in the first coverage number.
- Multi-part classes in a row (`DNA inhibitor;anti-thymocyte globulin`) are split on `;`. Each part is sorted on its own, so that drug puts the trial in both Targeted and the kind's bubble.
- In `drugs.csv` / `overrides.csv`, a row without a target that should be a kind carries the kind key in `mechanism_class` (for example `mesenchymal_stem_cells`).
- **The rule:** a resolved drug row (`mapped` or `manual`) whose `mechanism_class` is a key in `kinds.csv` is that kind. Every other resolved drug row is **molecular** and goes to `targeted`.
  - This is why "has gene targets" is not the test. Cladribine, cyclophosphamide, cemdisiran and aciclovir have a molecular mechanism on DNA or mRNA with no gene symbol, and they are targeted.
  - `not_a_drug` rows are ignored.
  - `unmapped` names count as "not yet sorted".
- The loader validates the files:
  - every `kind` in `nondrug_rules.csv` exists in `kinds.csv`;
  - every `approach` is one of the seven keys;
  - no `kinds.csv` key collides with a molecular class actually used by a row that has targets.
  - On failure: an `approaches:` run warning, the approach parts are skipped, and the run continues (R19).
- The mapping-gaps proposals' no-target rows (glatiramer, IVIG/SCIG, MSC, aHSCT, ATG, tolerisation, helminths, biotin, lipoic acid, gold nanocrystals) are applied with their `mechanism_class` changed to the matching kind key. Molecular proposals are applied unchanged.

### 6.3 Per trial (`explorer.json`)
- Which interventions count:
  - drugs: the existing cleaned experimental drugs (experimental arms, Drug/Biological);
  - non-drug: the experimental arms' interventions of other types (new extraction in `extras.py`, same arm rule; if a trial has no experimental arm, all its interventions).
  - Placebo, sham, usual care and `exclude_terms` matches are dropped, as for drugs.
- New fields:
  - `approaches: string[]` (approach keys, sorted; `["unclassified"]` when nothing else applies);
  - `kinds: string[]` (kind keys for no-target and non-drug interventions);
  - `unsorted: string[]` (unmapped drug names and unmatched names, for the Unclassified panel).
- Bubble membership:
  - A trial is in **Unclassified** only if it is in no other bubble. Its group is "Not a treatment" when all its interventions are `not_a_drug` or `type:DIAGNOSTIC_TEST`, else "Not yet sorted".
  - A trial with a mapped drug and an unmapped one is in Targeted only, and its unmapped name is still listed in `unsorted`.
- **`mechanisms` changes meaning:** molecular classes only. Kind keys never appear there. This affects the Mechanism colour mode, the Mechanism filter, panel b "By mechanism", cluster naming and the `mechanism` feature block. The kinds get their own "Approach" entries instead (§7.3).
- **Success:**
  - The R18 pool and the R21 definition are unchanged. Both need an experimental drug, so non-drug trials are never in the pool.
  - Each bubble and node shows counts by outcome for all its trials (running, completed, stopped).
  - It shows a success share only for pool trials, with the `min_group` rule.
  - For Non-drug care the share is "not defined: success here means a drug moved to a later phase". That is said once in the panel, not hidden.
  - Cell, plasma and tolerisation products that are in the drug list (MSC, IVIG) can be in the pool and get a share like any drug.
  - **Success is credited to the drug that moved on (Martin's decision 2026-11-08, option 1b).** A pool trial counts in the denominator of every group it touches. It counts as a success for a group (approach, kind, mechanism class, modality, graph node) only if at least one drug that progressed under R21 belongs to that group. An aHSCT + cyclophosphamide trial that succeeded because cyclophosphamide moved on is a success for alkylating agents, not for aHSCT. The rule applies everywhere group shares are shown, including the existing panel b By mechanism / By modality rows. A trial's own outcome on the map stays as R21 defines it. Implementation: `success_labels` also returns which drugs won, per trial. The Methods text and the before/after panel b numbers go in the PR.

### 6.4 Export
- `explorer.json` gains `approaches: [{key, label, n, finished, succeeded, stopped, running, in_pool}]` and `kinds: {key: {approach, group, label, rationale, source_url, n, …same counts}}`.
- The Targeted drugs second layer stays `mechanisms.json` (phase 3 §7.1, unchanged).
- The other bubbles' trees are small and derived in the web from `kinds` plus the trials' `kinds`; no new file.

## 7. What the visitor sees (`/mechanisms`)

### 7.1 Layout: rail + canvas (Figure 2 in the Figure Plate system)
```
┌ Approaches ───────────┬ canvas ─────────────────────────────────────────┐
│ ▌Targeted drugs   840 │                                                 │
│  ▬▬▬▬▬▬▬▬ 13%        │   the selected approach's second layer          │
│  Non-drug care  1,500 │   (Targeted: the drug → target → pathway graph) │
│  ── success n/a       │                                                 │
│  Cell & transplant 62 │                                                 │
│  Antibody & plasma 55 │                                                 │
│  Tolerisation    40  │                                                 │
│  Broad immunomod. 38  │                                                 │
│  Unclassified     21  │                                                 │
└───────────────────────┴─────────────────────────────────────────────────┘
          (counts illustrative)
```
- **The rail** works like a figure legend. Each row has the label, a trial count and a thin success bar from the pool trials (an outline bar plus "too few to tell" under `min_group`; a dash with "success not defined" for Non-drug care).
- The selected row has an ink rule on its left. Targeted drugs is selected by default. The rail rows are buttons with keyboard focus.
- The URL holds the selection (`#/mechanisms/cell`).
- At 375px the rail becomes a horizontally scrolling row of chips above the canvas, each with its label and count.
- Filters (Outcome, Disease) apply to the rail counts and the canvas together.

### 7.2 Canvas for a bubble without a target: an indented tree
```
Cell & transplant · 62 trials · 18 in the success pool, 3 succeeded
Haematopoietic reset
  aHSCT ··································· 24 trials  ●●●○○ outcome strip
Mesenchymal cells   proposed: paracrine immunomodulation [source]
  mesenchymal stem cells ·················· 31 trials  ●●○○○
  MSC-NTF (NurOwn) ························· 4 trials
Immune cells
  tolerogenic dendritic cells ·············· 3 trials
```
- A typeset list in the figure's type scale, not a graph. Group headings sit above kind rows.
- Each kind row shows its trial count, an outcome strip (running / completed / stopped / succeeded in red) and the success share when the pool allows.
- The rationale line sits under the group or kind, marked "proposed", with a source link.
- Clicking a kind opens the side panel (same as the graph's): its trials with links to `/trial/:nct`, "Show these trials on the map", and the rationale with its source.
- Unclassified uses the same tree. "Not yet sorted" lists its names by trial count, which makes the mapping backlog visible.

### 7.3 Elsewhere
- The map gains an **Approach** colour mode and filter, using the seven approaches. The existing **Mechanism** mode keeps molecular classes only. Drug-free and no-target trials take the neutral fill, as now.
- Panel b gains **By approach**.
- The hover card and panel d show the approach, and the kind when there is one.
- The cross-link "Show in mechanism graph" opens `/mechanisms/<approach>` focused on the trial's drug or kind.

### 7.4 Methods and README
- Methods gets a short section "Treatments without a molecular target". It covers:
  - the rule;
  - the seven approaches;
  - the precedent (Open Targets' exclusion, ChEMBL's no-target records, MeSH E02);
  - the counts per approach on the current snapshot;
  - the fact that rationales are proposed, not mechanisms.
- The coverage figure is restated as two numbers. The first is "drug-bearing trials whose drugs are all sorted" (molecular, kind or not a drug). The second is "trials in a bubble other than Unclassified" (all trials).

## 8. Testing
- **Pipeline:**
  - loader valid / missing / invalid files and the R19 skip;
  - the molecular rule (a no-gene-target molecular row such as cladribine stays targeted);
  - kind collision validation;
  - keyword rules, multi-match and type fallback;
  - the Unclassified sub-groups;
  - a trial in two bubbles;
  - `mechanisms` excludes kind keys;
  - the no-leakage test still holds;
  - per-approach counts and pool shares on a synthetic set.
  - Web fixtures are regenerated with small committed approach fixtures.
- **Web:**
  - vitest for rail rows (counts, too few, not defined), tree building from `kinds`, the URL selection and the Approach colour/filter;
  - Playwright at 1280 and 375 for rail and chips, switching approach, kind panel, and the cross-links.
- **Gates** green, plus real-data screenshots (light, dark, 375px) and an Impeccable finish review.

## 9. Delivery and order
1. Apply the mapping-gaps proposals (Martin, 2026-11-08: agreed with the recommendation). Accept the **high and medium** rows of `docs/superpowers/research/2026-11-07-proposed-overrides.csv`, with these changes:
   - no-target rows rewritten to kind keys (§6.2);
   - **vaccines become `not_a_drug`**, so they land in Unclassified › Not a treatment. The exception is COVID vaccines that already have a ChEMBL mechanism row: they keep it only if the trial studies the vaccine as the treatment, otherwise they become `not_a_drug`;
   - **low rows stay unmapped**;
   - the `confidence` column is dropped.
   
   The Tolerisation & vaccines approach is therefore labelled **Tolerisation**.
2. Pipeline: `config/approaches/`, the loader, non-drug extraction, the per-trial fields, the export and the `mechanisms` narrowing.
3. Web: the Approach colour/filter/panel b on the map (useful before the graph exists).
4. Phase 3 graph page, built inside the rail + canvas frame: the rail and trees first, then the Targeted drugs graph.
5. Later (not in this spec): the "pulsed reset vs continuous" highlight across bubbles, and the GtoPdb fallback.

Same branch, same process as phases 1–2 (plan with `writing-plans`, builder + reviewer per task).

## 10. My calls (for Martin to check)
1. Seven approaches with the labels in §5. "Broad immunomodulators" replaces "Diffuse immunomodulators" as plainer wording.
2. The test is "has a molecular mechanism", not "has gene targets", so DNA- and mRNA-acting drugs stay targeted (§6.2).
3. A no-target drug's kind travels in `mechanism_class` as a kind key, so there is no new column in the mechanism CSVs.
4. The ClinicalTrials.gov type is a fallback after keywords, so procedures such as plasma exchange and aHSCT land in their real bubble.
5. Unclassified holds only trials that are in no other bubble, split into "not a treatment" and "not yet sorted".
6. Non-drug care shows outcome counts but "success not defined", rather than inventing a success rule.
7. The tree, not a graph, for bubbles without a target. A force layout would suggest connections that do not exist.
8. Trees are derived in the web from `explorer.json`, with no new file.
9. The Approach colour mode, filter and panel b grouping on the map ship before the graph page.
10. Supplement, genetic and combination-product names are looked up in the drug mapping for sorting and the graph, but stay out of the pool and the statistic (§6.2).
11. Keyword rules apply to every intervention type, after the drug mapping and before the type fallback. Unmatched OTHER, GENETIC and COMBINATION_PRODUCT interventions go to "Not yet sorted" (§6.1–6.2).
12. Multi-part classes are split, so one drug can place a trial in two bubbles (§6.2).

## 11. Left to the builder
The exact keyword list (reviewed in the PR with the counts it produces); kind keys and wording within §5; outcome-strip drawing within `DESIGN.md`; chip-row behaviour at 375px; how a trial's description sentence is cut for keyword matching.
