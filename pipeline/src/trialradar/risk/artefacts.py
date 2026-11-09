"""Stop-risk artefacts: the model file, its card, the held-out table and the sponsor table.

Four files are written by `save` and read by `load`; `factor_labels.csv` is hand-kept next
to them. `load` fails loudly (`RiskArtefactError`) on a missing file, a card that disagrees
with the model file, or a scikit-learn minor version other than the installed one.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any, Literal

import joblib
import numpy as np
import polars as pl
import sklearn
from pydantic import BaseModel, ConfigDict, ValidationError

from trialradar.risk.explain import FactorLabel
from trialradar.risk.features import FEATURES
from trialradar.risk.model import Ensemble, Recipe

__all__ = [
    "EXCLUDED",
    "Card",
    "Loaded",
    "Metrics",
    "RiskArtefactError",
    "Typical",
    "feature_matrix",
    "load",
    "read_factor_labels",
    "save",
    "typical_rate",
]

EXCLUDED: tuple[str, ...] = (
    "enrollment (actual enrollment is small because a trial stopped)",
    "why_stopped",
    "results posted",
    "actual completion dates and durations",
    "last update date",
    "site recruitment status",
    "overall status",
)

SPLIT_MIN_DIFF = 0.05
SPLIT_MIN_N = 200


class RiskArtefactError(Exception):
    """A risk artefact is missing, unreadable, or inconsistent with the installed libraries."""


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Metrics(_Strict):
    auc: float | None
    brier: float
    n: int
    positives: int
    calibration: list[dict[str, float | int]]


class MetricSet(_Strict):
    baseline: Metrics
    boosted: Metrics
    boosted_no_sites: Metrics
    in_area: Metrics | None


class Split(_Strict):
    train_end: str
    test: list[str]


class Typical(_Strict):
    phase: str
    sponsor: Literal["industry", "other", "all"]
    rate: float
    n: int


class Card(_Strict):
    version: str
    trained_on: date
    sklearn: str
    shipped: Recipe
    shipped_reason: str
    filter: dict[str, Any]
    features: list[str]
    excluded: list[str]
    split: Split
    metrics: MetricSet
    site_leak_flag: bool
    typical: list[Typical]
    max_start_year: int
    sponsor_floor: int
    n_train: int
    n_test: int


@dataclass(frozen=True)
class Loaded:
    eval: Ensemble
    shipped: Ensemble
    card: Card
    sponsor_table: pl.DataFrame
    factor_labels: dict[str, FactorLabel]


def feature_matrix(frame: pl.DataFrame) -> np.ndarray:
    """FEATURES columns as a float matrix; nulls become NaN."""
    return frame.select(FEATURES).cast(pl.Float64).to_numpy()


def save(
    dir: Path,
    eval_ens: Ensemble,
    shipped: Ensemble,
    card: Card,
    heldout: pl.DataFrame,
    sponsor_table: pl.DataFrame,
) -> None:
    """Write model.joblib, card.json, heldout.parquet and sponsor_history.csv into `dir`."""
    dir.mkdir(parents=True, exist_ok=True)
    joblib.dump(
        {"version": card.version, "eval": eval_ens, "shipped": shipped}, dir / "model.joblib"
    )
    (dir / "card.json").write_text(card.model_dump_json(indent=2) + "\n")
    heldout.write_parquet(dir / "heldout.parquet")
    sponsor_table.write_csv(dir / "sponsor_history.csv")


def read_factor_labels(path: Path) -> dict[str, FactorLabel]:
    """feature,up,down rows from the hand-kept label file."""
    try:
        with path.open(newline="") as fh:
            rows = list(csv.DictReader(fh))
    except OSError as exc:
        raise RiskArtefactError(f"cannot read {path.name}: {exc}") from exc
    return {r["feature"]: FactorLabel(r["feature"], r["up"], r["down"]) for r in rows}


def load(dir: Path) -> Loaded:
    """Read and cross-check all artefacts in `dir`."""
    for name in (
        "model.joblib",
        "card.json",
        "heldout.parquet",
        "sponsor_history.csv",
        "factor_labels.csv",
    ):
        if not (dir / name).is_file():
            raise RiskArtefactError(f"missing risk artefact: {name} in {dir}")
    try:
        card = Card.model_validate_json((dir / "card.json").read_text())
    except (ValidationError, ValueError) as exc:
        raise RiskArtefactError(f"card.json is invalid: {exc}") from exc
    if card.sklearn.split(".")[:2] != sklearn.__version__.split(".")[:2]:
        raise RiskArtefactError(
            f"model trained with sklearn {card.sklearn}, installed {sklearn.__version__}: "
            "retrain (minor versions must match)"
        )
    try:
        blob = joblib.load(dir / "model.joblib")
    except Exception as exc:  # unpickling can fail in many ways
        raise RiskArtefactError(f"model.joblib cannot be loaded: {exc}") from exc
    if not isinstance(blob, dict) or blob.get("version") != card.version:
        got = blob.get("version") if isinstance(blob, dict) else None
        raise RiskArtefactError(f"card version {card.version} != model version {got}")
    table = pl.read_csv(dir / "sponsor_history.csv", schema_overrides={"as_of": pl.Date})
    return Loaded(
        eval=blob["eval"],
        shipped=blob["shipped"],
        card=card,
        sponsor_table=table,
        factor_labels=read_factor_labels(dir / "factor_labels.csv"),
    )


def _phase_label(phases: list[str]) -> str:
    digits = sorted({p[-1] for p in phases if p in {"PHASE1", "PHASE2", "PHASE3"}})
    return f"phase {'/'.join(digits)}" if digits else "all"


def typical_rate(card: Card, phases: list[str], sponsor_class: str | None) -> tuple[float, str]:
    """Observed stop rate for the trial's phase, split by sponsor only when it matters.

    The sponsor split is used when its rate differs from the phase-only rate by at least
    0.05 and rests on at least 200 trials. Returns (rate, basis text).
    """
    by_key = {(t.phase, t.sponsor): t for t in card.typical}
    label = _phase_label(phases)
    if (label, "all") not in by_key:
        label = "all"
    base = by_key[(label, "all")]
    noun = "phase 1-3 drug trials" if label == "all" else f"{label} drug trials"
    if sponsor_class is not None:
        split = by_key.get((label, "industry" if sponsor_class == "INDUSTRY" else "other"))
        if (
            split is not None
            and split.n >= SPLIT_MIN_N
            and abs(split.rate - base.rate) >= SPLIT_MIN_DIFF
        ):
            return (
                split.rate,
                f"{noun}, {'industry' if split.sponsor == 'industry' else 'non-industry'}",
            )
    return base.rate, noun
