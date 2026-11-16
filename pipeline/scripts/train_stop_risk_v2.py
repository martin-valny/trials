"""Train stop-risk v2 from the AACT panel and compare it with v1 on the same held-out trials.

Usage (hand-run, offline):
  uv run python scripts/train_stop_risk_v2.py --panel .cache/aact/panel --out <dir>
      [--n-boot 20] [--v1-dir ../config/risk] [--config ../config/area.yaml] [--parity PATH]

Spec 2026-11-15 sections 6-8. Snapshots are loaded one at a time (outcome snapshot first, so
its labels are known), summarized, reduced to the feature rows that can be needed, and
dropped. Then:

- C-recipe (evaluation): trials that ended by the cutoff snapshot C, one row per quarterly
  snapshot <= C while in scope, weight 1/k, grouped by trial; held out: trials running at C,
  one row each, labelled from the outcome snapshot (``risk.split_v2``).
- Models on the held-out trials: v2-baseline (logistic on BASELINE_V2), v2 (boosted,
  FEATURES_V2), v2 without site features, v2 + edit history (research), v1-recipe (v1's
  features and code on the same training trials' last record at or before C, scored on the
  C records with start year clamped to the training maximum) and v1-committed (the shipped v1
  model on held-out trials started 2020 or later; report only).
- The bar (frozen, spec 7.3; ``decide``), printed once with every test number.
- Shipped refit: the chosen v2 recipe on all trials ended by the outcome snapshot with their
  snapshot rows; typical stop rates from the same trials, each counted once.

Writes card.json, model.joblib (eval = C-recipe, shipped = refit), heldout.parquet (FEATURES_V2
and label, no ids), sponsor_history.csv (as of the outcome snapshot) and a copy of v1's
factor_labels.csv to ``--out``, whether or not v2 ships.
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
import sys
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

import numpy as np
import polars as pl
import sklearn

from trialradar.aact.adapter import Snapshot, load_snapshot, mesh_categories
from trialradar.config import AreaConfig, load_config
from trialradar.relevance import is_relevant
from trialradar.risk import artefacts
from trialradar.risk.artefacts import Card, Comparison, Metrics, RiskArtefactError
from trialradar.risk.evaluate import metrics
from trialradar.risk.features import FEATURES, SITE_FEATURES
from trialradar.risk.features import build as build_v1
from trialradar.risk.features_v2 import BASELINE_V2, FEATURES_V2, build_v2
from trialradar.risk.history_v2 import HISTORY_FEATURES, history_features, load_monthly
from trialradar.risk.model import BASELINE_FEATURES, Ensemble, Fitted, Recipe, fit, fit_ensemble
from trialradar.risk.scope import LABELS
from trialradar.risk.split_v2 import (
    CUTOFF,
    MAX_CUTOFF_GAP_DAYS,
    Rows,
    SnapshotSummary,
    cutoff_snapshot,
    final_record_before,
    holdout_rows,
    labels,
    summarize,
    train_rows,
)
from trialradar.risk.sponsors import (
    SPONSOR_FLOOR,
    aggregate,
    history_rows,
    live_counts,
    prior_counts,
)
from trialradar.tables import SCHEMAS, Tables
from trialradar.textnorm import Aliases, load_alias_set

_REPO = Path(__file__).resolve().parents[2]
MARGIN = 0.02
LEAK_DROP = 0.03  # v1's site-leak flag threshold (scripts/train_stop_risk.py, config/risk/README)
PARITY_MAX = 0.01
# AUC moves in steps of about 1/(2PN) (P stopped, N completed held-out trials: ~1e-8 at the
# expected test size), far above float rounding (~1e-16), so a 1e-9 tolerance only lets an
# exact "+0.02" (e.g. 0.73 vs 0.71, which floats compute as 0.0199999...) pass and never
# admits a real shortfall. Brier gets no tolerance on purpose: "no worse" is compared exactly.
_EPS = 1e-9
V1_COMMITTED_START = date(2020, 1, 1)
SPONSOR_FEATURES = frozenset({"sponsor_prior_n", "sponsor_prior_rate", "sponsor_few_prior"})
NO_SITES: tuple[str, ...] = tuple(f for f in FEATURES_V2 if f not in SITE_FEATURES)
WITH_HISTORY: tuple[str, ...] = (*FEATURES_V2, *HISTORY_FEATURES)
AGE_BANDS: tuple[tuple[str, float, float], ...] = (
    ("<12", 0.0, 12.0),
    ("12-36", 12.0, 36.0),
    ("36-72", 36.0, 72.0),
    (">=72", 72.0, math.inf),
)
EXCLUDED_V2: tuple[str, ...] = (
    "why_stopped",
    "results posted (a trial with results is out of scope)",
    "actual completion dates and durations",
    "site recruitment status",
    "start year (trial age replaces it)",
    "edit history (research comparison only, not shipped)",
)
SCOPE_PHASES = ["PHASE1", "PHASE1/PHASE2", "PHASE2", "PHASE2/PHASE3", "PHASE3"]
IN_AREA_RULE = (
    "held-out trials whose conditions or direct MeSH condition terms in the C snapshot match "
    "an area synonym as a whole phrase (relevance.is_relevant); AACT keeps no keywords, so "
    "keyword-only matches the live filter would make are missed. A null mesh_type (older "
    "archives, direct terms only) counts as a direct term."
)
SPONSOR_RULE = (
    "sponsor counts for a row at snapshot S: trials in S's own table that are COMPLETED or "
    "TERMINATED in S with an end date (completion, else primary completion) before S, joined "
    f"on lead sponsor; fewer than {SPONSOR_FLOOR} counts as unknown. Live scoring reads "
    "sponsor_history.csv (the same rule as of the outcome snapshot)."
)
V1_RECIPE_RULE = (
    "v1 features and code (risk.features.build, sponsor counts from trials ended before the "
    "trial's start in the same record) on each training trial's last record at or before C, "
    "same labels and seed as v2, one row per trial; held-out trials scored on their C record "
    "with start year clamped to the training maximum."
)


# --- loading -------------------------------------------------------------------------------


def snapshot_dates(panel: Path) -> list[date]:
    return sorted(date.fromisoformat(p.stem) for p in (panel / "studies").glob("*.parquet"))


def sponsor_counts_as_of(trial: pl.DataFrame, as_of: date) -> pl.DataFrame:
    """nct_id, sponsor_prior_n, sponsor_prior_stopped for every trial in `trial`, counting the
    sponsor's trials in the same table that ended (COMPLETED/TERMINATED) before `as_of`."""
    hist = history_rows(trial).filter(pl.col("end_date") < as_of)
    return live_counts(trial, aggregate(hist, as_of))


