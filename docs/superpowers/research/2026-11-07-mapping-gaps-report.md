# Mechanism mapping gaps: research report and source decision

For Martin. Data: the 2026-11-06 snapshot, `config/mechanisms/{drugs,overrides}.csv` as committed at `edf9118`, ChEMBL_37. Proposals: `2026-11-07-proposed-overrides.csv` (same columns as `overrides.csv` plus `confidence`). Nothing in `config/mechanisms/` was changed. Brief: `2026-11-07-mapping-gaps-task.md`.

## 0. Summary

- **Coverage would go from 63.8% to 84.6%** (838 → 1,112 of 1,314 drug-bearing trials, all drugs resolved, the review sheet §0 method) if you accept every high- and medium-confidence row. High only: 985 (75.0%). Everything including low: 1,132 (86.1%). The 80% target is reached only if you accept the medium rows, and most of those are your §1 policy calls (vaccines, MSC, aHSCT, ATG, conditioning regimens).
- **211 proposals**: 94 high, 103 medium, 14 low. Of the 71 names with ≥2 trials, 5 stay unmapped (no source states a mechanism) and 6 more get only low-confidence rows that I'd leave unmapped too (b001, elnd002, hn2301, neurovax, smoked cannabis, trichuris suis ova).
- **Source decision:** keep ChEMBL as the primary source, keep hand overrides, and add **GtoPdb (bulk CSV download) as an automatic fallback** for names ChEMBL finds with no mechanism. Use **GSRS and NCIt only as review-time suggestion sources**, not automatically: they add the most, but exact-name matching on short codes produces false hits. Open Targets, Wikidata, openFDA and MeSH add little or nothing at target level. DrugBank is ruled out by its licence.
- **Class vocabulary:** one class per target family, using the field's names (`interferon beta`, `glucocorticoid`, `NRF2 activator`, `alkylating agent`, `purine analogue`, `cannabinoid`, `α4-integrin`, `JAK inhibitor`), and AGONIST written as "agonist" rather than "modulator". Details in §4.

How the numbers were made: the scratch script `gaps.py` imports `trial_drugs` from `pipeline/scripts/map_mechanisms.py` (the same code path as the published 63.8%, which it reproduces exactly), applies `overrides.csv`, then counts a trial as resolved when every drug is `mapped`, `manual` or `not_a_drug`, or has an accepted proposal. Scripts and probe outputs are in the session scratchpad (`mapping-gaps/`), not in the repo.

## 1. Source comparison

The coverage columns come from a fixed sample of 50 gap drugs: the 11 review-sheet §1 molecules, the gap names with most trials, and a spread of codes, biologics, cell therapies and supplements. Each source was then run over all 414 unmapped names (last two columns). "Target-level" means the source names a molecular target or a mechanism a class can be built from. Sample results are in the probe outputs (`probe_*.out`).

