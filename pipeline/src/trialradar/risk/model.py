"""Model recipes (baseline logistic, calibrated boosted trees) and a bootstrap ensemble."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Literal

import numpy as np
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import StratifiedKFold
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

__all__ = ["BASELINE_FEATURES", "Ensemble", "Fitted", "Recipe", "fit", "fit_ensemble"]

BASELINE_FEATURES = (
    "phase_1",
    "phase_2",
    "phase_3",
    "sponsor_industry",
    "sponsor_academic",
    "start_year",
)

Recipe = Literal["baseline", "boosted"]


@dataclass(frozen=True)
class Fitted:
    """A fitted recipe. `idx` are the column positions the estimator sees."""

    recipe: Recipe
    estimator: Any
    idx: tuple[int, ...]
    booster: Any = None  # uncalibrated HGB, kept only for explanations

    def predict_proba(self, X: np.ndarray) -> np.ndarray:
        """P(stopped early) for each row."""
        return np.asarray(self.estimator.predict_proba(X[:, list(self.idx)])[:, 1])


def fit(
    recipe: Recipe,
    X: np.ndarray,
    y: np.ndarray,
    columns: Sequence[str],
    *,
    seed: int = 42,
    explain: bool = True,
) -> Fitted:
    """Fit one model. The baseline sees BASELINE_FEATURES only; a missing one is an error.

    A boosted fit also keeps an uncalibrated booster for factor explanations unless
    `explain` is False. That booster is a full-data refit while the calibrated predictor
    averages 5 CV-fold boosters, so the factors are approximate.
    """
    cols = list(columns)
    if X.shape[1] != len(cols):
        raise ValueError(f"X has {X.shape[1]} columns but {len(cols)} names were given")
    if recipe == "baseline":
        missing = [c for c in BASELINE_FEATURES if c not in cols]
        if missing:
            raise ValueError(f"baseline feature column(s) missing: {', '.join(missing)}")
        idx = tuple(cols.index(c) for c in BASELINE_FEATURES)
        est = Pipeline(
            [
                ("impute", SimpleImputer(strategy="median", keep_empty_features=True)),
                ("scale", StandardScaler()),
                ("lr", LogisticRegression(max_iter=1000)),
            ]
        )
        est.fit(X[:, list(idx)], y)
        return Fitted("baseline", est, idx)
    idx = tuple(range(len(cols)))
    # ensemble=False keeps one booster refit on all rows (isotonic map learned on the 5 folds'
    # out-of-fold scores) instead of five, so 42 fitted members stay a few MB, not ~80.
    # The folds must be shuffled: training rows arrive ordered by start year, so plain
    # `cv=5` holds out whole year blocks whose out-of-fold scores carry no rank signal, and
    # the isotonic map learned on them is flat over the refit booster's score range.
    folds = StratifiedKFold(n_splits=5, shuffle=True, random_state=seed)
    est = CalibratedClassifierCV(
        HistGradientBoostingClassifier(random_state=seed),
        method="isotonic",
        cv=folds,
        ensemble=False,
    ).fit(X, y)
    booster = HistGradientBoostingClassifier(random_state=seed).fit(X, y) if explain else None
    return Fitted("boosted", est, idx, booster)


@dataclass(frozen=True)
class Ensemble:
    """The shipped model (`main`) plus bootstrap refits for a 10th-90th percentile range."""

    recipe: Recipe
    columns: tuple[str, ...]
    main: Fitted
    members: tuple[Fitted, ...]

    def predict(self, X: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """(p, lo, hi), each in [0, 1]; the band is widened so p is always inside."""
        p = np.clip(self.main.predict_proba(X), 0.0, 1.0)
        draws = np.stack([m.predict_proba(X) for m in self.members])
        lo = np.clip(np.percentile(draws, 10, axis=0), 0.0, 1.0)
        hi = np.clip(np.percentile(draws, 90, axis=0), 0.0, 1.0)
        return p, np.minimum(lo, p), np.maximum(hi, p)


def fit_ensemble(
    recipe: Recipe,
    X: np.ndarray,
    y: np.ndarray,
    columns: Sequence[str],
    *,
    n_boot: int = 20,
    seed: int = 42,
) -> Ensemble:
    """Fit the main model on all rows and `n_boot` refits on bootstrap resamples.

    Only `main` keeps a booster for explanations; the members need none.
    """
    main = fit(recipe, X, y, columns, seed=seed)
    rng = np.random.default_rng(seed)
    members = []
    for i in range(n_boot):
        rows = rng.integers(0, len(y), len(y))
        members.append(fit(recipe, X[rows], y[rows], columns, seed=seed + i + 1, explain=False))
    return Ensemble(recipe, tuple(columns), main, tuple(members))