def _subset(tables: Tables, ids: Iterable[str]) -> Tables:
    keep = list(ids)
    return Tables(
        **{name: getattr(tables, name).filter(pl.col("nct_id").is_in(keep)) for name in SCHEMAS}
    )


@dataclass(frozen=True)
class Collected:
    summaries: list[SnapshotSummary]
    cut: SnapshotSummary
    final: SnapshotSummary
    train: Rows
    holdout: Rows
    refit: Rows
    train_drops: dict[str, int]
    refit_drops: dict[str, int]
    exclusions: dict[str, int]
    v2: pl.DataFrame
    """nct_id, snapshot_date, FEATURES_V2, phases, sponsor_class, start_date: trials in scope at
    a snapshot before the outcome snapshot and labelled in it."""
    v1_cut: pl.DataFrame
    """nct_id, snapshot_date, FEATURES (start year unclamped), start_date at C: trials in scope
    or ended at C."""
    sponsor_table: pl.DataFrame
    """The sponsor aggregate as of the outcome snapshot (sponsor_history.csv)."""


def _v2_rows(snap: Snapshot, keep: Iterable[str]) -> pl.DataFrame:
    """v2 features (sponsor counts as of the snapshot) plus phases, sponsor class and start
    date for the `keep` trials of one snapshot."""
    counts = sponsor_counts_as_of(snap.tables.trial, snap.date)
    sub = _subset(snap.tables, keep)
    meta = sub.trial.select("nct_id", "phases", "sponsor_class", "start_date")
    return (
        build_v2(sub, snap.fields, counts, snap.date)
        .join(meta, on="nct_id", how="left")
        .with_columns(pl.lit(snap.date).alias("snapshot_date"))
    )


def _v1_rows(snap: Snapshot, ids: Iterable[str]) -> pl.DataFrame:
    """v1 features (v1's sponsor rule: ended before the trial's start, from the same record;
    start year unclamped) plus start date for the `ids` trials of one snapshot."""
    trial = snap.tables.trial
    counts = prior_counts(trial, history_rows(trial))
    sub = _subset(snap.tables, ids)
    return (
        build_v1(sub, snap.fields, counts, max_start_year=None)
        .join(sub.trial.select("nct_id", "start_date"), on="nct_id", how="left")
        .with_columns(pl.lit(snap.date).alias("snapshot_date"))
    )


