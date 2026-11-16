"""Trial age as a stop-risk factor (research note 2026-11-16-trial-age-factor.md).
Run from pipeline/: uv run python ../docs/superpowers/research/2026-11-16-trial-age-factor.py ../config/risk
"""
import sys
from pathlib import Path
import numpy as np, polars as pl
pl.Config.set_tbl_rows(50)
from trialradar.risk.artefacts import load, feature_matrix
from trialradar.risk.explain import contributions
L = load(Path(sys.argv[1]))
ens = L.shipped
d = pl.read_parquet(Path(sys.argv[1]) / "heldout.parquet")
cols = list(ens.columns)
print("columns has age:", "age_months" in cols, "n cols", len(cols))
X = feature_matrix(d, cols)
p, lo, hi = ens.predict(X)
C = contributions(ens, X)
ai = cols.index("age_months")
d = d.with_columns(pl.Series("p", p), pl.Series("c_age", C[:, ai]),
    pl.when(pl.col("phase_3") == 1).then(pl.lit("P3")).when(pl.col("phase_2") == 1).then(pl.lit("P2")).otherwise(pl.lit("P1")).alias("ph"))
bands = [0, 6, 12, 24, 36, 60, 1e9]
names = ["<6m", "6-12m", "12-24m", "24-36m", "36-60m", "60m+"]
d = d.with_columns(pl.col("age_months").cut(bands[1:-1], labels=names, left_closed=True).alias("age"))
print("\nObserved stop rate (label=1) and mean estimate, by trial age at Dec 2021, all phases:")
print(d.group_by("age").agg(n=pl.len(), stop_rate=pl.col("label").mean().round(3), mean_p=pl.col("p").mean().round(3), mean_age_contrib=pl.col("c_age").mean().round(3)).sort("age"))
print("\nBy phase:")
print(d.group_by(["ph","age"]).agg(n=pl.len(), stop_rate=pl.col("label").mean().round(3), mean_p=pl.col("p").mean().round(3), age_c=pl.col("c_age").mean().round(3)).sort(["ph","age"]))
rank = np.argsort(-np.abs(C), axis=1)[:, :3]
top_age = (rank == ai).any(axis=1)
d = d.with_columns(pl.Series("age_top3", top_age))
hi20 = d.sort("p", descending=True).head(int(len(d)*0.05))
print("\nTop 5% estimates: share with age in top-3 factors:", round(hi20["age_top3"].mean(),3), " median age months:", hi20["age_months"].median(), " vs all:", d["age_months"].median())
print("age in top-3 overall:", round(d["age_top3"].mean(),3), " positive age contrib share among those:", round(d.filter(pl.col("age_top3"))["c_age"].gt(0).mean(),3))
print("\nYoung (<12m) by planned duration (months) — test trials, all of which ended by Jan 2026:")
dd = d.filter(pl.col("age_months") < 12).with_columns(pl.col("planned_duration_months").cut([24, 36, 48], labels=["<24","24-36","36-48","48+"]).alias("dur"))
print(dd.group_by("dur").agg(n=pl.len(), stop_rate=pl.col("label").mean().round(3), mean_p=pl.col("p").mean().round(3)).sort("dur"))
print("\nOld (>=36m) by planned duration:")
do = d.filter(pl.col("age_months") >= 36).with_columns(pl.col("planned_duration_months").cut([24, 36, 48], labels=["<24","24-36","36-48","48+"]).alias("dur"))
print(do.group_by("dur").agg(n=pl.len(), stop_rate=pl.col("label").mean().round(3), mean_p=pl.col("p").mean().round(3)).sort("dur"))
