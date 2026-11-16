"""Stop-risk artefacts: the model file, its card, the held-out table and the sponsor table.

Four files are written by `save` and read by `load`; `factor_labels.csv` is hand-kept next
to them. `load` fails loudly (`RiskArtefactError`) on a missing file, a card that disagrees
with the model file, a scikit-learn minor version other than the installed one, or a v2 card
that did not pass the shipping bar (`comparison.v2_ships`) committed as the live card.
"""

from __future__ import annotations

import csv
import logging
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any, Literal

import joblib
import numpy as np
import polars as pl
import sklearn
from pydantic import BaseModel, ConfigDict, ValidationError

from trialradar.risk.explain import KINDS, FactorLabel
from trialradar.risk.features import FEATURES
from trialradar.risk.model import Ensemble, Recipe

_log = logging.getLogger(__name__)

__all__ = [
    "EXCLUDED",
    "Card",
    "Comparison",
    "Loaded",
    "Metrics",
    "RiskArtefactError",
    "Typical",
    "feature_matrix",
    "load",
    "read_factor_labels",
    "save",
    "typical_rate",
    "typical_rates",
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


class Comparison(_Strict):
    """v2's before/after block: every model on the same held-out trials running at the cutoff."""

    cutoff: str
    outcome_snapshot: str
    v1_recipe: Metrics
    v1_committed: Metrics | None
    v2_baseline: Metrics
    v2: Metrics
    v2_history: Metrics
    v2_no_sites: Metrics
    test_exclusions: dict[str, int]
    train_trials: int
    train_rows: int
    train_age_mix: dict[str, int]
    calibration_by_age: dict[str, list[dict[str, float | int]]]
    parity: dict[str, float] | None
    v2_ships: bool
    reason: str
    v1_published_auc: float | None = None  # the v1 card's shipped-kind test AUC (Methods)
    # v2's chosen model (main fit) on exactly v1_committed's trials: the second shipping gate
    v2_on_v1_subset: Metrics | None = None


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
    refit_end: str  # the shipped model is refit on labelled trials started up to this date
    metrics: MetricSet
    site_leak_flag: bool
    typical: list[Typical]
    max_start_year: int | None  # None for v2 (no start_year feature, nothing to clamp)
    sponsor_floor: int
    n_train: int
    n_test: int
    feature_set: Literal["v1", "v2"] = "v1"
    comparison: Comparison | None = None
    data_source: str | None = None


@dataclass(frozen=True)
class Loaded:
    eval: Ensemble
    shipped: Ensemble
    card: Card
    sponsor_table: pl.DataFrame
    factor_labels: dict[str, FactorLabel]
    v2_card: Card | None = None
    """``<dir>/v2/card.json`` when committed (v2 trained but not shipped): its comparison and
    data source are shown beside the live v1 model."""


def feature_matrix(frame: pl.DataFrame, columns: Sequence[str] = FEATURES) -> np.ndarray:
    """`columns` (default v1's FEATURES) as a float matrix; nulls become NaN."""
    return (
        frame.select(pl.col(c).cast(pl.Float64) for c in columns).fill_null(float("nan")).to_numpy()
    )


def typical_rates(frame: pl.DataFrame) -> list[Typical]:
    """Observed stop rates by phase label and sponsor class over `frame` (one row per trial:
    phases, sponsor_class, label). Callers pass the shipped refit's trials."""
    labelled = frame.with_columns(
        pl.col("phases")
        .list.eval(pl.element().str.slice(-1))
        .list.sort()
        .list.join("/")
        .map_elements(lambda d: f"phase {d}", return_dtype=pl.Utf8)
        .alias("phase"),
        pl.when(pl.col("sponsor_class") == "INDUSTRY")
        .then(pl.lit("industry"))
        .otherwise(pl.lit("other"))
        .alias("sponsor"),
    )
    rows: list[Typical] = []
    groups = [("all", labelled)] + [
        (str(g["phase"][0]), g) for g in labelled.partition_by("phase", as_dict=False)
    ]
    for phase, sub in groups:
        for sponsor, part in [
            ("all", sub),
            ("industry", sub.filter(pl.col("sponsor") == "industry")),
            ("other", sub.filter(pl.col("sponsor") == "other")),
        ]:
            if part.height:
                rows.append(
                    Typical(
                        phase=phase,
                        sponsor=sponsor,  # type: ignore[arg-type]
                        rate=float(part["label"].mean()),  # type: ignore[arg-type]
                        n=part.height,
                    )
                )
    return rows


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
        {"version": card.version, "eval": eval_ens, "shipped": shipped},
        dir / "model.joblib",
        compress=("lzma", 6),  # ~5x smaller than zlib 3 on the real v2 ensembles
    )
    (dir / "card.json").write_text(card.model_dump_json(indent=2) + "\n")
    heldout.write_parquet(dir / "heldout.parquet")
    sponsor_table.write_csv(dir / "sponsor_history.csv")


def read_factor_labels(path: Path) -> dict[str, FactorLabel]:
    """feature,kind,yes,no,text rows from the hand-kept label file (see config/risk/README.md).

    An unknown kind, or a kind missing the text it needs, is an error.
    """
    try:
        with path.open(newline="") as fh:
            rows = list(csv.DictReader(fh))
    except OSError as exc:
        raise RiskArtefactError(f"cannot read {path.name}: {exc}") from exc
    out: dict[str, FactorLabel] = {}
    for r in rows:
        try:
            lab = FactorLabel(r["feature"], r["kind"], r["yes"], r["no"], r["text"])
        except (KeyError, TypeError) as exc:
            raise RiskArtefactError(
                f"{path.name}: expected columns feature,kind,yes,no,text ({exc})"
            ) from exc
        need = {
            "count": ("text",),
            "phase": ("text",),
            "binary": ("yes", "no"),
            "enrollment": ("yes", "text"),
            "months": ("text",),
            "months_ago": ("text", "no"),
        }
        if lab.kind not in KINDS:
            raise RiskArtefactError(f"{path.name}: {lab.feature} has unknown kind {lab.kind!r}")
        if lab.kind == "category":
            need["category"] = ("yes",)
        missing = [f for f in need.get(lab.kind, ()) if not getattr(lab, f)]
        if missing:
            raise RiskArtefactError(
                f"{path.name}: {lab.feature} ({lab.kind}) needs {', '.join(missing)}"
            )
        out[lab.feature] = lab
    return out


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
    if card.feature_set == "v2" and (card.comparison is None or not card.comparison.v2_ships):
        raise RiskArtefactError(
            "card.json is a v2 card that did not pass the shipping bar (no comparison, or "
            "comparison.v2_ships is false); commit it as config/risk/v2/card.json instead"
        )
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
        v2_card=_v2_card(dir / "v2" / "card.json"),
        eval=blob["eval"],
        shipped=blob["shipped"],
        card=card,
        sponsor_table=table,
        factor_labels=read_factor_labels(dir / "factor_labels.csv"),
    )


def _v2_card(path: Path) -> Card | None:
    """The optional unshipped v2 card. Present but invalid (or not a v2 card) is logged and
    ignored: it only adds the before/after to Methods, so it must not take down the live v1
    scores."""
    if not path.is_file():
        return None
    try:
        card = Card.model_validate_json(path.read_text())
    except (ValidationError, ValueError) as exc:
        _log.warning("ignoring v2/card.json: invalid (%s)", exc)
        return None
    if card.feature_set != "v2":
        _log.warning("ignoring v2/card.json: feature_set %r, not 'v2'", card.feature_set)
        return None
    return card


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
