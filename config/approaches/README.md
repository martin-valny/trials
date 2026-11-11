# Treatment approaches

Reference data that sorts every experimental intervention into one of seven **approaches**,
the bubbles on the `/mechanisms` page. Drugs with a molecular mechanism go to Targeted drugs
by rule, in code; these files describe everything else: products without a single molecular
target (cell products, IVIG, peptides, glatiramer and the like) and non-drug care (exercise,
devices, diet, procedures). Spec: `docs/superpowers/specs/2026-11-08-approach-bubbles-design.md`.

Both files are hand-written and committed. The daily run only reads them. If either is
missing or invalid, the run skips the approach parts with an `approaches: <reason>` warning
and carries on.

| File | What it is | Who writes it |
|---|---|---|
| `kinds.csv` | One row per **kind**: `kind,approach,group,label,rationale,source_url`. A kind is a treatment family without a molecular target (`msc`, `plasma_exchange`, `exercise`) or a fallback by ClinicalTrials.gov intervention type (`type:DEVICE`). `approach` is one of the seven keys below; `group` is the heading the kind sits under in its bubble. | By hand |
| `nondrug_rules.csv` | Keyword rules: `pattern,types,kind`. `pattern` is a lower-case phrase matched as a **whole word** against the cleaned intervention name and the first sentence of its description. `types` is an optional `;`-list of ClinicalTrials.gov intervention types the rule applies to (empty = any type); it is set only where a phrase is ambiguous across types. `kind` must be a key in `kinds.csv`. An intervention takes every kind whose rule matches. | By hand, reviewed with the counts it produces |

## The seven approaches

| key | label | what goes in |
|---|---|---|
| `targeted` | Targeted drugs | any experimental drug with a molecular mechanism (from ChEMBL or a manual molecular row in `config/mechanisms/`), including CAR-T, anti-FcRn, cladribine (DNA) and cemdisiran (C5 mRNA) |
| `cell` | Cell & transplant | aHSCT, mesenchymal stem cells, tolerogenic dendritic cells, T-cell vaccination, virus-specific T cells, NK cells |
| `plasma` | Antibody & plasma | IVIG / SCIG, plasma exchange, immunoadsorption, anti-thymocyte globulin |
| `tolerisation` | Tolerisation | myelin and acetylcholine-receptor peptides, T-cell receptor peptides, helminth therapy |
| `diffuse` | Broad immunomodulators | products with a stated effect but no defined target: glatiramer, high-dose biotin, lipoic acid, gold nanocrystals |
| `nondrug` | Non-drug care | rehabilitation and exercise, behavioural and psychological care, devices and neuromodulation, diet, procedures |
| `unclassified` | Unclassified | trials in no other bubble: **Not a treatment** (diagnostic tests, imaging, sampling, vaccines given to test a response) and **Not yet sorted** (unmapped names, the registry's catch-all type OTHER) |

## How an intervention is sorted

For every experimental-arm intervention, whatever its type, the first step that applies wins:

1. **The drug mapping** (`config/mechanisms/`). A `not_a_drug` row → Not a treatment. A
   `mapped` or `manual` row: each `;`-part of its `mechanism_class` that is a key in
   `kinds.csv` is that kind; every other part is a **molecular** class and puts the
   trial in Targeted drugs. So a drug row for a no-target product carries the kind key in
   `mechanism_class` (for example `msc`), and `DNA inhibitor;atg` puts a trial in both
   Targeted drugs and Antibody & plasma. The test is "has a molecular mechanism", not "has
   gene targets": cladribine (`DNA inhibitor`, no gene) is targeted.
2. **A keyword rule** in `nondrug_rules.csv`, for names with no resolved mapping row. This
   is how plasma exchange typed Drug or aHSCT typed Biological lands in its real bubble.
3. **The type fallback**: the `type:<TYPE>` kind for the intervention's ClinicalTrials.gov
   type (`type:OTHER` if the type has no row). BEHAVIORAL, DEVICE, PROCEDURE, RADIATION and
   DIETARY_SUPPLEMENT fall back into Non-drug care; DIAGNOSTIC_TEST into Not a treatment;
   OTHER, GENETIC, COMBINATION_PRODUCT, DRUG and BIOLOGICAL into **Not yet sorted**, which
   is shown with its names so the mapping backlog stays visible.

A trial is in every approach its interventions reach, and in Unclassified only when it
reaches no other. Nothing is classified from a name ending, and no rule is fuzzy.

## Editing

- **A new no-target product** (say a new cell therapy): if its family has a kind, give the
  drug a `manual` row in `config/mechanisms/overrides.csv` with the kind key in
  `mechanism_class` and empty `targets`. If not, add a kind row here first.
- **A new kind**: one row in `kinds.csv`. `rationale` is one short sentence that starts with
  "Proposed" (it is shown as a proposal, never as a mechanism); `source_url` is required
  (MeSH, NCIt, a review or a label). Both stay empty only for the `type:*` fallbacks and
  `not_a_treatment`.
- **A kind key must never equal a molecular class** used by a drug row with targets; the
  loader rejects the files if it does.
- **Keyword rules**: add whole-word phrases; prefer specific phrases over single generic
  words (`cognitive rehabilitation`, not `rehabilitation`, which would also catch physical
  rehabilitation). Re-check the per-kind counts on a real snapshot after a change.

Required kinds (the loader checks they exist): `type:BEHAVIORAL`, `type:DEVICE`,
`type:PROCEDURE`, `type:RADIATION`, `type:DIETARY_SUPPLEMENT`, `type:DIAGNOSTIC_TEST`,
`type:OTHER`, `type:GENETIC`, `type:COMBINATION_PRODUCT`, `type:DRUG`,
`type:BIOLOGICAL` and `not_a_treatment`.

## Current state

Written 2026-11-08 from the 2026-11-06 snapshot. The keyword rules were drafted from the
most frequent experimental-arm non-drug intervention names (about 1,500 distinct names in
2,987 relevant trials) and reviewed against the phrases they matched; generic words that
caught the wrong thing (`rehabilitation`, `exercises`, `motivational interviewing`) were left
out. Names no rule matches fall back by type.

## Sources and licences

Kind rationales are short summaries written for this project, each pointing at the record it
draws on:

- [MeSH](https://meshb.nlm.nih.gov/) (U.S. National Library of Medicine), public domain;
- [NCI Thesaurus](https://evsexplore.semantics.cancer.gov/) (NCIt), CC BY 4.0;
- [ChEMBL](https://www.ebi.ac.uk/chembl/) compound records, CC BY-SA 3.0;
- PubMed abstracts and the glatiramer acetate label on DailyMed (cited by URL only).

The approach scheme follows precedent rather than any one source: ClinicalTrials.gov
intervention types, ChEMBL's no-target records (glatiramer "Unknown", IVIG "Replacement
therapy"), Open Targets leaving vaccines, blood products and cell therapies out of its
target layer, and the MeSH Therapeutics tree (E02).
