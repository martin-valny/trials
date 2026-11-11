# Mechanism layout weight — choice (2026-11-07)

Snapshot: real 2026-11-06 raw snapshot (2,987 trials; mapping coverage 63.8% of drug-bearing trials). Command:

```
cd pipeline && uv run python scripts/cluster_report.py <raw dir> --weight-mechanism 0 0.5 1.0 1.5 --k 14
```

**Chosen: 1.0** (the default). Rule from the plan: the smallest weight at which the big MS drug clusters split by mechanism class while each cluster keeps a dominant disease (top share ≥ 0.6).
- 0 and 0.5: drug clusters stay mixed (top mechanism ≤ 42%).
- **1.0: mechanism-pure clusters appear**: anti-CD20 100% (99 trials), anti-FcRn 57% (CIDP/MG), anti-C5 (MG), anti-α4-integrin; disease shares stay ≥ 0.6 except the inherently mixed small-disease cluster (CIDP 59%).
- 1.5: disease separation starts dissolving (an MG-led cluster at 42%, a 659-trial mixed MS drug blob).

KMeans here is only a diagnostic; the map itself names HDBSCAN clusters.

## The neighbourhood statistic before and after the mechanism block (2026-11-07)

Real 2026-11-06 snapshot, `trialradar rebuild` into scratch dirs (pool 478, 62 succeeded, 10,000 shuffles, k = 10):

| statistic computed on | lift | shuffled range | p | verdict |
|---|---|---|---|---|
| layout features at mechanism weight 0 (as before phase 2) | 1.32 | 0.62–1.41 | 0.061 | chance |
| layout features at mechanism weight 1.0 | 0.71 | 0.63–1.39 | 0.94 | chance |
| **shipped:** layout at 1.0, statistic without the mechanism block (`stat_features`) | **1.32** | **0.62–1.41** | **0.061** | chance |

With the mechanism block, same-mechanism trials become each other's neighbours, and the drug-sharing exclusion does not remove them (different drugs, same class), so the statistic starts measuring whether a mechanism class works rather than whether similar trials succeed together. Martin's call: the statistic keeps its own feature set (disease, treatment type, molecule, population); mechanisms are answered by panel b's By mechanism view.

## Tables