def collect(panel: Path, aliases: Aliases) -> Collected:
    """One pass over the panel, one Snapshot in memory at a time."""
    dates = snapshot_dates(panel)
    if len(dates) < 2:
        raise ValueError(f"need at least two snapshots in {panel}, found {len(dates)}")
    final_date = dates[-1]
    cut_date = min(dates[:-1], key=lambda d: abs((d - CUTOFF).days))
    # Fail fast, before any snapshot is loaded (cutoff_snapshot checks again below).
    if abs((cut_date - CUTOFF).days) > MAX_CUTOFF_GAP_DAYS:
        raise ValueError(
            f"no snapshot within {MAX_CUTOFF_GAP_DAYS} days of {CUTOFF.isoformat()} "
            f"(nearest {cut_date.isoformat()})"
        )
    # Older archives lack mesh_type: every snapshot takes the final snapshot's categories.
    categories = mesh_categories(panel, final_date)
    summaries: list[SnapshotSummary] = []
    labelled: frozenset[str] = frozenset()
    v2_parts: list[pl.DataFrame] = []
    v1_cut: pl.DataFrame | None = None
    sponsor_table: pl.DataFrame | None = None
    for d in [final_date, *dates[:-1]]:  # outcome first: its labels decide what to keep
        snap = load_snapshot(panel, d, aliases=aliases, categories=categories)
        s = summarize(snap)
        summaries.append(s)
        if d == final_date:
            labelled = frozenset(labels(s)[0])
            history = history_rows(snap.tables.trial).filter(pl.col("end_date") < d)
            sponsor_table = aggregate(history, d)
        elif keep := s.in_scope & labelled:
            v2_parts.append(_v2_rows(snap, keep))
        if d == cut_date:
            v1_cut = _v1_rows(snap, s.in_scope | {n for n, st in s.status.items() if st in LABELS})
        del snap  # never more than one Snapshot in memory
        print(f"{d}: {len(s.present)} trials, {len(s.in_scope)} in scope", flush=True)
    assert v1_cut is not None and sponsor_table is not None

    cut = cutoff_snapshot(summaries, CUTOFF)
    if cut.date != cut_date:
        raise AssertionError(f"cutoff snapshot {cut.date} != {cut_date}")
    final = next(s for s in summaries if s.date == final_date)
    label, _ = labels(final)
    train, train_drops = train_rows(summaries, CUTOFF, label)
    holdout, exclusions = holdout_rows(summaries, CUTOFF, final)
    # The shipped refit: the same rule with the outcome snapshot as the cutoff (every trial
    # ended by then, rows from every earlier snapshot; their labels agree by construction).
    refit, refit_drops = train_rows(summaries, final_date, label)
    empty = pl.DataFrame(
        schema={"nct_id": pl.Utf8, "snapshot_date": pl.Date}
        | {c: pl.Float64 for c in FEATURES_V2}
        | {"phases": pl.List(pl.Utf8), "sponsor_class": pl.Utf8, "start_date": pl.Date}
    )
    v2 = pl.concat(v2_parts, how="vertical_relaxed") if v2_parts else empty
    return Collected(
        summaries=summaries,
        cut=cut,
        final=final,
        train=train,
        holdout=holdout,
        refit=refit,
        train_drops=train_drops,
        refit_drops=refit_drops,
        exclusions=exclusions,
        v2=v2,
        v1_cut=v1_cut,
        sponsor_table=sponsor_table,
    )


def with_features(rows: Rows, frame: pl.DataFrame) -> pl.DataFrame:
    """`rows.keys` joined to `frame` on (nct_id, snapshot_date), in the keys' order; every key
    must find its feature row."""
    out = rows.keys.join(frame, on=["nct_id", "snapshot_date"], how="left", maintain_order="left")
    if out.height != rows.keys.height:
        raise AssertionError("duplicate feature rows for a (trial, snapshot) key")
    if missing := out.filter(pl.col("phases").is_null()).height:
        raise AssertionError(f"{missing} row(s) have no features")
    return out


def v1_frames(col: Collected) -> tuple[pl.DataFrame, pl.DataFrame]:
    """(v1-recipe training frame, v1 held-out frame), both from records at or before C.

    Training: one row per C-recipe training trial, its record from ``final_record_before``
    (ended trials are present at C, so that record is C's), label from the C-recipe rows.
    Held-out: the held-out trials' C records."""
    trial_label = col.train.keys.group_by("nct_id").agg(pl.col("label").first())
    ids = set(trial_label["nct_id"].to_list())
    record = final_record_before(col.summaries, CUTOFF, ids)
    keys = pl.DataFrame(
        {"nct_id": list(record), "snapshot_date": list(record.values())},
        schema={"nct_id": pl.Utf8, "snapshot_date": pl.Date},
    ).join(trial_label, on="nct_id")
    train = keys.join(col.v1_cut, on=["nct_id", "snapshot_date"], how="inner").sort("nct_id")
    if train.height != len(ids):
        raise AssertionError(
            f"v1-recipe: {len(ids) - train.height} training trial(s) lack a record at C"
        )
    test = col.holdout.keys.join(
        col.v1_cut, on=["nct_id", "snapshot_date"], how="left", maintain_order="left"
    )
    if missing := test.filter(pl.col("phase_1").is_null()).height:
        raise AssertionError(f"v1: {missing} held-out trial(s) lack a record at C")
    return train, test


# --- the bar -------------------------------------------------------------------------------


@dataclass(frozen=True)
class Decision:
    recipe: Recipe
    recipe_reason: str
    v2_ships: bool
    reason: str


