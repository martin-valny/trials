"""Per-trial explanations: feature contributions and plain-language top factors."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass

import numpy as np
import shap

from trialradar.risk.model import Ensemble

__all__ = ["KINDS", "FactorLabel", "contributions", "top_factors"]

SPONSOR_FEATURES = ("sponsor_prior_n", "sponsor_prior_rate", "sponsor_few_prior")
# Shift the estimate but are never given as a reason. Live start years are clamped to the
# shipped refit's last start year (2019), so "start year 2019" would not be the trial's own.
HIDDEN_FEATURES = frozenset({"start_year"})


KINDS = frozenset({"count", "binary", "phase", "category", "sponsor"})
PHASE_FEATURES = ("phase_1", "phase_2", "phase_3")


@dataclass(frozen=True)
class FactorLabel:
    """How one feature is put into words. The text always describes the trial's own value;
    the sign of the contribution only sets "raises" or "lowers".

    kind  count     `text` with `{value}` replaced by the count ("Sites planned: {value}")
          binary    `yes` when the value is 1, `no` when it is 0
          phase     `text` with `{value}` replaced by the trial's phases ("Phase {value} trial")
          category  `yes` when the trial is filed under the category; never shown when absent
          sponsor   fixed copy built in code (the three sponsor features give one factor)
    """

    feature: str
    kind: str
    yes: str = ""
    no: str = ""
    text: str = ""


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


def _phases(x_row: np.ndarray, col: Mapping[str, int]) -> str:
    """The trial's phases from its one-hot columns, e.g. "1/2"; "" when none is set."""
    return "/".join(f[-1] for f in PHASE_FEATURES if f in col and float(x_row[col[f]]) == 1.0)


def _sponsor_label(x_row: np.ndarray, col: Mapping[str, int]) -> str | None:
    if "sponsor_few_prior" in col and x_row[col["sponsor_few_prior"]] == 1:
        return "Sponsor has few earlier finished trials"
    if "sponsor_prior_n" in col and "sponsor_prior_rate" in col:
        n = round(float(x_row[col["sponsor_prior_n"]]))
        kk = round(float(x_row[col["sponsor_prior_rate"]]) * n)
        return f"Sponsor's earlier trials: {kk} of {n} stopped early (registry)"
    return None


def _label(
    name: str, value: float, lab: FactorLabel, x_row: np.ndarray, col: Mapping[str, int]
) -> str | None:
    """The words for one feature at the trial's value, or None when there is nothing to say."""
    if lab.kind == "phase":
        phases = _phases(x_row, col)
        return lab.text.replace("{value}", phases) if phases and lab.text else None
    if np.isnan(value):
        return None  # a missing value has no words; never describe it
    if lab.kind == "count":
        return lab.text.replace("{value}", _fmt(value)) or None
    if lab.kind == "category":
        return (lab.yes or None) if value > 0 else None  # absence of a category is not a reason
    if lab.kind == "binary":
        return (lab.yes if value > 0 else lab.no) or None
    return None


def top_factors(
    contrib_row: np.ndarray,
    x_row: np.ndarray,
    columns: Sequence[str],
    labels: Mapping[str, FactorLabel],
    k: int = 3,
) -> list[dict[str, str]]:
    """Top `k` factors by |contribution|, as `{"label", "dir"}` (dir is "up" or "down").

    The label describes the trial's value (see FactorLabel); only `dir` follows the sign.
    Zero contributions, features without a label, missing values, absent `cat_*` condition
    categories and HIDDEN_FEATURES are skipped, and a label already given is not repeated
    (two phase features on one trial read the same). The three sponsor features collapse
    into one factor with fixed copy. The stopped count is derived as
    round(sponsor_prior_rate x sponsor_prior_n), since the feature frame carries a rate.
    """
    col = {c: i for i, c in enumerate(columns)}
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for i in np.argsort(-np.abs(contrib_row), kind="stable"):
        c = float(contrib_row[i])
        if c == 0.0 or len(out) >= k:
            continue
        name = columns[int(i)]
        if name in HIDDEN_FEATURES:
            continue
        if name in SPONSOR_FEATURES:
            label = _sponsor_label(x_row, col)
        else:
            lab = labels.get(name)
            label = None if lab is None else _label(name, float(x_row[int(i)]), lab, x_row, col)
        if label is None or label in seen:
            continue
        seen.add(label)
        out.append({"label": label, "dir": "up" if c > 0 else "down"})
    return out