```
warning: mechanism_unmapped: 414 drugs (476 trials)
== mechanism weight 0 (2987 trials, KMeans k=14)
 size  top disease                     %  top type                %  top mechanism (of drug-bearing)         %  top drugs
  394  Multiple sclerosis            99%  BEHAVIORAL            98%  -                                      0%  
  372  Multiple sclerosis           100%  DRUG                 100%  IFN-α/β receptor modulator             7%  methylprednisolone, peginterferon beta-1a, ozanimod
  328  Multiple sclerosis           100%  DRUG                  97%  BTK inhibitor                          8%  teriflunomide, glatiramer, rituximab
  311  Multiple sclerosis           100%  OTHER                 90%  COX inhibitor                          9%  allogeneic human umbilical cord tissue-derived mesenchymal stem cells, anti-mullerian hormone level, aspirin
  254  Multiple sclerosis           100%  DEVICE                90%  GABA-B receptor modulator             19%  arbaclofen, smoked cannabis, tizanidine
  238  Multiple sclerosis           100%  OTHER                100%  -                                      0%  
  237  NMOSD                         45%  DRUG                  66%  anti-FcRn                             13%  rozanolixizumab, rituximab, satralizumab
  210  Myasthenia gravis             90%  DRUG                  66%  anti-FcRn                             18%  nabiximols, efgartigimod, eculizumab
  209  Multiple sclerosis           100%  BIOLOGICAL            62%  anti-CD20                             32%  ocrelizumab, interferon beta-1a, ofatumumab
  131  Multiple sclerosis           100%  DRUG                  98%  IFN-α/β receptor modulator            20%  interferon beta-1b, opicinumab, alemtuzumab
   95  Multiple sclerosis            93%  DRUG                  99%  S1P receptor modulator                42%  fingolimod, dimethyl fumarate, natalizumab
   70  Multiple sclerosis           100%  PROCEDURE             93%  -                                      0%  
   70  Multiple sclerosis           100%  OTHER                 87%  -                                      0%  blood sample
   68  Multiple sclerosis            99%  DIAGNOSTIC_TEST       49%  -                                      0%  

== mechanism weight 0.5 (2987 trials, KMeans k=14)
 size  top disease                     %  top type                %  top mechanism (of drug-bearing)         %  top drugs
  395  Multiple sclerosis            99%  BEHAVIORAL            98%  -                                      0%  
  357  Multiple sclerosis           100%  DRUG                  97%  IFN-α/β receptor modulator            12%  methylprednisolone, tolebrutinib, daclizumab
  346  Multiple sclerosis           100%  DRUG                 100%  IFN-α/β receptor modulator             7%  glatiramer, peginterferon beta-1a, ozanimod
  263  Multiple sclerosis           100%  DEVICE                98%  -                                      0%  anticholinergic medication, cannabis, medical
  250  Multiple sclerosis           100%  OTHER                 91%  COX inhibitor                         17%  allogeneic human umbilical cord tissue-derived mesenchymal stem cells, aspirin, autologous bone marrow-derived mononuclear stem cells
  247  Multiple sclerosis            97%  BIOLOGICAL            55%  anti-CD20                             19%  nabiximols, ofatumumab, ublituximab
  244  NMOSD                         38%  DRUG                  82%  anti-CD20                             15%  rituximab, teriflunomide, rozanolixizumab
  219  Multiple sclerosis           100%  OTHER                100%  -                                      0%  
  183  Myasthenia gravis             99%  DRUG                  61%  anti-FcRn                             21%  efgartigimod, telitacicept, efgartigimod ph20
  145  Multiple sclerosis            99%  DRUG                  96%  IFN-α/β receptor modulator            23%  interferon beta-1a, alemtuzumab, opicinumab
  128  Multiple sclerosis           100%  DRUG                  98%  S1P receptor modulator                33%  fingolimod, ocrelizumab, dimethyl fumarate
   97  Multiple sclerosis            96%  PROCEDURE             72%  -                                      0%  
   63  Multiple sclerosis           100%  OTHER                 86%  -                                      0%  blood sample
   50  Multiple sclerosis            98%  DIAGNOSTIC_TEST       64%  -                                      0%  

== mechanism weight 1 (2987 trials, KMeans k=14)
 size  top disease                     %  top type                %  top mechanism (of drug-bearing)         %  top drugs
  469  Multiple sclerosis            99%  DRUG                  99%  Kv channel inhibitor                   6%  alemtuzumab, glatiramer, cyclophosphamide
  404  Multiple sclerosis           100%  BEHAVIORAL            96%  -                                      0%  
  347  Multiple sclerosis            99%  DRUG                  95%  glucocorticoid receptor modulator      9%  nabiximols, methylprednisolone, teriflunomide
  278  Myasthenia gravis             62%  DRUG                  72%  anti-C5                               14%  eculizumab, satralizumab, ravulizumab
  277  Multiple sclerosis           100%  OTHER                100%  -                                      0%  
  251  Multiple sclerosis            98%  BIOLOGICAL            49%  anti-α4-integrin                      23%  natalizumab, autologous mesenchymal stem cells, bg00002
  230  Multiple sclerosis           100%  DEVICE                98%  -                                      0%  
  190  Multiple sclerosis           100%  OTHER                 88%  COX inhibitor                         17%  allogeneic human umbilical cord tissue-derived mesenchymal stem cells, aspirin, autologous bone marrow-derived mononuclear stem cells
  149  Multiple sclerosis            99%  DRUG                  99%  IFN-α/β receptor modulator            43%  fingolimod, dimethyl fumarate, interferon beta-1a
   99  Multiple sclerosis            88%  DRUG                  91%  anti-CD20                            100%  ocrelizumab, rituximab, ofatumumab
   98  Multiple sclerosis            96%  PROCEDURE             71%  -                                      0%  
   95  CIDP                          59%  DRUG                  60%  anti-FcRn                             57%  rozanolixizumab, efgartigimod, efgartigimod ph20
   68  Multiple sclerosis           100%  OTHER                 87%  -                                      0%  blood sample
   32  Multiple sclerosis            97%  DIAGNOSTIC_TEST      100%  -                                      0%  

== mechanism weight 1.5 (2987 trials, KMeans k=14)
 size  top disease                     %  top type                %  top mechanism (of drug-bearing)         %  top drugs
  659  Multiple sclerosis            99%  DRUG                  99%  DNA inhibitor                          4%  alemtuzumab, glatiramer, cyclophosphamide
  426  Multiple sclerosis           100%  BEHAVIORAL            96%  -                                      0%  
  411  Myasthenia gravis             42%  DRUG                  74%  glucocorticoid receptor modulator     11%  methylprednisolone, eculizumab, cyclophosphamide
  350  Multiple sclerosis           100%  OTHER                 99%  anti-GM-CSF                           20%  anti-mullerian hormone level, bacille of calmette-guerin, intrathecal msc-np
  259  Multiple sclerosis           100%  DEVICE                98%  -                                      0%  vsn16r
  184  Multiple sclerosis           100%  OTHER                 92%  COX inhibitor                         17%  allogeneic human umbilical cord tissue-derived mesenchymal stem cells, aspirin, autologous bone marrow-derived mononuclear stem cells
  128  Multiple sclerosis            99%  DRUG                  95%  IFN-α/β receptor modulator            58%  interferon beta-1a, natalizumab, teriflunomide
  115  Multiple sclerosis            95%  BIOLOGICAL            95%  BCMA CAR-T                             3%  autologous mesenchymal stem cells, mesenchymal stem cells, neurovax
  101  Multiple sclerosis            87%  DRUG                  91%  anti-CD20                            100%  ocrelizumab, rituximab, ofatumumab
   97  Multiple sclerosis            96%  PROCEDURE             72%  -                                      0%  
   86  Multiple sclerosis            99%  DRUG                 100%  S1P receptor modulator                58%  fingolimod, dimethyl fumarate, mt-1303-high
   84  Multiple sclerosis            43%  DIAGNOSTIC_TEST       38%  anti-FcRn                            100%  rozanolixizumab, efgartigimod, efgartigimod ph20
   63  Multiple sclerosis           100%  OTHER                 86%  -                                      0%  blood sample
   24  Multiple sclerosis            96%  DRUG                 100%  CB1 receptor inhibitor                92%  nabiximols, cannabidiol, cannabidiol oil
```