def _beats(a: Metrics, b: Metrics) -> bool:
    assert a.auc is not None and b.auc is not None
    return a.auc - b.auc >= MARGIN - _EPS and a.brier <= b.brier


def pick_recipe(baseline: Metrics, boosted: Metrics, name: str) -> tuple[Recipe, str]:
    """v1's rule: boosted only if its AUC is at least 0.02 above the baseline's and its Brier
    is no worse; otherwise the baseline. Returns (recipe, reason quoting the numbers)."""
    assert baseline.auc is not None and boosted.auc is not None
    if _beats(boosted, baseline):
        return "boosted", (
            f"{name} boosted AUC {boosted.auc:.3f} beats {name} baseline {baseline.auc:.3f} by "
            f"at least {MARGIN} and Brier {boosted.brier:.4f} is no worse than "
            f"{baseline.brier:.4f}"
        )
    return "baseline", (
        f"{name} boosted (AUC {boosted.auc:.3f}, Brier {boosted.brier:.4f}) does not beat "
        f"{name} baseline (AUC {baseline.auc:.3f}, Brier {baseline.brier:.4f}) by {MARGIN} AUC "
        f"with no worse Brier, so the {name} baseline is the {name} model"
    )


def parity_result(parity: dict[str, float] | None) -> tuple[bool, str]:
    """(passes, text). Every non-exempt FEATURES_V2 feature needs a share of at most 0.01; the
    exempt set is SPONSOR_FEATURES (spec 6.4), never the file's own list."""
    if parity is None:
        return False, "parity not run"
    required = [f for f in FEATURES_V2 if f not in SPONSOR_FEATURES]
    if missing := [f for f in required if f not in parity]:
        return False, f"parity missing {', '.join(missing)}"
    if failing := [f for f in required if parity[f] > PARITY_MAX]:
        return False, f"parity fails on {', '.join(failing)} (above {PARITY_MAX:.0%} mismatch)"
    return True, f"parity passes (no shippable feature above {PARITY_MAX:.0%} mismatch)"


def published_gate(
    v2_on_v1_subset: Metrics | None, v1_committed: Metrics | None
) -> tuple[bool, str]:
    """Second gate (Martin, 2026-11-16, fixed before computing): on the held-out trials the
    published v1 never saw (start >= 2020-01-01), v2's chosen model needs AUC at least 0.02
    above the published v1's and Brier no worse. No published-v1 score means no ship."""
    if v1_committed is None or v2_on_v1_subset is None:
        return False, "published v1 not scored"
    if v1_committed.auc is None or v2_on_v1_subset.auc is None:
        return False, "published v1 subset has one outcome only, no AUC"
    ok = _beats(v2_on_v1_subset, v1_committed)
    return ok, (
        f"on the published v1's subset (n {v1_committed.n}) v2 AUC {v2_on_v1_subset.auc:.3f}, "
        f"Brier {v2_on_v1_subset.brier:.4f} vs published v1 AUC {v1_committed.auc:.3f}, Brier "
        f"{v1_committed.brier:.4f}: "
        + ("at least" if ok else "not")
        + f" {MARGIN} AUC better with no worse Brier"
    )


def decide(
    v2_baseline: Metrics,
    v2: Metrics,
    v1_recipe: Metrics,
    parity: dict[str, float] | None,
    *,
    v1_committed: Metrics | None,
    v2_on_v1_subset: Metrics | None,
) -> Decision:
    """The frozen shipping bar (spec 7.3), on each ensemble's main fit.

    Within v2, boosted is the v2 model only if its AUC is at least 0.02 above v2-baseline and
    its Brier no worse. v2 replaces v1 only if that model's AUC is at least 0.02 above
    `v1_recipe` (the v1-recipe model v1's own rule picked), its Brier no worse, parity passes
    (``parity_result``), and the second gate against the published v1 passes
    (``published_gate``; `v2_on_v1_subset` must be the chosen v2 model's score)."""
    recipe, recipe_reason = pick_recipe(v2_baseline, v2, "v2")
    chosen = v2 if recipe == "boosted" else v2_baseline
    assert chosen.auc is not None and v1_recipe.auc is not None
    accuracy = _beats(chosen, v1_recipe)
    head = (
        f"v2 {recipe} AUC {chosen.auc:.3f}, Brier {chosen.brier:.4f} vs v1-recipe AUC "
        f"{v1_recipe.auc:.3f}, Brier {v1_recipe.brier:.4f}: "
        + ("at least" if accuracy else "not")
        + f" {MARGIN} AUC better with no worse Brier"
    )
    gate_ok, gate_text = published_gate(v2_on_v1_subset, v1_committed)
    parity_ok, parity_text = parity_result(parity)
    ships = accuracy and gate_ok and parity_ok
    reason = f"{head}; {gate_text}; {parity_text}; " + (
        "v2 replaces v1" if ships else "v1 stays live"
    )
    return Decision(recipe, recipe_reason, ships, reason)


