# Mechanism mapping: review sheet (first ChEMBL run)

For Martin. Written 2026-11-07 from the 2026-11-06 snapshot (2,987 relevant trials, 1,314 with at least one experimental drug, 909 distinct cleaned drug names). Source: ChEMBL_37 (2026-05-01) via `pipeline/scripts/map_mechanisms.py`, plus hand-written rows in `config/mechanisms/overrides.csv`.

How to correct anything: add or edit a row in `config/mechanisms/overrides.csv`. That row replaces the drug's row completely and always wins. Drug names match lower-case. Each row I added has a `source` column that says why.

## 0. Coverage

| measure | value |
|---|---|
| drug-bearing trials whose drugs are all `mapped`, `manual` or `not_a_drug` | **836 / 1,314 = 63.6%** (target 80%: not reached) |
| drug-bearing trials with at least one mechanism class | 866 / 1,314 = 65.9% |
| drug–trial pairs resolved | 1,113 / 1,664 = 66.9% |
| drugs: mapped by ChEMBL / manual / not_a_drug / unmapped | 247 / 199 / 50 / 413 |

ChEMBL alone resolves 45.1% of drug-bearing trials. Almost all of the gain comes from name variants of drugs ChEMBL already maps: doses, formulations, typos, brands and codes, such as "fampridine-sr", "avonex®", "bg00002" and "mt-1303-high". The remaining gap is a long tail: 296 unmapped names occur in only one trial each. The largest unmapped groups have no single molecular target, or ChEMBL lists the molecule with no mechanism (section 2). I did not guess classes for them.

## 1. Classes that look wrong or need your call (most important first)

1. **Agonists are shown as "modulator".** The derivation maps AGONIST, PARTIAL AGONIST and BINDING AGENT to "modulator", so you get "glucocorticoid receptor modulator" (53 trials), "IFN-α/β receptor modulator" (89), "ACTH receptor modulator", "G-CSF receptor modulator" and "EPO receptor modulator". For S1P this is the usual name; for interferon beta and glucocorticoids it reads oddly. Options:
   - give interferon beta and glucocorticoids target labels such as "interferon beta" and "glucocorticoid" (a `target_labels.csv` change);
   - map AGONIST to "agonist" in `ACTION_WORD` (a code change).
2. **Fumarates come out as "KEAP1 inhibitor"** (dimethyl, monomethyl and diroximel fumarate, ALKS 8700; 37 trials). ChEMBL records them as KEAP1 inhibitors; the field usually calls them "NRF2 activators". The seed label NFE2L2→NRF2 never fires, because ChEMBL's target is KEAP1. Suggestion: label KEAP1 as "NRF2 pathway" or override to "NRF2 activator".
3. **Cytotoxics get the vague class "DNA inhibitor"** (cyclophosphamide, cladribine, mitoxantrone, melphalan, bendamustine; 51 trials). Fludarabine gets two long enzyme classes. You might prefer one hand-chosen class such as "cytotoxic / lymphocyte-depleting", or "purine analogue" for cladribine and fludarabine.
4. **Cannabidiol is "CB1 receptor inhibitor"** (ChEMBL: negative allosteric modulator → "inhibitor"). Nabiximols therefore carries both "CB1 receptor inhibitor" and "CB1 receptor modulator" (THC). Consider one class such as "cannabinoid" for nabiximols, THC and CBD.
5. **The same target gets different action words:** "anti-α4-integrin" (natalizumab), "α4-integrin antagonist" (firategrast), "α4-integrin inhibitor" (CDP323). The same goes for anti-CCR2 vs CCR2 antagonist, and for the JAK family (JAK, JAK1, JAK2). Merge them if the map should group them.
6. **Obecabtagene autoleucel is "CD19 modulator".** It is a CD19 CAR-T, but ChEMBL types it as "Gene", not "Cell", so the CAR-T rule does not fire. Rapcabtagene autoleucel (a CD19 CAR-T, also typed Gene in ChEMBL) has no ChEMBL mechanism and is unmapped. Both need an override to "CD19 CAR-T".
7. **Multi-mechanism small molecules get several classes,** each counted:
   - paracetamol: COX inhibitor, FAAH inhibitor, TRPV1 activator;
   - metformin: complex I and GPD2;
   - quetiapine, topiramate, hydroxychloroquine and ibudilast: three to six classes each.

   For symptomatic drugs you might keep one class.