| source | licence (verified) | access | sample: found / target-level (n=50) | all 414 gap names: target-level names → trials fully resolved (exact match, no review) | effort to add | verdict |
|---|---|---|---|---|---|---|
| ChEMBL (current) | CC BY-SA 3.0 | REST (returned HTTP 500 for much of 2026-11-07, both REST and MCP) | 43 molecules found / 0 (by construction: these are ChEMBL's gaps) | — | in place | keep as primary |
| Open Targets Platform | CC0 | GraphQL | 43 / **0** | — | low | no: drug mechanisms are ChEMBL's, nothing new |
| IUPHAR/BPS Guide to Pharmacology (GtoPdb 2026.3.1) | ODbL (database) + CC BY-SA 4.0 (contents) | **REST now needs an API key**; the bulk CSVs (`guidetopharmacology.org/DATA/ligands.csv`, `interactions.csv`) download without one | 23 / 12 | 19 names → 35 trials | low (two CSVs, about 15 MB) | **yes, automatic fallback**: curated, exact names/INN/synonyms, human targets with gene symbols, no false hits seen |
| NCATS GSRS (Inxight Drugs uses the same records) | US government work, public domain (no explicit licence on the data files) | REST (`gsrs.ncats.nih.gov/api/v1`) | 45 / 16 | 25 names → 42 trials | medium (target names → gene symbols via UniProt) | **review aid only**: best name coverage (codes → UNII); TARGET relationships include radioligands and vaccine antigens; one code collision (`b001` → SI-B001) |
| NCI Thesaurus (EVS REST), not on the brief's list | CC BY 4.0 ("NCI Thesaurus" name is a trademark) | REST (`api-evsrest.nci.nih.gov`) | 36 / 20 definitions (about 13 target-level) | 27 names → 41 trials | medium (free-text definitions plus parent classes such as "Anti-CD19 CAR T Cells Preparation", "Covalent BTK Inhibitor") | **review aid only**: best for CAR-T, bispecifics and code→INN; the `match` search hit "ga" → Ga language, "atg" → Antigua, "a/b/c" → Child-Pugh; some wrong parents (crisugabalin under "Imaging Agent") |
| MeSH Pharmacologic Action | public domain (NLM) | SPARQL / lookup API | 24 / 15 class-only | — | low | no as a mechanism source: coarse ("Immunologic Factors", "Protein Kinase Inhibitors"). Fine as a citation for class-only rows |
| Wikidata | CC0 | SPARQL | 25 / **1** | — | low | no: almost no drug→target statements for these agents |
| openFDA / DailyMed labels | public domain | REST | 11 / 5 MoA sections | — | low | no: approved drugs only; the labels for the gap drugs mostly say "not fully understood/established" (glatiramer, pirfenidone). Good citation for `not_a_drug` calls (mesna) |
| DrugBank | full data CC BY-NC 4.0 (downloads currently paused); open vocabulary CC0 | — | not tested | — | — | **ruled out**: non-commercial licence is incompatible with a public repo shipping BY-SA data; the CC0 vocabulary has no targets |

Union of GtoPdb + GSRS + NCIt with no human review: 56 names, 91 trials (→ 70.7%). But that set includes wrong rows (`b001`, `c`, `curcumin` → EP300, `l-histidine` → carbonic anhydrases, `bryostatin 1`, where GtoPdb says PKC activator and NCIt says inhibitor). The hand-reviewed proposals reach 84.6% because most of the gap is not a database problem: it is policy (vaccines, cell products, regimens) and name variants.

What the gap actually is: the 414 unmapped names make 548 name-in-trial mentions, sorted by what this review found:

| kind | mentions | share | fixable by a database? |
|---|---|---|---|
| class-only products with no molecular target: glatiramer, IVIG/SCIG, MSC, aHSCT, ATG, vaccines, T-cell vaccination, tolerogenic DCs, helminths | 158 | 29% | no: a policy decision, then a hand row |
| molecular mechanism found: molecules ChEMBL lists without a mechanism, plus codes and brand variants of known drugs | 136 | 25% | partly: GtoPdb automatically; GSRS/NCIt after review |
| CAR-T / CAAR-T with a named target | 25 | 5% | yes, via NCIt (after review) |
| `not_a_drug` (tracers, contrast, supportive drugs, regimens, arm labels) | 20 | 4% | no |
| still unresolved: arm placeholders, supplements, codes with no public record, not attempted | 209 | 38% | no |

## 2. Recommendation

1. **Accept the high rows now**, then go through the medium rows as the policy decisions they are (§3). That alone takes coverage past 75%; with the medium rows it reaches about 85%.
2. **Add GtoPdb as an automatic fallback** in `map_mechanisms.py`, but only for names ChEMBL finds as a molecule without a mechanism, or does not find at all. It is cheap, curated, licence-compatible, and every hit in the sample was right. Its value is modest (about 35 trials today, most already covered by these overrides), but it keeps future snapshots from regressing as new agents appear. Design note in §6.
3. **Do not auto-ingest GSRS or NCIt.** Write a small offline `suggest_mechanisms.py` that lists GSRS/NCIt candidates for each unmapped name in a review sheet, for a human to copy into `overrides.csv`. Code collisions on short names (`b001`, `c`, `ga`, `atg`) make unattended use unsafe under the never-guess rule.
4. **Do not add** Open Targets, Wikidata, openFDA or MeSH as mapping sources. Cite MeSH and labels in `source` where they state the class.
5. **Licence:** mixing GtoPdb (CC BY-SA 4.0) into a CC BY-SA 3.0 file is allowed: BY-SA 3.0 permits adaptations under a later version, so `drugs.csv` would move to CC BY-SA 4.0. Add the GtoPdb citation (Harding SD et al., Nucleic Acids Res. 2024;52:D1438) and the NCIt/GSRS attributions to `config/mechanisms/README.md` for any rows citing them.

## 3. Decisions: review sheet §1

Every row below is in the CSV unless marked "leave unmapped". "Class only" means no gene target, because no source states one.

### 3.1 Glatiramer (18 + variants)

`glatiramer (immunomodulator)`, modality other, class only. Source: the FDA label §12.1 says the mechanism "is not fully understood"; MeSH D000068717 gives pharmacological action Immunosuppressive Agents; ChEMBL CHEMBL1201507 has no mechanism. Names: glatiramer, copaxone®, copolymer 1, experimental glatiramer (high); ga (high: the trial lists Glatiramer Acetate as the other name); ga depot and ga depot once monthly (medium, Mapi's long-acting depot); cyclophosphamide/glatiramer (split into both parts); interferon or glatiramer (medium; this is an "either injectable DMT" arm, and `not_a_drug` like "platform therapies" is the alternative).

### 3.2 IVIG / SCIG (25 names, 39 name-in-trial mentions)

`immunoglobulin (IVIG/SCIG)`, protein, CHEMBL1201599, class only. Source: MeSH D007136 (Immunologic Factors), NCIt C2701 and C80829. Each brand or code was checked against the intervention text or label: igiv-c/gamunex-c (Grifols), newgam = panzyga, npb-01 (Nihon), igpro10 = Privigen, igpro20 = Hizentra, hyqvia = tak-771, tak-881 (20% fSCIG), xembify, gb-0998 (Venoglobulin-IH). Generic "immunoglobulin", "immunoglobulin g" and "immunoglobulin perfusion" are medium. The IVIG + methylprednisolone combination gets both classes.

### 3.3 Stem cells / aHSCT / conditioning (49)

- `mesenchymal stem cells` (cell therapy, class only; MeSH D059630, NCIt C160891): 21 MSC names, including HB-adMSCs, SCM-010 (high, named in NCIt), NurOwn (MSC-NTF) and MSC-NP. Medium, because putting them in a class is your call.
- `aHSCT` (cell therapy; MeSH D018380, NCIt C16039): 6 HSCT names plus "autologous stem cells" in aHSCT protocols. Medium.
- Conditioning regimens with no named drug ("standard lymphodepletion regimen", "lymphodepleting conditioning", "myeloablative regimen"): `not_a_drug`, medium, as the review sheet suggested.
- ATG (`ratg`, `atg`, `anti-thymocyte globulin`, `cyclophosphamide and atg`): `anti-thymocyte globulin` (antibody, polyclonal, class only; NCIt C278). Medium. In these trials ATG is part of aHSCT conditioning, so `not_a_drug` is the defensible alternative.
- `mesna`: `not_a_drug`, high. It is a uroprotectant given with cyclophosphamide (Mesnex label §12.1; NCIt "Uroprotective Agent"), the same reasoning as §2 row 11.
- Leave unmapped (cell products with no citable mechanism, or exosome products): human (fetal) neural stem cells, amniotic fluid CD117 stem cells, autologous bone-marrow mononuclear stem cells, MSC-derived exosomes and extracellular vesicles, tolerogenic fibroblasts.

### 3.4 Drugs ChEMBL lists without a mechanism

| drug (ChEMBL id) | proposal | source | conf. |
|---|---|---|---|
| laquinimod (+ 0.6, 1.2) (CHEMBL66092) | `AhR agonist`, AHR | GSRS TARGET→ACTIVATOR AhR; PMID 27671624, 30808363 | medium (mechanism from preclinical work; ChEMBL silent) |
| telitacicept, rc18 (CHEMBL5095293) | `anti-APRIL;anti-BAFF` (as atacicept), TNFSF13;TNFSF13B | GtoPdb 11827; NCIt C166498 | high |
| remibrutinib (CHEMBL4483575) | `BTK inhibitor`, BTK | GtoPdb 10457; NCIt C175851 | high |
| empasiprubart (CHEMBL5314673) | `anti-C2`, C2 | argenx pipeline; Nat Commun 2025 doi:10.1038/s41467-025-62925-1 | high |
| frexalimab, sar441344 (CHEMBL5095122) | `anti-CD40L`, CD40LG | GSRS UNII WO7SFK0ENJ | high |
| ripertamab (CHEMBL4594604) | `anti-CD20`, MS4A1 | NCIt C122680; GSRS | high |
| divozilimab, bcd-132 (CHEMBL5314981) | `anti-CD20`, MS4A1 | GtoPdb 13087 (BCD-132 synonym); GSRS; NCIt | high |
| riliprubart (CHEMBL5315038) | `anti-C1s`, C1S | AAN 2024/2025 abstracts, Sanofi (activated C1s) | medium (no database states the target) |
| rocbrutinib, lp-168 (CHEMBL5314539) | `BTK inhibitor`, BTK | NCIt C203033 (LP-168 synonym); GSRS | high |
| povetacicept (CHEMBL5095306) | `anti-APRIL;anti-BAFF` | GtoPdb 14426; GSRS; NCIt | high |
| claseprubart | `anti-C1s`, C1S | GtoPdb 14583 | high |
| imeroprubart, imvt-1402 (CHEMBL6068254) | `anti-FcRn`, FCGRT | NCIt C211794; GSRS | high |
| dirucotide, mbp8298 (CHEMBL2105639) | `myelin peptide tolerisation`, MBP | GSRS TARGET→TOLEROGEN MBP; NCIt C166542 | medium |

### 3.5 Vaccines (20)

`vaccine` (other, class only), medium, citing the NCIt vaccine concepts. They are mostly vaccine-response studies, so `not_a_drug` is the alternative; coverage is the same either way. COVID vaccines follow the existing ChEMBL rows (`Spike glycoprotein vaccine antigen`, S): bnt162 and moderna mrna-1273 variants (high), ad26.cov2.s (high, NCIt definition), "mrna covid-19 vaccine" (medium). BCG and KLH get `vaccine` too (KLH is a neoantigen challenge). Leave unmapped: "monovalent cov2 pres dtm-as03", "two-dose m0-m6 vaccination schedule", mrna-1195 and uro vaxom, because the name alone does not identify the product well enough.

### 3.6 Arm-type questions

| name | proposal | conf. |
|---|---|---|
| dosing interruption of natalizumab | `not_a_drug` (no drug is given; same as "treatment withdrawal") | medium |
| baseline treatment | `not_a_drug` (stable background immunosuppressant, any of several) | high |
| inebilizumab + rapid steroid tapering group | `anti-CD19;glucocorticoid receptor modulator`, CD19;NR3C1, consistent with "corticosteroids" (replaces the current override; no coverage change) | medium |

## 4. Proposed class vocabulary (review sheet §2)

Principle: **one class per target family, named the way neurologists name it, with the action word only where it carries meaning.** Implement it as (a) `target_labels.csv` entries plus (b) a small action-word change in `classify.py` (AGONIST → "agonist"; never "modulator" unless ChEMBL says MODULATOR), plus (c) a short class-override map (`class_labels.csv`, `old class → new class`) applied after classification. That would be a code change of its own; the proposals CSV still uses today's class names so it can be applied as is.

| # | today | proposed class | how |
|---|---|---|---|
| 1 | glucocorticoid receptor modulator; IFN-α/β receptor modulator; ACTH / G-CSF / EPO / IL-2 / GM-CSF receptor modulator | `glucocorticoid`; `interferon beta`; `ACTH (corticotropin)`; `G-CSF`; `EPO`; `IL-2`; `GM-CSF` | class map; plus AGONIST → "agonist" for everything else (exception: keep `S1P receptor modulator`, the field's term) |
| 2 | KEAP1 inhibitor (fumarates) | `NRF2 activator (fumarate)` | class map on target KEAP1. The field's name; ChEMBL's KEAP1 target is the molecular basis |
| 3 | DNA inhibitor (cyclophosphamide, melphalan, carmustine); DNA inhibitor (cladribine); mitoxantrone | `alkylating agent`; `purine analogue`; `topoisomerase II inhibitor` (mitoxantrone keeps only that one) | per-drug class map |
| 4 | fludarabine: DNA polymerase …; RR1 … (14 genes) | `purine analogue` (cytarabine: `pyrimidine analogue`) | per-drug class map; keep the targets |
| 5 | CB1 receptor inhibitor + CB1 receptor modulator | `cannabinoid` (THC, CBD, nabiximols, nabilone, cannabis preparations) | class map on CNR1 |
| 6 | anti-α4-integrin; α4-integrin antagonist; α4-integrin inhibitor | `α4-integrin` (natalizumab, firategrast, CDP323, ELND002) | label key ITGA4… → `α4-integrin`; drop the action word for this family |
| 7 | anti-CCR2 / CCR2 antagonist; JAK / JAK1 / JAK2 / JAK3 / TYK2 inhibitor | `CCR2`; `JAK inhibitor` | class map: all JAK-family kinase targets → one class |
| 8 | CD19 modulator → CD19 CAR-T (obe-cel) | keep `CD19 CAR-T`; teach the CAR-T rule to also fire on ChEMBL `molecule_type = Gene` with "-cel"/"leucel" names (rapcabtagene autoleucel, azercabtagene zapreleucel, cc-97540) | code |
| 9 | 3–6 classes per symptomatic drug | one class per drug: the label's primary mechanism (paracetamol `analgesic (COX)`, metformin `biguanide`, hydroxychloroquine `antimalarial (TLR7/9)`, ibudilast `PDE inhibitor`, quetiapine `antipsychotic`, topiramate `anticonvulsant`) | per-drug class map |
| 10 | raw ChEMBL names | add labels for the ones in use, e.g. `TRPV1 agonist`, `FAAH inhibitor`, `MAGL inhibitor`, `complement factor B inhibitor`, `SV2A ligand`, `α2δ ligand`, `ryanodine receptor antagonist` | `target_labels.csv` |
| 11 | background drugs (antibiotics, antihistamine premedication, sugammadex, vaccines) | `not_a_drug` when the trial gives them as premedication or background; keep the class when they are the studied drug | per-name override after reading the arm |
| 12 | "antihistamine" → one molecule; "vitamin d" → one molecule | keep the class, blank `chembl_id` and keep only the class-level targets (HRH1; VDR) | override rows |
| 13 | 182 classes | rows 1–7 and 9 merge many near-duplicates (a rough hand count: about 40); recount after implementing | — |

New classes these proposals introduce, all following the same principle: `glatiramer (immunomodulator)`, `immunoglobulin (IVIG/SCIG)`, `mesenchymal stem cells`, `aHSCT`, `anti-thymocyte globulin`, `vaccine`, `AhR agonist`, `anti-C2`, `anti-C1s`, `anti-CD40L`, `myelin peptide tolerisation`, `AChR peptide vaccine`/`AChR peptide tolerisation`, `T-cell vaccination`, `tolerogenic dendritic cells`, `high-dose biotin`, `M1 receptor antagonist`, `LPA1 receptor antagonist`, `gold nanocrystals (nanocatalyst)`, `antioxidant (lipoic acid)`, `helminth therapy`, `EBV-specific T cells`, `NK cell therapy`, `MuSK CAAR-T`, `factor D inhibitor`, `RIPK1 inhibitor`, `SGK2 activator`, `FAAH/MAGL inhibitor`, `ClC-1 inhibitor`, `anti-BCMA×CD3`, `anti-GluN1 (autoantibody blocker)`, `C1 inhibitor`, `IGF-1 receptor agonist`, `CD19 CAR-T;CD20 CAR-T`.

## 5. Unmapped names with ≥2 trials (the "top 60": 71 names tie at ≥2)

| # | name | trials | proposal | confidence |
|---|---|---|---|---|
| 1 | glatiramer | 18 | glatiramer (immunomodulator) (other) | high |
| 2 | laquinimod | 8 | AhR agonist (small molecule); AHR | medium |
| 3 | mesna | 6 | not_a_drug | high |
| 4 | telitacicept | 6 | anti-APRIL;anti-BAFF (protein); TNFSF13;TNFSF13B | high |
| 5 | autologous mesenchymal stem cells | 5 | mesenchymal stem cells (cell therapy) | medium |
| 6 | empasiprubart | 5 | anti-C2 (antibody); C2 | high |
| 7 | mesenchymal stem cells | 5 | mesenchymal stem cells (cell therapy) | medium |
| 8 | remibrutinib | 5 | BTK inhibitor (small molecule); BTK | high |
| 9 | ivig | 4 | immunoglobulin (IVIG/SCIG) (protein) | high |
| 10 | md1003 | 4 | high-dose biotin (small molecule) | medium |
| 11 | bcd-132 | 3 | anti-CD20 (antibody); MS4A1 | high |
| 12 | biib041 | 3 | Kv channel inhibitor (small molecule); KCNA1;KCNA10;KCNA2;KCNA3;KCNA4;KCNA5;KCNA6;KCNA7;KCNB1;KCNB2;KCNC1;KCNC2;KCNC3;KCNC4;KCND1;KCND2;KCND3;KCNF1;KCNG1;KCNG2;KCNG3;KCNG4;KCNH1;KCNH2;KCNH3;KCNH4;KCNH5;KCNH6;KCNH7;KCNH8;KCNQ1;KCNQ2;KCNQ3;KCNQ4;KCNQ5;KCNS1;KCNS2;KCNS3;KCNV1;KCNV2 | high |
| 13 | claseprubart | 3 | anti-C1s (antibody); C1S | high |
| 14 | dirucotide | 3 | myelin peptide tolerisation (protein); MBP | medium |
| 15 | frexalimab | 3 | anti-CD40L (antibody); CD40LG | high |
| 16 | gc012f | 3 | BCMA CAR-T;CD19 CAR-T (cell therapy); CD19;TNFRSF17 | high |
| 17 | hematopoietic stem cell transplantation | 3 | aHSCT (cell therapy) | medium |
| 18 | igiv-c | 3 | immunoglobulin (IVIG/SCIG) (protein) | high |
| 19 | immune globulin | 3 | immunoglobulin (IVIG/SCIG) (protein) | high |
| 20 | immunoglobulin | 3 | immunoglobulin (IVIG/SCIG) (protein) | medium |
| 21 | neurovax | 3 | TCR peptide vaccine (other) | low |
| 22 | npb-01 | 3 | immunoglobulin (IVIG/SCIG) (protein) | high |
| 23 | ratg | 3 | anti-thymocyte globulin (antibody) | medium |
| 24 | rc18 | 3 | anti-APRIL;anti-BAFF (protein); TNFSF13;TNFSF13B | high |
| 25 | ripertamab | 3 | anti-CD20 (antibody); MS4A1 | high |
| 26 | standard lymphodepletion regimen | 3 | not_a_drug | medium |
| 27 | tolerogenic dendritic cells | 3 | tolerogenic dendritic cells (cell therapy) | medium |
| 28 | 23-valent pneumococcal polysaccharide vaccine | 2 | vaccine (other) | medium |
| 29 | adezunap | 2 | CB1 receptor modulator (small molecule); CNR1 | medium |
| 30 | allogeneic human umbilical cord tissue-derived mesenchymal stem cells | 2 | mesenchymal stem cells (cell therapy) | medium |
| 31 | anti-thymocyte globulin | 2 | anti-thymocyte globulin (antibody) | medium |
| 32 | art5803 | 2 | anti-GluN1 (autoantibody blocker) (antibody); GRIN1 | medium |
| 33 | atg | 2 | anti-thymocyte globulin (antibody) | medium |
| 34 | atx-ms-1467 | 2 | myelin peptide tolerisation (protein); MBP | medium |
| 35 | autologous stem cells | 2 | aHSCT (cell therapy) | medium |
| 36 | b001 | 2 | anti-CD20 (antibody); MS4A1 | low |
| 37 | bg9418 | 2 | IFN-α/β receptor modulator (protein); IFNAR1;IFNAR2 | high |
| 38 | biib061 | 2 | leave unmapped | — |
| 39 | caba-201 | 2 | CD19 CAR-T (cell therapy); CD19 | high |
| 40 | calculus bovis sativus | 2 | leave unmapped | — |
| 41 | cc-97540 | 2 | CD19 CAR-T (cell therapy); CD19 | high |
| 42 | cnm-au8 | 2 | gold nanocrystals (nanocatalyst) (other) | medium |
| 43 | cv-mg01 | 2 | AChR peptide vaccine (other) | medium |
| 44 | descartes-08 | 2 | BCMA CAR-T (cell therapy); TNFRSF17 | high |
| 45 | divozilimab | 2 | anti-CD20 (antibody); MS4A1 | high |
| 46 | elnd002 | 2 | α4-integrin antagonist (small molecule); ITGA4 | low |
| 47 | ferumoxytol | 2 | not_a_drug | high |
| 48 | ga depot | 2 | glatiramer (immunomodulator) (other) | medium |
| 49 | gc012f car-t cell | 2 | BCMA CAR-T;CD19 CAR-T (cell therapy); CD19;TNFRSF17 | high |
| 50 | gt802 | 2 | leave unmapped | — |
| 51 | gz402668 | 2 | anti-CD52 (antibody); CD52 | high |
| 52 | hn2301 | 2 | CD19 CAR-T (cell therapy); CD19 | low |
| 53 | igpro10 | 2 | immunoglobulin (IVIG/SCIG) (protein) | high |
| 54 | igpro20 | 2 | immunoglobulin (IVIG/SCIG) (protein) | high |
| 55 | influenza vaccine | 2 | vaccine (other) | medium |
| 56 | lipoic acid | 2 | antioxidant (lipoic acid) (small molecule) | medium |
| 57 | methylreboxetine | 2 | not_a_drug | high |
| 58 | mis416 | 2 | NOD2/TLR9 agonist (other); NOD2;TLR9 | medium |
| 59 | newgam | 2 | immunoglobulin (IVIG/SCIG) (protein) | high |
| 60 | ocr | 2 | anti-CD20 (antibody); MS4A1 | high |
| 61 | ono-4641 | 2 | S1P receptor modulator (small molecule); S1PR1;S1PR5 | medium |
| 62 | pipe-307 | 2 | M1 receptor antagonist (small molecule); CHRM1 | high |
| 63 | pipe-791 | 2 | LPA1 receptor antagonist (small molecule); LPAR1 | high |
| 64 | polyphenon e | 2 | leave unmapped | — |
| 65 | rapcabtagene autoleucel | 2 | CD19 CAR-T (cell therapy); CD19 | high |
| 66 | seasonal influenza vaccine | 2 | vaccine (other) | medium |
| 67 | smoked cannabis | 2 | CB1 receptor modulator (small molecule); CNR1 | low |
| 68 | sys6020 | 2 | BCMA CAR-T (cell therapy); TNFRSF17 | high |
| 69 | tovaxin autologous t cell vaccine | 2 | T-cell vaccination (cell therapy) | medium |
| 70 | trichuris suis ova | 2 | helminth therapy (other) | low |
| 71 | universal star-t cell | 2 | leave unmapped | — |

Single-trial names: of the 343, the CSV resolves 144 where a source settled it (codes in GtoPdb/GSRS/NCIt, CAR-T products, tracers, vaccines, IVIG/MSC variants). Not attempted: arm placeholders ("a", "formulation b", "dose level 2 group", "101 part a", "study drug", "infusions", "sustained-release"; they are resolved per trial, not per name), food and supplement items (cranberry, fish oil, boswellic acids, ginseng, TCM granules), and codes with no public record (e.g. bat4406f, bcd-033/054/063/281, bht-3009, c105, gsk3888130b, imcy-0141, ly3541860, ro7268489, ro7845860, rph-035, shr-2173, tak-411, trx319). Known identities left unmapped because nothing states a target: biib061 (the registry says only "blocks mechanisms that prevent OPC differentiation"), gt802, universal star-t cell, hn2302, calculus bovis sativus, polyphenon e / EGCG.

## 6. Design note (proposal only, no code): GtoPdb fallback in `map_mechanisms.py`

- **Order:** overrides (always win) → ChEMBL as today → **GtoPdb only if ChEMBL produced no class** (molecule not found, or found without a usable mechanism). ChEMBL's id and modality are kept when ChEMBL found the molecule; GtoPdb supplies only mechanism, action and targets. Record the provenance: a new optional column `mechanism_source` (`chembl`/`gtopdb`) in `drugs.csv`, or a `source` note.
- **Matching:** exact, casefolded match of the drug name against GtoPdb `Name`, `INN` and the `|`-separated `Synonyms` (HTML tags such as `<sub>` stripped). More than one ligand id → ambiguous → unmapped (same rule as ChEMBL).
- **Targets → gene symbols:** take `interactions.csv` rows for the ligand with `Target Species == Human`, preferring `Primary Target == true` (fall back to all human rows); gene symbol from `Target Gene Symbol`, or `Target Ligand Gene Symbol` when the target is itself a ligand (TACI-Fc → TNFSF13/TNFSF13B). These are HGNC symbols already, so no UniProt step.
- **Action → class:** GtoPdb `Action`/`Type` (Inhibition, Antagonist, Agonist, Activation, Binding, Blocker, …) mapped to ChEMBL's action words, then the existing `classify` rules (`anti-<label>` for antibodies and peptides; `<label> <action>` otherwise). Modality from GtoPdb `Type` (Synthetic organic/Natural product/Metabolite → small molecule; Antibody → antibody; Peptide → protein) when ChEMBL has none. Skip `Metabolite` ligands with no human primary target (e.g. inosine, biotin) and any ligand whose interactions are all non-human.
- **Caching:** download `ligands.csv` and `interactions.csv` once per GtoPdb release into `pipeline/.cache/gtopdb/<version>/` (the version is on the files' first line, e.g. `2026.3.1`); the daily run still never touches the network. No API key needed.
- **Fixtures:** `--record` writes the filtered rows used (the matched ligands and their interaction rows) to `pipeline/tests/fixtures/gtopdb/`; tests: telitacicept (ligand-target path), remibrutinib (enzyme), divozilimab via the synonym BCD-132, a metabolite skip, an ambiguous synonym, and ChEMBL-wins precedence.
- **Licence/README:** a GtoPdb section with the version, retrieval date, ODbL + CC BY-SA 4.0, the citation; `drugs.csv` licence moves to CC BY-SA 4.0.
- **Expected effect today:** about 19 names / 35 trials, almost all already in this proposal set; the value is in future snapshots.

Optional companion (review aid, not in the daily path): `suggest_mechanisms.py` queries GSRS (`/substances/search?q=root_names_name:"<NAME>"`, TARGET→ relationships, UNII) and NCIt (`/concept/ncit/search?type=match` plus definition and parents) for each unmapped name and writes a Markdown candidate sheet, the way this report was made. It needs a minimum name length (≥4 characters) and a stop-list to avoid the collisions seen here.

## 7. Concerns

1. **Medium rows are mostly policy, not evidence.** Vaccines, MSC, aHSCT, ATG and conditioning regimens account for about 100 of the newly resolved name-in-trial mentions. Decide them as groups; the `not_a_drug` alternative gives the same coverage.
2. **Class-only rows** (glatiramer, IVIG, MSC, aHSCT, vaccines, biotin, lipoic acid) carry no targets. Target-based views will still show them as "no target", which is correct.
3. **Code collisions:** `b001` (NCIt anti-CD20 vs GSRS SI-B001) is proposed as low/leave. Other short codes were checked against the intervention text, read locally and not committed.
4. **Single-source company claims:** riliprubart (anti-C1s), empasiprubart (anti-C2), PIPE-307 (M1) and adezunap (THC) rest on company or abstract sources. The low rows (b001, elnd002, hn2301, neurovax, helminths, cannabis preparations) should stay unmapped unless you want them.
5. **ChEMBL was down (HTTP 500) during this work**, so nothing was re-checked live against ChEMBL. All ChEMBL ids come from `drugs.csv`, Open Targets or the MCP compound search.
6. **The coverage figure is for the 2026-11-06 snapshot.** New trials add new tail names, so expect a few points of decay between override passes.

## 8. Sources used

ChEMBL 37 (via `drugs.csv`, the ChEMBL MCP compound search; REST unavailable); Open Targets Platform GraphQL API; GtoPdb 2026.3.1 bulk CSVs; GSRS REST API (gsrs.ncats.nih.gov); NCI Thesaurus via EVS REST API; MeSH via id.nlm.nih.gov lookup and SPARQL; Wikidata SPARQL; openFDA drug label API; PubMed (E-utilities and the PubMed MCP): PMIDs 27671624, 30808363, 33408169, 29542041, 38087362, 32140672, 34332461, 29177070, 33797705, 40856088, 39083422; web pages: argenx empasiprubart pipeline page, AAN 2025 riliprubart abstract, AAN 2026 ART5803 abstract, AstraZeneca Gracell press release (2023-12-26), CORDIS project 602420 (CV-MG01), DrugBank releases page (licence), GtoPdb about page (licence), NCI Thesaurus terms of use (CC BY 4.0).