def read_parity(path: Path) -> dict[str, float]:
    """{feature: mismatch share} from the parity JSON. Its "exempt" list is ignored (the
    exempt set is fixed in code); a share that is not a finite number >= 0 is an error."""
    raw = json.loads(path.read_text())
    if not isinstance(raw, dict):
        raise TypeError(f"{path}: expected a JSON object of feature -> mismatch share")
    out: dict[str, float] = {}
    for k, v in raw.items():
        if k == "exempt":
            continue
        if isinstance(v, bool) or not isinstance(v, int | float) or not math.isfinite(v) or v < 0:
            raise ValueError(f"{path}: mismatch share for {k!r} must be a number >= 0, got {v!r}")
        out[str(k)] = float(v)
    return out


def read_parity_meta(path: Path) -> dict[str, Any] | None:
    """The parity run's provenance (as_of, n_trials, seed, counts) from the sibling
    ``<stem>.meta.json`` that check_risk_parity.py writes; None when it is absent."""
    meta = path.with_name(f"{path.stem}.meta.json")
    if not meta.is_file():
        return None
    raw = json.loads(meta.read_text())
    if not isinstance(raw, dict):
        raise TypeError(f"{meta}: expected a JSON object")
    return raw


def in_area_ids(panel: Path, snap_date: date, ids: Iterable[str], cfg: AreaConfig) -> set[str]:
    """Held-out trials in the configured area at `snap_date` (see IN_AREA_RULE), with
    ``relevance.is_relevant`` applied to the conditions and direct MeSH terms the panel keeps."""
    keep = list(ids)
    name = f"{snap_date.isoformat()}.parquet"
    cond = pl.read_parquet(panel / "conditions" / name, columns=["nct_id", "name"])
    mesh = pl.read_parquet(
        panel / "browse_conditions" / name, columns=["nct_id", "mesh_term", "mesh_type"]
    ).filter(
        pl.col("mesh_type").is_null() | (pl.col("mesh_type").str.to_lowercase() != "mesh-ancestor")
    )
    texts: dict[str, tuple[list[str], list[str]]] = {n: ([], []) for n in keep}
    for n, t in cond.filter(pl.col("nct_id").is_in(keep)).iter_rows():
        if t:
            texts[n][0].append(t)
    for n, t, _ in mesh.filter(pl.col("nct_id").is_in(keep)).iter_rows():
        if t:
            texts[n][1].append(t)
    return {
        n
        for n, (conds, terms) in texts.items()
        if is_relevant(
            {
                "protocolSection": {"conditionsModule": {"conditions": conds}},
                "derivedSection": {
                    "conditionBrowseModule": {"meshes": [{"term": t} for t in terms]}
                },
            },
            cfg,
        )
    }


def all_null(frame: pl.DataFrame, cols: Sequence[str]) -> list[str]:
    """Feature columns with no value at all in `frame` (HistGradientBoosting cannot bin them)."""
    return [
        c
        for c in cols
        if frame[c].null_count() == frame.height or frame[c].cast(pl.Float64).is_nan().all()
    ]


# --- reporting -----------------------------------------------------------------------------


def _metrics(y: np.ndarray, p: np.ndarray) -> Metrics:
    return Metrics(**metrics(y, p))


def _band(age: float | None) -> str | None:
    if age is None or math.isnan(age):
        return None
    for name, lo, hi in AGE_BANDS:
        if lo <= age < hi:
            return name
    return AGE_BANDS[0][0] if age < 0 else None  # a start date after as-of reads as youngest


def calibration_by_age(
    age: Sequence[float | None], y: np.ndarray, p: np.ndarray
) -> dict[str, list[dict[str, float | int]]]:
    bands = np.array([_band(a) for a in age], dtype=object)
    out: dict[str, list[dict[str, float | int]]] = {}
    for name, _, _ in AGE_BANDS:
        mask = bands == name
        if mask.any():
            out[name] = metrics(y[mask], p[mask])["calibration"]
    return out


def age_mix(train: pl.DataFrame) -> dict[str, int]:
    """Training rows by age band ("age <12" ... ">=72", "age unknown") plus training trials by
    start year ("start 2019", "start unknown"), the start date read from each trial's latest
    row."""
    mix: dict[str, int] = {}
    for a in train["age_months"].to_list():
        key = f"age {_band(a) or 'unknown'}"
        mix[key] = mix.get(key, 0) + 1
    starts = (
        train.sort("snapshot_date")
        .group_by("nct_id", maintain_order=True)
        .agg(pl.col("start_date").last())
    )
    for d in starts["start_date"].to_list():
        key = f"start {d.year if d is not None else 'unknown'}"
        mix[key] = mix.get(key, 0) + 1
    return dict(sorted(mix.items()))