8. **Raw ChEMBL target names where no label exists,** for example "Ribonucleoside-diphosphate reductase RR1 inhibitor", "Transient receptor potential cation channel subfamily V member 1 activator" and "Glycerol-3-phosphate dehydrogenase, mitochondrial inhibitor". I added short labels for the targets the frequent classes use (`target_labels.csv`). The rest stay as ChEMBL names; add labels if any matter.
9. **Classes from comparator or background drugs:** antibiotics (minocycline, doxycycline: "Bacterial 70S ribosome inhibitor"), antivirals (aciclovir), antihistamines used as premedication, vaccines ("Spike glycoprotein vaccine antigen"), sugammadex ("Rocuronium agent"). They are correct, but they are not MS/NMOSD/MG mechanisms. Mark any that are only premedication as `not_a_drug` if you want them out of the map.
10. **Combination rows** split into their named components, and each component's class counts. For example, "avonex and topamax" adds topiramate's six classes. "efgartigimod ph20" and "ocrelizumab co-formulated with rhuph20" drop the hyaluronidase excipient on purpose.

## 2. Unmapped groups I left for you (no guessing)

| group | trials (approx.) | why unmapped | suggested override |
|---|---|---|---|
| glatiramer, ga, ga depot, copaxone®, copolymer 1, experimental glatiramer, cyclophosphamide/glatiramer | ~25 | ChEMBL has glatiramer acetate (CHEMBL1201507) but no mechanism | class "glatiramer (immunomodulator)", modality "other" |
| IVIG / SCIG: ivig, immune globulin, immunoglobulin, igiv-c, newgam, npb-01, gamunex-c, panzyga, hizentra, hyqvia, xembify, igpro10/20, … | ~25 | ChEMBL "human immunoglobulin G" has no mechanism and no single target | class "immunoglobulin (IVIG/SCIG)" |
| stem cells / aHSCT: mesenchymal stem cells (many variants), hematopoietic stem cell transplantation, autologous stem cells, standard lymphodepletion regimen, myeloablative regimen | ~35 | procedures and cell products with no molecular target | class "aHSCT" / "MSC", modality "cell therapy" — or `not_a_drug` |
| ChEMBL knows the molecule, but it has no mechanism: telitacicept (6), remibrutinib (5), empasiprubart (5), frexalimab / SAR441344 (4), ripertamab (3), divozilimab (2) and BCD-132 (3, Biocad's code for divozilimab), laquinimod (8), riliprubart, imeroprubart (no suggestion), rocbrutinib, povetacicept | ~45 | no ChEMBL mechanism record | from the literature, my understanding: telitacicept and povetacicept TACI-Fc (BAFF/APRIL); remibrutinib and rocbrutinib BTK inhibitor; empasiprubart anti-C2; riliprubart anti-C1s; frexalimab anti-CD40L; ripertamab and divozilimab anti-CD20; laquinimod (mechanism unclear, AhR) — please confirm before I add them |
| CAR-T products whose name does not state the target (gc012f, descartes-08, caba-201, rapcabtagene autoleucel, anito-cel, kite-363, ct103a, …; KYV-101 is mapped because one of its trials names it 'anti-cd19 car-t') | ~15 | target not in the intervention name | per product |
| vaccines (influenza, pneumococcal, tetanus, zoster, COVID) in vaccine-response studies | ~20 | ChEMBL has no mechanism for most | `not_a_drug`, or class "vaccine" |
| cannabis (smoked, medical, standardized extract, low/mild dose) | ~6 | variable composition | class "cannabinoid", if you merge per item 4 |
| MD1003 (high-dose biotin) | 4 | ChEMBL biotin has no mechanism | class "biotin (high dose)" |
| mesna | 6 | uroprotectant given with cyclophosphamide, no target | `not_a_drug`, if you treat supportive drugs that way |
| arm placeholders: a, b, c, d, formulation a–d, dose level 1–4 group, 101 part a/b, study drug | ~15 | names a drug only by arm label | leave unmapped, or `not_a_drug` |

What I marked `not_a_drug` (50 names): sample collection (blood/CSF/urine sampling, lumbar puncture); imaging tracers and MRI contrast agents (11C-/18F- tracers, FDG, gadobutrol, gadoteridol, gadobenate); and treatment-strategy labels that name no single drug ("discontinuation of disease modifying therapy", "treatment withdrawal", "dmt", "platform therapies", "early highly effective therapies group", …). The `source` column of each row gives the reason. If you consider any strategy arm a treatment, change its row back.

What I marked `manual` (199 names): name variants, brands, codes and typos of drugs ChEMBL maps, with the mapping copied from the canonical drug; combination products split into their named components (nabiximols = THC + CBD, BEAM, Truvada, AVP-923 = dextromethorphan/quinidine, ADS-5102 = amantadine ER); generic "corticosteroids" mapped to the glucocorticoid-receptor class; and CAR-T products whose target is stated in the intervention name (CD19, BCMA, CD20, BAFF-R). Every row has a `source`.


## 3. Top 60 drugs by trial count

| # | drug | trials | class | targets | modality | status |
|---|---|---|---|---|---|---|
| 1 | fingolimod | 42 | S1P receptor modulator | S1PR1; S1PR2; S1PR3; S1PR4; S1PR5 | small molecule | mapped |
| 2 | ocrelizumab | 37 | anti-CD20 | MS4A1 | antibody | mapped |
| 3 | dimethyl fumarate | 30 | KEAP1 inhibitor | KEAP1 | small molecule | mapped |
| 4 | methylprednisolone | 29 | glucocorticoid receptor modulator | NR3C1 | small molecule | mapped |
| 5 | rituximab | 27 | anti-CD20 | MS4A1 | antibody | mapped |
| 6 | interferon beta-1a | 26 | IFN-α/β receptor modulator | IFNAR1; IFNAR2 | protein | mapped |
| 7 | natalizumab | 23 | anti-α4-integrin | ITGA4; ITGB1; ITGB7 | antibody | mapped |
| 8 | cyclophosphamide | 19 | DNA inhibitor | — | small molecule | mapped |
| 9 | nabiximols | 19 | CB1 receptor inhibitor; CB1 receptor modulator | CNR1 | small molecule | manual |
| 10 | teriflunomide | 18 | DHODH inhibitor | DHODH | small molecule | mapped |
| 11 | glatiramer | 18 | — | — | — | unmapped |
| 12 | ofatumumab | 18 | anti-CD20 | MS4A1 | antibody | mapped |
| 13 | ublituximab | 14 | anti-CD20 | MS4A1 | antibody | mapped |
| 14 | rozanolixizumab | 13 | anti-FcRn | FCGRT | antibody | mapped |
| 15 | alemtuzumab | 12 | anti-CD52 | CD52 | antibody | mapped |
| 16 | prednisone | 11 | glucocorticoid receptor modulator | NR3C1 | small molecule | mapped |
| 17 | tolebrutinib | 11 | BTK inhibitor | BTK | small molecule | mapped |
| 18 | eculizumab | 11 | anti-C5 | C5 | antibody | mapped |
| 19 | peginterferon beta-1a | 11 | IFN-α/β receptor modulator | IFNAR1; IFNAR2 | protein | mapped |
| 20 | efgartigimod | 10 | anti-FcRn | FCGRT | protein | mapped |
| 21 | cladribine | 9 | DNA inhibitor | — | small molecule | mapped |
| 22 | satralizumab | 9 | anti-IL-6R | IL6R; IL6ST | antibody | mapped |
| 23 | daclizumab | 9 | anti-IL-2 receptor | IL2RA; IL2RB; IL2RG | antibody | mapped |
| 24 | fludarabine | 9 | DNA polymerase (alpha/delta/epsilon) inhibitor; Ribonucleoside-diphosphate reductase RR1 inhibitor | POLA1; POLA2; POLD1 … (14 genes) | small molecule | manual |
| 25 | interferon beta-1b | 8 | IFN-α/β receptor modulator | IFNAR1; IFNAR2 | protein | mapped |
| 26 | laquinimod | 8 | — | — | small molecule | unmapped |
| 27 | ravulizumab | 8 | anti-C5 | C5 | antibody | mapped |
| 28 | mycophenolate mofetil | 7 | IMPDH inhibitor | IMPDH1; IMPDH2 | small molecule | mapped |
| 29 | efgartigimod ph20 | 7 | anti-FcRn | FCGRT | protein | manual |
| 30 | zilucoplan | 7 | anti-C5 | C5 | protein | mapped |
| 31 | ozanimod | 7 | S1P receptor modulator | S1PR1; S1PR5 | small molecule | mapped |
| 32 | mesna | 6 | — | — | small molecule | unmapped |
| 33 | inebilizumab | 6 | anti-CD19 | CD19 | antibody | mapped |
| 34 | telitacicept | 6 | — | — | protein | unmapped |
| 35 | bg00002 | 5 | anti-α4-integrin | ITGA4; ITGB1; ITGB7 | antibody | manual |
| 36 | remibrutinib | 5 | — | — | small molecule | unmapped |
| 37 | tocilizumab | 5 | anti-IL-6R | IL6R | antibody | mapped |
| 38 | autologous mesenchymal stem cells | 5 | — | — | — | unmapped |
| 39 | fenebrutinib | 5 | BTK inhibitor | BTK | small molecule | mapped |
| 40 | opicinumab | 5 | anti-LINGO-1 | LINGO1 | antibody | mapped |
| 41 | empasiprubart | 5 | — | — | antibody | unmapped |
| 42 | memantine | 5 | NMDA receptor inhibitor | GRIN1; GRIN2A; GRIN2B … (7 genes) | small molecule | mapped |
| 43 | fampridine-sr | 5 | Kv channel inhibitor | KCNA1; KCNA10; KCNA2 … (40 genes) | small molecule | manual |
| 44 | mesenchymal stem cells | 5 | — | — | — | unmapped |
| 45 | pbr06 | 5 | — | — | — | unmapped |
| 46 | evobrutinib | 5 | BTK inhibitor | BTK | small molecule | mapped |
| 47 | gnbac1 | 4 | anti-syncytin-1 | ERVW-1 | antibody | mapped |
| 48 | orelabrutinib | 4 | BTK inhibitor | BTK | small molecule | mapped |
| 49 | acyclovir | 4 | DNA polymerase catalytic subunit inhibitor | — | small molecule | mapped |
| 50 | ponesimod | 4 | S1P receptor modulator | S1PR1 | small molecule | mapped |
| 51 | corticotropin | 4 | ACTH receptor modulator | MC2R | other | mapped |
| 52 | md1003 | 4 | — | — | — | unmapped |
| 53 | interferon beta 1a | 4 | IFN-α/β receptor modulator | IFNAR1; IFNAR2 | protein | manual |
| 54 | fampridine | 4 | Kv channel inhibitor | KCNA1; KCNA10; KCNA2 … (40 genes) | small molecule | mapped |
| 55 | mitoxantrone | 4 | DNA inhibitor; topoisomerase II inhibitor | TOP2A | small molecule | mapped |
| 56 | alemtuzumab gz402673 | 4 | anti-CD52 | CD52 | antibody | manual |
| 57 | paracetamol | 4 | COX inhibitor; Fatty-acid amide hydrolase 1 inhibitor; Transient receptor potential cation channel subfamily V member 1 activator | FAAH; PTGS1; PTGS2; TRPV1 | small molecule | mapped |
| 58 | ivig | 4 | — | — | — | unmapped |
| 59 | imu-838 | 4 | DHODH inhibitor | DHODH | small molecule | mapped |
| 60 | baf312 | 4 | S1P receptor modulator | S1PR1 | small molecule | mapped |

## 4. All 183 mechanism classes by trial count

A trial counts once in every class any of its drugs carries. Examples are the drugs with most trials in the class.

| class | trials | example drugs |
|---|---|---|
| anti-CD20 | 111 | ocrelizumab, rituximab, ofatumumab |
| IFN-α/β receptor modulator | 89 | interferon beta-1a, peginterferon beta-1a, interferon beta-1b |
| S1P receptor modulator | 72 | fingolimod, ozanimod, ponesimod |
| glucocorticoid receptor modulator | 53 | methylprednisolone, prednisone, corticosteroids |
| DNA inhibitor | 51 | cyclophosphamide, cladribine, mitoxantrone |
| anti-FcRn | 48 | rozanolixizumab, efgartigimod, efgartigimod ph20 |
| KEAP1 inhibitor | 37 | dimethyl fumarate, monomethyl fumarate, diroximel fumarate |
| anti-α4-integrin | 34 | natalizumab, bg00002, tysabri ® |
| BTK inhibitor | 28 | tolebrutinib, fenebrutinib, evobrutinib |
| anti-C5 | 28 | eculizumab, ravulizumab, zilucoplan |
| DHODH inhibitor | 25 | teriflunomide, imu-838, teriflunomide hmr1726 |
| Kv channel inhibitor | 24 | fampridine-sr, fampridine, dalfampridine |
| CB1 receptor inhibitor | 22 | nabiximols, cbd, cannabidiol oil |
| CB1 receptor modulator | 22 | nabiximols, thc, nabilone |
| anti-CD52 | 17 | alemtuzumab, alemtuzumab gz402673, mabcampath-1h |
| H1 receptor antagonist | 16 | clemastine fumarate, cetirizine, antihistamine |
| DNA polymerase (alpha/delta/epsilon) inhibitor | 15 | fludarabine, fludarabine for, cytarabine |
| anti-IL-6R | 15 | satralizumab, tocilizumab, tocilizumab injectable product |
| ACTH receptor modulator | 14 | corticotropin, acthar, acth |
| Ribonucleoside-diphosphate reductase RR1 inhibitor | 13 | fludarabine, hydroxyurea, fludarabine for |
| sodium channel inhibitor | 12 | riluzole, nerispirdine, lamotrigine |
| anti-CD19 | 11 | inebilizumab, blinatumomab, obexelimab |
| NMDA receptor antagonist | 10 | ads-5102, amantadine, neramexane mesylate |
| CD19 CAR-T | 10 | kyv-101, universal cd19 car-t, universal bcma car-t; universal cd19 car-t |
| topoisomerase II inhibitor | 10 | mitoxantrone, mitoxantrone liposome, etoposide |
| COX inhibitor | 10 | paracetamol, tylenol pill, naproxen |
| anti-IL-2 receptor | 10 | daclizumab, zenapax |
| dopamine transporter inhibitor | 9 | provigil, modafinil, methylphenidate |
| IMPDH inhibitor | 8 | mycophenolate mofetil, mycophenolic acid |
| HMG-CoA reductase inhibitor | 8 | atorvastatin, simvastatin, pravastatin |
| BCMA CAR-T | 8 | cd20/bcma-directed car-t cells, universal bcma car-t; universal cd19 car-t, universal bcma car-t |
| noradrenaline transporter inhibitor | 8 | methylphenidate, duloxetine, venlafaxine |
| NMDA receptor inhibitor | 7 | memantine, ketamine |
| G-CSF receptor modulator | 7 | g-csf, filgrastim, granulocyte-colony stimulating factor and prednisone |
| anti-syncytin-1 | 6 | gnbac1, temelimab |
| DNA polymerase catalytic subunit inhibitor | 6 | acyclovir, famciclovir, aciclovir |
| FKBP12 inhibitor | 6 | tacrolimus, sirolimus, interferon beta-1b and tacrolimus |
| Bacterial 70S ribosome inhibitor | 6 | minocycline, interferon beta 1a, doxycycline, gentamicin |
| serotonin transporter inhibitor | 6 | fluoxetine, duloxetine, venlafaxine |
| anti-CD3 | 5 | blinatumomab, talquetamab, foralumab tzls-401 100 μg |
| vitamin D receptor modulator | 5 | vitamin d, vigantol oil plus interferon beta-1a, colecalciferol |
| estrogen receptor modulator | 5 | vaginal estriol, microgynon®, estriol |
| Glycerol-3-phosphate dehydrogenase, mitochondrial inhibitor | 5 | metformin, metformin and clemastine in combination, metformin , up to 4 a day |
| Mitochondrial complex I (NADH dehydrogenase) inhibitor | 5 | metformin, metformin and clemastine in combination, metformin , up to 4 a day |
| Matrix protein 2 inhibitor | 5 | ads-5102, amantadine |
| anti-LINGO-1 | 5 | opicinumab |
| androgen receptor modulator | 5 | xyosted 75 milligram in auto-injector, testosterone undecanoate, nebido® testosterone undecanoate / solution for |
| GABA-B receptor modulator | 5 | arbaclofen, kemstro, arbaclofen er |
| Transient receptor potential cation channel subfamily V member 1 activator | 5 | paracetamol, tylenol pill |
| Fatty-acid amide hydrolase 1 inhibitor | 5 | paracetamol, tylenol pill |
| anti-BAFF | 5 | belimumab, atacicept, ly2127399 |
| α2-adrenergic receptor modulator | 5 | tizanidine, sublingual tizanidine, guanabenz |
| anti-RGMa | 4 | elezanumab, abt-555 |
| Sigma non-opioid intracellular receptor 1 modulator | 4 | dextromethorphan hydrobromide and quinidine, dextromethorphan, avp-923-45 |
| Amidophosphoribosyltransferase inhibitor | 4 | azathioprine, immediate azathioprine |
| anti-IL-17A | 4 | ain457, secukinumab |
| DHFR inhibitor | 4 | methotrexate, intrathecal methotrexate |
| AChE inhibitor | 4 | pyridostigmine, donepezil hci, donepezil |
| Mast/stem cell growth factor receptor Kit inhibitor | 4 | masitinib, imatinib mesylate |
| EPO receptor modulator | 3 | erythropoietin alfa, erythropoietin, epo |
| IL-2 receptor modulator | 3 | interleukin-2, il2, il-2 |
| progesterone receptor modulator | 3 | norethindrone, nomegestrol, microgynon® |
| anti-CD38 | 3 | tak-079, ofatumumab combined with daratumumab, daratumumab |
| α4-integrin antagonist | 3 | firategrast, firategrast modified release, firategrast immediate release |
| D2 receptor antagonist | 3 | domperidone, extended-release quetiapine fumarate |
| CD20 CAR-T | 3 | cd20/bcma-directed car-t cells, cd20/bcma-directed car-t cells autologous 2nd generation |
| RNA inhibitor | 3 | cytarabine, carmustine, etoposide, cytarabine, and melphalan, carmustine |
| Glutathione reductase, mitochondrial inhibitor | 3 | carmustine, etoposide, cytarabine, and melphalan, carmustine, beam regimen |
| β2-adrenergic receptor modulator | 3 | salbutamol, isoxsuprine, albuterol |
| 26S proteasome inhibitor | 3 | bortezomib |
| melatonin receptor modulator | 3 | melatonin |
| α1-adrenergic receptor antagonist | 3 | tamsulosin, silodosin, isoxsuprine |
| Platelet-derived growth factor receptor inhibitor | 3 | masitinib |
| Fibroblast growth factor receptor 3 inhibitor | 3 | masitinib |
| proton pump inhibitor | 3 | pantoprazole, omeprazole, esomeprazole |
| PPARγ modulator | 3 | pioglitazone, int131, actos |
| Bile acids agent | 3 | cholestyramine |
| Bacterial DNA-directed RNA polymerase inhibitor | 2 | rifampin, rifampicin |
| PDE4 inhibitor | 2 | rolipram, ibudilast |
| Human immunodeficiency virus type 1 reverse transcriptase inhibitor | 2 | truvada, tenofovir alafenamide fumarate |
| muscarinic receptor antagonist | 2 | solifenacin succinate, darifenacin |
| β3-adrenergic receptor modulator | 2 | mirabegron |
| BAFF-R CAR-T | 2 | baff-r cart, anti-baffr cart |
| anti-CD86 | 2 | abatacept |
| anti-CD80 | 2 | abatacept |
| Aromatic-L-amino-acid decarboxylase inhibitor | 2 | lodosyn, carbidopa |
| anti-α2-integrin | 2 | vatelizumab |
| Spike glycoprotein vaccine antigen | 2 | mrna-1273, bnt162b2 |
| anti-Nogo-A | 2 | gsk1223249 |
| anti-PD-1 | 2 | nivolumab |
| H2 receptor antagonist | 2 | ranitidine |
| GABA-A receptor modulator | 2 | midazolam |
| Tyrosine-protein kinase JAK1 inhibitor | 2 | ruxolitinib, baricitinib |
| Tyrosine-protein kinase JAK2 inhibitor | 2 | ruxolitinib, baricitinib |
| Carbonic anhydrase 4 inhibitor | 2 | avonex and topamax, acetazolamide |
| Carbonic anhydrase 2 inhibitor | 2 | avonex and topamax, acetazolamide |
| Glutamate receptor ionotropic AMPA antagonist | 2 | bgg492, avonex and topamax |
| Glutamate receptor ionotropic kainate antagonist | 2 | bgg492, avonex and topamax |
| α4-integrin inhibitor | 2 | cdp323 |
| calcium channel modulator | 2 | gabapentin |
| anti-APRIL | 2 | atacicept |
| Solute carrier family 12 member 3 inhibitor | 2 | indapamide pill, indapamide |
| cGMP-inhibited 3',5'-cyclic phosphodiesterase 3A inhibitor | 2 | ibudilast, cilostazol |
| Toll-like receptor 9 antagonist | 2 | hydroxychloroquine pill, hydroxychloroquine |
| Ferriprotoporphyrin IX inhibitor | 2 | hydroxychloroquine pill, hydroxychloroquine |
| Toll-like receptor 7 antagonist | 2 | hydroxychloroquine pill, hydroxychloroquine |
| anti-IL-23 | 2 | cnto 1275, abt-874/human monoclonal antibody against il-12 |
| anti-IL-12 | 2 | cnto 1275, abt-874/human monoclonal antibody against il-12 |
| α9/α10 nicotinic receptor antagonist | 1 | neramexane mesylate |
| PPARα modulator | 1 | gemfibrozil |
| insulin receptor modulator | 1 | insulin |
| DNA polymerase/reverse transcriptase inhibitor | 1 | truvada |
| anti-G-protein coupled receptor family C group 5 member D | 1 | talquetamab |
| Sulfonylurea receptor 1, Kir6.2 inhibitor | 1 | glibenclamide |
| Complement factor B inhibitor | 1 | iptacopan |
| Synaptic vesicle glycoprotein 2A modulator | 1 | levetiracetam |
| Voltage-dependent N-type calcium channel subunit alpha-1B inhibitor | 1 | levetiracetam |
| Cysteinyl leukotriene receptor 1 antagonist | 1 | montelukast |
| Iron agent | 1 | dexrazoxane plus mitoxantrone |
| Vascular endothelial growth factor receptor 2 inhibitor | 1 | cabozantinib |
| anti-CTLA-4 | 1 | ipilimumab |
| Hepatocyte growth factor receptor inhibitor | 1 | cabozantinib |
| Monoglyceride lipase inhibitor | 1 | abx-1431 |
| Neutrophil elastase inhibitor | 1 | sivelestat hydrate |
| GABA-A receptor positive modulator | 1 | avonex and topamax |
| anti-Tumor necrosis factor ligand superfamily member 14 | 1 | baminercept |
| anti-Heterotrimeric lymphotoxin LTa1b2 | 1 | baminercept |
| GM-CSF receptor modulator | 1 | granulocyte-macrophage colony-stimulating factor |
| Carbonic anhydrase 12 inhibitor | 1 | acetazolamide |
| Carbonic anhydrase 1 inhibitor | 1 | acetazolamide |
| anti-CCR2 | 1 | mln1202 |
| CCR2 antagonist | 1 | mk0812 |
| Interstitial collagenase inhibitor | 1 | interferon beta 1a, doxycycline |
| Neutrophil collagenase inhibitor | 1 | interferon beta 1a, doxycycline |
| Matrilysin inhibitor | 1 | interferon beta 1a, doxycycline |
| Collagenase 3 inhibitor | 1 | interferon beta 1a, doxycycline |
| α1-adrenergic receptor modulator | 1 | alfuzosin |
| Tyrosine-protein kinase ABL1 inhibitor | 1 | imatinib mesylate |
| Platelet-derived growth factor receptor beta inhibitor | 1 | imatinib mesylate |
| Bcr/Abl fusion protein inhibitor | 1 | imatinib mesylate |
| Amiloride-sensitive sodium channel, ENaC inhibitor | 1 | amiloride |
| anti-FcγRIIb | 1 | obexelimab |
| TSPO modulator | 1 | xbd173 |
| GABA-A receptor antagonist | 1 | etifoxine |
| CD19 modulator | 1 | obecabtagene autoleucel |
| Vecuronium agent | 1 | sugammadex |
| Rocuronium agent | 1 | sugammadex |
| Fibroblast growth factor receptor 2 modulator | 1 | palifermin |
| Human immunodeficiency virus type 1 integrase inhibitor | 1 | raltegravir |
| cAMP and cAMP-inhibited cGMP 3',5'-cyclic phosphodiesterase 10A inhibitor | 1 | ibudilast |
| cGMP-specific 3',5'-cyclic phosphodiesterase inhibitor | 1 | ibudilast |
| Hyaluronic acid agent | 1 | rhuph20 |
| Inositol monophosphatase 1 inhibitor | 1 | lithium carbonate |
| Glycogen synthase kinase-3 inhibitor | 1 | lithium carbonate |
| COX-2 inhibitor | 1 | celecoxib |
| Peptidoglycan inhibitor | 1 | vancomycin |
| Farnesyl pyrophosphate synthase inhibitor | 1 | zoledronic acid |
| anti-BAFF-R | 1 | vay736 |
| anti-SNAP-25 | 1 | botulinum toxin type a |
| Tyrosine-protein kinase JAK3 inhibitor | 1 | ruxolitinib |
| Non-receptor tyrosine-protein kinase TYK2 inhibitor | 1 | ruxolitinib |
| Synaptic vesicular amine transporter inhibitor | 1 | lisdexamfetamine |
| dopamine transporter agent | 1 | lisdexamfetamine |
| noradrenaline transporter agent | 1 | lisdexamfetamine |
| Complement C5 mRNA silencer | 1 | pozelimab + cemdisiran, cemdisiran |
| GLP-1 receptor modulator | 1 | liraglutide pen injector |
| Vitamin K epoxide reductase complex subunit 1 inhibitor | 1 | s-warfarin |
| Fast skeletal troponin complex activator | 1 | ck-2017357 |
| anti-IL-1 receptor | 1 | anakinra |
| Thyroid hormone receptor modulator | 1 | liothyronine |
| 5-hydroxytryptamine receptor 2A antagonist | 1 | extended-release quetiapine fumarate |
| 5-hydroxytryptamine receptor 2C antagonist | 1 | extended-release quetiapine fumarate |
| JAK inhibitor | 1 | tofacitinib |
| Ryanodine receptor 1 antagonist | 1 | dantrolene |
| Ryanodine receptor 3 antagonist | 1 | dantrolene |
| Orexin receptor antagonist | 1 | suvorexant |
| SNAP-25 inhibitor | 1 | onabotulinumtoxina |
| opioid receptor antagonist | 1 | low-dose naltrexone |
| anti-VEGF-A | 1 | bevacizumab |
| cholinesterase inhibitor | 1 | rivastigmine transdermal patch |
| H3 receptor antagonist | 1 | gsk239512 |
| anti-SEMA4D | 1 | vx15/2503 |
| anti-GM-CSF | 1 | mor103 |
