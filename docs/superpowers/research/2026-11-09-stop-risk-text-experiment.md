# Text features for stop-risk: experiment report

Split/labels/structured features identical to train_stop_risk.py (train 41,564 starts <=2015, test 19,782 / 3,392 stopped, 2016-2019). Single isotonic-calibrated HGB per variant (no bootstrap). Text = titles + primary outcomes (measure, description, timeframe) + eligibility; no summary/description/why_stopped/results. Stop words scrubbed.
Script/logs: prep.py, common.py, embed.py, exp.py, results.jsonl in this directory.

| Variant | AUC | Brier | In-area AUC (n=141) |
|---|---|---|---|
| A structured (seed 42) | 0.682 | 0.1347 | 0.539 |
| A structured (seed 7)  | 0.687 | 0.1343 | 0.591 |
| B +TF-IDF(1-2gram, 50k)->SVD150 | 0.699 | 0.1333 | 0.736 |
| C +PubMedBERT emb, PCA64 | 0.694 | 0.1339 | 0.606 |
| C raw 768 dims | 0.688 | 0.1349 | 0.565 |
| D B + C(pca64) | 0.701 | 0.1332 | 0.641 |

Seed noise on A alone is ~0.005 AUC (and 0.05 on in-area AUC, n=141 so in-area is meaningless as evidence). Gain of best variants over A mean (0.685): about +0.015 to +0.017. Misses the +0.03 bar.

## Leak checks
1. Stop-words (terminat*, withdraw*, stopp*, halt*, suspend*, early termination, slow/poor/low accrual, lack of enrollment, sponsor decision) in raw text: 1,569 of 9,254 stopped (17.0%) vs 6,954 of 52,092 completed (13.3%). Per-field [stopped, completed] counts: title 80/494, outcomes 567/2027, eligibility 1018/4826 (mostly "withdraw consent"). Only a weak label difference; no sign of text edited at the end.
2. B with words left in: AUC 0.701 vs 0.699 scrubbed (+0.002, within noise). No jump. (Done on B, not D.)
3. Field ablation (B-style, one field only; A ~0.685): title 0.684, outcomes 0.684, eligibility 0.693. Eligibility carries essentially all of the gain; title/outcomes alone add nothing. Gain is likely proxy for era/sponsor/design style that structured features lack.
4. Shuffled train text (test text real): AUC 0.670 (below A; gain gone, slightly harmful). Pass.

## Timings / cost
- PubMedBERT (NeuML/pubmedbert-base-embeddings, MPS, max 256 tokens, batch 64): 61,346 trials (all train + all test, no subsampling) in 1,354 s = 22 ms/trial = ~22 s per 1k. Scoring ~200 running trials: ~5 s on MPS plus ~10 s model load (CPU likely 5-10x slower: ~1 min; fine). First-time model download.
- TF-IDF+SVD: fit ~1 min on train; scoring 200 trials is milliseconds.
- Model fit with text: 10-20 s per single model (similar to A).
- Dependencies: torch ~600 MB site-packages (+ sentence-transformers, transformers); model download 419 MB. Would bloat CI/daily run for a +0.005 gain over B. B needs only scikit-learn (already a dependency) but adds fitted TfidfVectorizer+SVD artefacts (tens of MB for 50k vocab; could shrink) and loses the current "start-time facts only" explainability.

## Recommendation
Adopt none. Best variants (B 0.699, D 0.701) improve AUC by about +0.015-0.017 over like-for-like A, below the +0.03 bar, though leak checks are clean. C adds little over B and costs torch + 419 MB model; D adds +0.002 over B. If anything is revisited, B (eligibility TF-IDF only) is the cheap option; re-evaluate with 20-bootstrap and several seeds before deciding.