def _fmt(m: Metrics | None) -> str:
    if m is None:
        return "n/a"
    auc = "n/a" if m.auc is None else f"{m.auc:.3f}"
    return f"AUC {auc}  Brier {m.brier:.4f}  n {m.n} ({m.positives} stopped)"


def _matrix(frame: pl.DataFrame, cols: Sequence[str]) -> np.ndarray:
    return artefacts.feature_matrix(frame, cols)


# --- main ----------------------------------------------------------------------------------


def _load_v1(v1_dir: Path) -> artefacts.Loaded | None:
    try:
        return artefacts.load(v1_dir)
    except RiskArtefactError as exc:
        print(f"v1-committed not scored: {exc}", file=sys.stderr)
        return None


def v1_published_auc(card: Card) -> float | None:
    """The committed v1 card's published test AUC: that of the kind it shipped."""
    shipped: Metrics = getattr(card.metrics, card.shipped)
    return shipped.auc


def v1_subset_mask(v1_test: pl.DataFrame) -> np.ndarray:
    """Held-out rows the published v1 is scored on: start date on or after 2020-01-01."""
    return (v1_test["start_date"] >= V1_COMMITTED_START).fill_null(False).to_numpy()


def _v1_committed(
    loaded: artefacts.Loaded | None, v1_test: pl.DataFrame, y: np.ndarray
) -> Metrics | None:
    if loaded is None:
        return None
    mask = v1_subset_mask(v1_test)
    if not mask.any():
        return None
    frame = v1_test.filter(pl.Series(mask))
    if loaded.card.max_start_year is not None:
        frame = frame.with_columns(
            pl.col("start_year").clip(upper_bound=loaded.card.max_start_year)
        )
    p, _, _ = loaded.shipped.predict(_matrix(frame, loaded.card.features))
    return _metrics(y[mask], p)


def _subset_metrics(y: np.ndarray, p: np.ndarray, mask: np.ndarray) -> Metrics | None:
    """Metrics on the masked rows, None unless both outcomes occur there (as v1)."""
    if not mask.any() or len(np.unique(y[mask])) < 2:
        return None
    return _metrics(y[mask], p[mask])


def _single_class(*ys: np.ndarray) -> bool:
    return any(len(y) == 0 or len(np.unique(y)) < 2 for y in ys)


