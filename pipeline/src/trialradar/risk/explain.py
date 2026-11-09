"""Per-trial explanations: feature contributions and plain-language top factors."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass

import numpy as np
import shap

from trialradar.risk.model import Ensemble

__all__ = ["FactorLabel", "contributions", "top_factors"]

SPONSOR_FEATURES = ("sponsor_prior_n", "sponsor_prior_rate", "sponsor_few_prior")


@dataclass(frozen=True)
class FactorLabel:
    """Templates for one feature; `{value}` is replaced with the trial's value."""

    feature: str
    up: str
    down: str


def contributions(ens: Ensemble, X: np.ndarray) -> np.ndarray:
    """Per-row, per-column contributions (n x len(columns)); positive pushes toward stopping.

    Baseline: coefficient x standardised value (zeros for unused columns). Boosted: SHAP
    values of the uncalibrated booster, so they explain the pre-calibration margin
    (log-odds), not the calibrated probability.
    """
    out = np.zeros((len(X), len(ens.columns)))
    main = ens.main
    idx = list(main.idx)
    if ens.recipe == "baseline":
        pipe = main.estimator
        z = pipe.named_steps["scale"].transform(pipe.named_steps["impute"].transform(X[:, idx]))
        out[:, idx] = z * pipe.named_steps["lr"].coef_[0]
        return out
    sv = shap.TreeExplainer(main.booster).shap_values(X)
    sv = np.asarray(sv)
    if sv.ndim == 3:  # (n, features, classes) in some shap versions
        sv = sv[:, :, 1]
    out[:, idx] = sv
    return out


def _fmt(v: float) -> str:
    return str(int(v)) if float(v).is_integer() else f"{v:.2f}"


def top_factors(
    contrib_row: np.ndarray,
    x_row: np.ndarray,
    columns: Sequence[str],
    labels: Mapping[str, FactorLabel],
    k: int = 3,
) -> list[dict[str, str]]:
    """Top `k` factors by |contribution|, as `{"label", "dir"}` (dir is "up" or "down").

    Zero contributions and features without a label are skipped. The three sponsor
    features collapse into one factor with fixed copy. The stopped count is derived as
    round(sponsor_prior_rate x sponsor_prior_n), since the feature frame carries a rate.
    """
    col = {c: i for i, c in enumerate(columns)}
    out: list[dict[str, str]] = []
    sponsor_done = False
    for i in np.argsort(-np.abs(contrib_row), kind="stable"):
        c = float(contrib_row[i])
        if c == 0.0 or len(out) >= k:
            continue
        name = columns[int(i)]
        direction = "up" if c > 0 else "down"
        if name in SPONSOR_FEATURES:
            if sponsor_done:
                continue
            sponsor_done = True
            few = "sponsor_few_prior" in col and x_row[col["sponsor_few_prior"]] == 1
            if few:
                label = "Sponsor has few earlier finished trials"
            elif "sponsor_prior_n" in col and "sponsor_prior_rate" in col:
                n = round(float(x_row[col["sponsor_prior_n"]]))
                kk = round(float(x_row[col["sponsor_prior_rate"]]) * n)
                label = f"Sponsor's earlier trials: {kk} of {n} stopped early (registry)"
            else:
                continue
            out.append({"label": label, "dir": direction})
            continue
        lab = labels.get(name)
        if lab is None:
            continue
        template = lab.up if c > 0 else lab.down
        out.append(
            {"label": template.replace("{value}", _fmt(float(x_row[int(i)]))), "dir": direction}
        )
    return out