def main(argv: Sequence[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--panel", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--n-boot", type=int, default=20)
    ap.add_argument("--v1-dir", type=Path, default=_REPO / "config" / "risk")
    ap.add_argument("--config", type=Path, default=_REPO / "config" / "area.yaml")
    ap.add_argument("--parity", type=Path, default=None)
    args = ap.parse_args(argv)

    cfg = load_config(args.config)
    col = collect(args.panel, load_alias_set(cfg.aliases_dir))
    train = with_features(col.train, col.v2)
    test = with_features(col.holdout, col.v2)
    refit = with_features(col.refit, col.v2)
    ytr, yte = train["label"].to_numpy(), test["label"].to_numpy()
    if _single_class(ytr, yte, refit["label"].to_numpy()):
        print("train, test or refit rows are empty or single-class", file=sys.stderr)
        return 1
    wtr, gtr = train["weight"].to_numpy(), train["nct_id"].to_numpy()
    cols = list(FEATURES_V2)
    kw: dict[str, Any] = {"sample_weight": wtr, "groups": gtr, "baseline_features": BASELINE_V2}

    monthly = load_monthly(args.panel)
    coverage = (
        [monthly["snapshot_date"].min().isoformat(), monthly["snapshot_date"].max().isoformat()]  # type: ignore[union-attr]
        if monthly.height
        else None
    )

    def hist(frame: pl.DataFrame, monthly: pl.DataFrame) -> pl.DataFrame:
        keys = frame.select("nct_id", pl.col("snapshot_date").alias("as_of"))
        h = history_features(monthly, keys).unique(["nct_id", "as_of"])
        return frame.join(
            h.rename({"as_of": "snapshot_date"}),
            on=["nct_id", "snapshot_date"],
            how="left",
            maintain_order="left",
        )

    train_h, test_h = hist(train, monthly), hist(test, monthly)
    del monthly
    v1_train, v1_test = v1_frames(col)

    # No imputation: a feature with no value at all in an arm's training rows stops the run.
    for arm, frame, arm_cols in (
        ("v2", train, cols),
        ("v2 + history", train_h, WITH_HISTORY),
        ("v1-recipe", v1_train, FEATURES),
        ("shipped refit", refit, cols),
    ):
        if empty := all_null(frame, arm_cols):
            print(
                f"{arm}: feature(s) with no value in training: {', '.join(empty)}", file=sys.stderr
            )
            return 2

    xtr, xte = _matrix(train, cols), _matrix(test, cols)
    ens_base = fit_ensemble("baseline", xtr, ytr, cols, n_boot=args.n_boot, **kw)
    ens_boost = fit_ensemble("boosted", xtr, ytr, cols, n_boot=args.n_boot, **kw)
    p_base, _, _ = ens_base.predict(xte)
    p_boost, _, _ = ens_boost.predict(xte)
    # Research arms: only the main fit is compared (it is fit_ensemble's main, same seed).
    nosite = fit("boosted", _matrix(train, NO_SITES), ytr, NO_SITES, explain=False, **kw)
    p_nosite = nosite.predict_proba(_matrix(test, NO_SITES))
    hist_fit = fit(
        "boosted", _matrix(train_h, WITH_HISTORY), ytr, WITH_HISTORY, explain=False, **kw
    )
    p_hist = hist_fit.predict_proba(_matrix(test_h, WITH_HISTORY))

    # v1-recipe: v1's own two fits on the same trials (one row each, unweighted, same seed),
    # chosen by v1's own rule; the chosen one is the "before".
    max_start = v1_train["start_year"].max()
    xv1, yv1 = _matrix(v1_train, FEATURES), v1_train["label"].to_numpy()
    xv1_test = _matrix(
        v1_test.with_columns(pl.col("start_year").clip(upper_bound=max_start)),  # type: ignore[arg-type]
        FEATURES,
    )
    v1_fits: dict[Recipe, Fitted] = {
        r: fit(r, xv1, yv1, FEATURES, explain=False, baseline_features=BASELINE_FEATURES)
        for r in ("baseline", "boosted")
    }
    p_v1s = {r: f.predict_proba(xv1_test) for r, f in v1_fits.items()}
    m_v1s = {r: _metrics(yte, p) for r, p in p_v1s.items()}
    v1_recipe, v1_reason = pick_recipe(m_v1s["baseline"], m_v1s["boosted"], "v1-recipe")
    m_v1, p_v1 = m_v1s[v1_recipe], p_v1s[v1_recipe]

    m_base, m_boost = _metrics(yte, p_base), _metrics(yte, p_boost)
    m_nosite, m_hist = _metrics(yte, p_nosite), _metrics(yte, p_hist)
    v1_loaded = _load_v1(args.v1_dir)
    m_v1c = _v1_committed(v1_loaded, v1_test, yte)

    parity = read_parity(args.parity) if args.parity else None
    parity_meta = read_parity_meta(args.parity) if args.parity else None
    # v2's chosen model (the within-v2 rule) on exactly the published v1's subset.
    v2_recipe, _ = pick_recipe(m_base, m_boost, "v2")
    p_eval = p_boost if v2_recipe == "boosted" else p_base
    v1_mask = v1_subset_mask(v1_test)
    m_v2_sub = _metrics(yte[v1_mask], p_eval[v1_mask]) if v1_mask.any() else None
    d = decide(m_base, m_boost, m_v1, parity, v1_committed=m_v1c, v2_on_v1_subset=m_v2_sub)
    assert d.recipe == v2_recipe
    eval_ens: Ensemble = ens_boost if d.recipe == "boosted" else ens_base

    area = in_area_ids(args.panel, col.cut.date, test["nct_id"].to_list(), cfg)
    mask = test["nct_id"].is_in(list(area)).to_numpy()
    in_area_m = _subset_metrics(yte, p_eval, mask)
    v1_in_area = _subset_metrics(yte, p_v1, mask)

    shipped_ens = fit_ensemble(
        d.recipe,
        _matrix(refit, cols),
        refit["label"].to_numpy(),
        cols,
        n_boot=args.n_boot,
        sample_weight=refit["weight"].to_numpy(),
        groups=refit["nct_id"].to_numpy(),
        baseline_features=BASELINE_V2,
    )
    refit_trials = (
        refit.sort("snapshot_date")
        .group_by("nct_id", maintain_order=True)
        .agg(pl.col("phases").last(), pl.col("sponsor_class").last(), pl.col("label").first())
    )

    dates = [s.date for s in col.summaries]
    first, last = min(dates), max(dates)
    today = date.today()
    n_train_trials = train["nct_id"].n_unique()
    assert m_boost.auc is not None and m_nosite.auc is not None
    comparison = Comparison(
        cutoff=col.cut.date.isoformat(),
        outcome_snapshot=col.final.date.isoformat(),
        v1_recipe=m_v1,
        v1_committed=m_v1c,
        v2_on_v1_subset=m_v2_sub,
        v2_baseline=m_base,
        v2=m_boost,
        v2_history=m_hist,
        v2_no_sites=m_nosite,
        test_exclusions=col.exclusions,
        train_trials=n_train_trials,
        train_rows=train.height,
        train_age_mix=age_mix(train),
        calibration_by_age=calibration_by_age(test["age_months"].to_list(), yte, p_eval),
        parity=parity,
        v2_ships=d.v2_ships,
        reason=d.reason,
        v1_published_auc=None if v1_loaded is None else v1_published_auc(v1_loaded.card),
    )
    card = Card(
        version=f"stop-risk-v2-{today:%Y%m%d}",
        trained_on=today,
        sklearn=sklearn.__version__,
        shipped=d.recipe,
        shipped_reason=d.recipe_reason,
        filter={
            "study_type": "INTERVENTIONAL",
            "phases": SCOPE_PHASES,
            "intervention_types": ["DRUG", "BIOLOGICAL"],
            "statuses": {"COMPLETED": 0, "TERMINATED": 1},
            "scope": "running at the snapshot and not finished in all but status",
            "condition_categories": "condition categories from the final snapshot's MeSH "
            f"({col.final.date.isoformat()}), applied to every snapshot",
            "in_area": IN_AREA_RULE,
            "v1_recipe_in_area": None if v1_in_area is None else v1_in_area.model_dump(),
            "snapshots": [x.isoformat() for x in dates],
            "cutoff_snapshot": col.cut.date.isoformat(),
            "outcome_snapshot": col.final.date.isoformat(),
            "train_drops": col.train_drops,
            "refit_drops": col.refit_drops,
            "refit_trials": refit_trials.height,
            "refit_rows": refit.height,
            "sponsor_counts": SPONSOR_RULE,
            "v1_recipe": V1_RECIPE_RULE,
            "v1_recipe_max_start_year": max_start,
            "v1_recipe_chosen": v1_recipe,
            "v1_recipe_reason": v1_reason,
            "v1_recipe_baseline": m_v1s["baseline"].model_dump(),
            "v1_recipe_boosted": m_v1s["boosted"].model_dump(),
            "v1_committed": (
                f"shipped v1 model from {args.v1_dir.name}/ on held-out trials started "
                f"{V1_COMMITTED_START.isoformat()} or later, C records, its own start-year clamp"
            ),
            "parity_exempt": sorted(SPONSOR_FEATURES),
            "parity_meta": parity_meta,
            # v1's typical rates (the numbers beside estimates before v2), spec 8: old and new.
            "typical_v1": (
                None if v1_loaded is None else [t.model_dump() for t in v1_loaded.card.typical]
            ),
            "history_window_months": 12,
            "history_coverage": coverage,
        },
        features=cols,
        excluded=list(EXCLUDED_V2),
        split=artefacts.Split(
            train_end=col.cut.date.isoformat(),
            test=[col.cut.date.isoformat(), col.final.date.isoformat()],
        ),
        refit_end=col.final.date.isoformat(),
        metrics=artefacts.MetricSet(
            baseline=m_base, boosted=m_boost, boosted_no_sites=m_nosite, in_area=in_area_m
        ),
        site_leak_flag=bool(m_boost.auc - m_nosite.auc > LEAK_DROP),
        typical=artefacts.typical_rates(refit_trials),
        max_start_year=None,
        sponsor_floor=SPONSOR_FLOOR,
        n_train=n_train_trials,
        n_test=test.height,
        feature_set="v2",
        comparison=comparison,
        data_source=(
            "ClinicalTrials.gov via AACT (Clinical Trials Transformation Initiative), "
            f"snapshots {first.isoformat()}–{last.isoformat()}, processed {last.isoformat()}"
        ),
    )
    heldout = test.select(*FEATURES_V2, "label").with_columns(pl.Series("in_area", mask))
    artefacts.save(args.out, eval_ens, shipped_ens, card, heldout, col.sponsor_table)
    labels_src = _REPO / "config" / "risk" / "factor_labels.csv"
    if not (args.out / "factor_labels.csv").exists() and labels_src.exists():
        shutil.copy(labels_src, args.out / "factor_labels.csv")

    # The one print of test numbers (spec 7: nothing is tuned after this).
    print(
        f"\nstop-risk {card.version}  cutoff {comparison.cutoff}  outcome {comparison.outcome_snapshot}"
    )
    print(f"  train {n_train_trials} trials, {train.height} rows; dropped {col.train_drops}")
    print(f"  test {test.height} trials; excluded {col.exclusions}")
    print(f"  v1-recipe         {_fmt(m_v1)}  ({v1_reason})")
    other: Recipe = "boosted" if v1_recipe == "baseline" else "baseline"
    print(f"  v1-recipe {other:<8}{_fmt(m_v1s[other])}")
    print(f"  v1-recipe in area {_fmt(v1_in_area)}")
    print(f"  v1-committed      {_fmt(m_v1c)}")
    print(f"  v2 on v1 subset   {_fmt(m_v2_sub)}")
    print(f"  v2-baseline       {_fmt(m_base)}")
    print(f"  v2 (boosted)      {_fmt(m_boost)}")
    print(f"  v2 no sites       {_fmt(m_nosite)}  leak flag: {card.site_leak_flag}")
    print(f"  v2 + history      {_fmt(m_hist)}")
    print(f"  v2 in area        {_fmt(in_area_m)}")
    print(f"  v2 model: {d.recipe} ({d.recipe_reason})")
    print(f"  v2 ships: {d.v2_ships} ({d.reason})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
