"""Train the stop-risk model from the whole registry (hand-run; the pull needs network).

Usage:
  uv run python scripts/train_stop_risk.py --cache <dir> --out ../config/risk
      [--years 2008-2025] [--offline] [--config ../config/area.yaml] [--n-boot 20]

Pulls finished phase 1-3 drug trials one start year at a time into ``<cache>/<year>.jsonl.gz``
(a cached year is skipped, so an interrupted pull resumes; ``--offline`` never fetches),
normalizes them, builds start-time features, trains a baseline logistic model and a calibrated
boosted model on starts up to 2015, evaluates both on starts 2016-2019 (plus a boosted model
without site features, and the in-area subset), picks the shipped recipe by the fixed rule,
refits it on all labelled trials started up to 2019 (later starts are mostly early stops),
takes the typical stop rates from the same trials, and writes the artefacts to ``--out``. Real registry data is never written, only the sponsor counts
table and the held-out features.
"""

from __future__ import annotations

import argparse
import gzip
import json
import shutil
import sys
from collections.abc import Iterator, Sequence
from datetime import date
from pathlib import Path
from typing import Any

import numpy as np
import polars as pl
import sklearn

from trialradar.config import load_config
from trialradar.ctgov.client import CtGovClient
from trialradar.ctgov.query import build_training_params
from trialradar.normalize import normalize
from trialradar.relevance import is_relevant
from trialradar.risk import artefacts
from trialradar.risk.artefacts import EXCLUDED, Card, Metrics, Typical
from trialradar.risk.evaluate import metrics
from trialradar.risk.features import FEATURES, SITE_FEATURES, build
from trialradar.risk.fields import RiskFields, risk_fields
from trialradar.risk.model import Recipe, fit_ensemble
from trialradar.risk.scope import LABELS, has_drug, in_phase_scope
from trialradar.risk.sponsors import SPONSOR_FLOOR, aggregate, history_rows, prior_counts
from trialradar.tables import SCHEMAS, Tables

_REPO = Path(__file__).resolve().parents[2]
FIRST_YEAR = 2008
TRAIN_END = date(2015, 12, 31)
TEST_START, TEST_END = date(2016, 1, 1), date(2019, 12, 31)
# The shipped refit stops where the test window stops: finished trials with a later start are
# mostly early stops (the ones that would complete are still running), so including them
# would teach start year "recent means stopped".
REFIT_END = TEST_END
MARGIN = 0.02
LEAK_DROP = 0.03


def _parse_years(text: str) -> range:
    lo, _, hi = text.partition("-")
    return range(int(lo), int(hi or lo) + 1)


def _read_cache(path: Path) -> Iterator[dict[str, Any]]:
    with gzip.open(path, "rt") as fh:
        for line in fh:
            if line.strip():
                yield json.loads(line)


def _fetch_year(client: CtGovClient, year: int, path: Path) -> int:
    """Stream one start year to disk (via a .part file so a crash leaves no half cache)."""
    part = path.with_suffix(path.suffix + ".part")
    n = 0
    with gzip.open(part, "wt") as fh:
        for study in client.iter_query(build_training_params(year)):
            fh.write(json.dumps(study) + "\n")
            n += 1
    part.replace(path)
    return n


def _keep(study: dict[str, Any]) -> bool:
    """Training scope: interventional, phase 1-3, drug/biological, finished, start >= 2008."""
    ps = study.get("protocolSection") or {}
    design = ps.get("designModule") or {}
    status = ps.get("statusModule") or {}
    types = [
        i.get("type")
        for i in (ps.get("armsInterventionsModule") or {}).get("interventions") or []
        if isinstance(i, dict)
    ]
    start = ((status.get("startDateStruct") or {}).get("date") or "")[:4]
    return (
        design.get("studyType") == "INTERVENTIONAL"
        and in_phase_scope(design.get("phases") or [])
        and has_drug(t for t in types if isinstance(t, str))
        and status.get("overallStatus") in LABELS
        and start.isdigit()
        and int(start) >= FIRST_YEAR
    )


def _collect(
    cache: Path, years: range, offline: bool, aliases_dir: Path, cfg: Any
) -> tuple[Tables, dict[str, RiskFields], set[str]]:
    client = None if offline else CtGovClient()
    parts: list[Tables] = []
    fields: dict[str, RiskFields] = {}
    in_area: set[str] = set()
    for year in years:
        path = cache / f"{year}.jsonl.gz"
        if not path.exists():
            if client is None:
                print(f"{year}: not cached, skipped (--offline)")
                continue
            print(f"{year}: fetching ...", flush=True)
            _fetch_year(client, year, path)
        kept: list[dict[str, Any]] = []
        total = 0
        for study in _read_cache(path):
            total += 1
            if not _keep(study):
                continue
            kept.append(study)
            rf = risk_fields(study)
            fields[rf.nct_id] = rf
            if is_relevant(study, cfg):
                in_area.add(rf.nct_id)
        print(f"{year}: {total} studies, {len(kept)} in scope", flush=True)
        if kept:
            parts.append(normalize(kept, aliases_dir))
    if not parts:
        return Tables.empty(), fields, in_area
    merged = {name: pl.concat([getattr(t, name) for t in parts]) for name in SCHEMAS}
    return Tables(**merged), fields, in_area


def _metrics(y: np.ndarray, p: np.ndarray) -> Metrics:
    return Metrics(**metrics(y, p))


def _typical(frame: pl.DataFrame) -> list[Typical]:
    """Observed stop rates by phase label and sponsor class over `frame`: the shipped refit's
    trials (starts up to REFIT_END), since later finished starts are mostly early stops."""
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


def _fmt(m: Metrics | None) -> str:
    if m is None:
        return "n/a"
    auc = "n/a" if m.auc is None else f"{m.auc:.3f}"
    return f"AUC {auc}  Brier {m.brier:.4f}  n {m.n} ({m.positives} stopped)"


def main(argv: Sequence[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--cache", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--years", default=f"{FIRST_YEAR}-{date.today().year}")
    ap.add_argument("--offline", action="store_true")
    ap.add_argument("--config", type=Path, default=_REPO / "config" / "area.yaml")
    ap.add_argument("--n-boot", type=int, default=20)
    args = ap.parse_args(argv)

    cfg = load_config(args.config)
    args.cache.mkdir(parents=True, exist_ok=True)
    tables, fields, in_area = _collect(
        args.cache, _parse_years(args.years), args.offline, cfg.aliases_dir, cfg
    )
    if tables.trial.is_empty():
        print("no studies in scope: nothing to train on", file=sys.stderr)
        return 1

    today = date.today()
    history = history_rows(tables.trial)
    feats = build(tables, fields, prior_counts(tables.trial, history))
    frame = (
        feats.join(
            tables.trial.select(
                "nct_id", "start_date", "overall_status", "phases", "sponsor_class"
            ),
            on="nct_id",
        )
        .filter(pl.col("start_date").is_not_null())
        .with_columns(
            (pl.col("overall_status") == "TERMINATED").cast(pl.Int64).alias("label"),
            pl.col("nct_id").is_in(list(in_area)).alias("in_area"),
        )
    )
    train = frame.filter(pl.col("start_date") <= TRAIN_END)
    test = frame.filter(pl.col("start_date").is_between(TEST_START, TEST_END))
    if (
        train.is_empty()
        or test.is_empty()
        or train["label"].n_unique() < 2
        or test["label"].n_unique() < 2
    ):
        print("train or test split is empty or single-class", file=sys.stderr)
        return 1

    xtr, ytr = artefacts.feature_matrix(train), train["label"].to_numpy()
    xte, yte = artefacts.feature_matrix(test), test["label"].to_numpy()
    cols = list(FEATURES)
    keep = [i for i, c in enumerate(cols) if c not in SITE_FEATURES]

    # Every metric on the card (baseline, boosted, boosted without sites, shipped, in-area)
    # comes from a bootstrap ensemble evaluated on the same held-out set, and the shipping
    # decision, reason text and leak flag are computed from exactly those numbers.
    ens_base = fit_ensemble("baseline", xtr, ytr, cols, n_boot=args.n_boot)
    ens_boost = fit_ensemble("boosted", xtr, ytr, cols, n_boot=args.n_boot)
    ens_nosite = fit_ensemble(
        "boosted", xtr[:, keep], ytr, [cols[i] for i in keep], n_boot=args.n_boot
    )
    p_base, _, _ = ens_base.predict(xte)
    p_boost, _, _ = ens_boost.predict(xte)
    p_nosite, _, _ = ens_nosite.predict(xte[:, keep])
    m_base = _metrics(yte, p_base)
    m_boost = _metrics(yte, p_boost)
    m_nosite = _metrics(yte, p_nosite)

    assert m_base.auc is not None and m_boost.auc is not None and m_nosite.auc is not None
    wins = m_boost.auc >= m_base.auc + MARGIN and m_boost.brier <= m_base.brier
    recipe: Recipe = "boosted" if wins else "baseline"
    reason = (
        f"boosted AUC {m_boost.auc:.3f} beats baseline {m_base.auc:.3f} by at least {MARGIN} "
        f"and Brier {m_boost.brier:.4f} is no worse than {m_base.brier:.4f}"
        if wins
        else f"boosted (AUC {m_boost.auc:.3f}, Brier {m_boost.brier:.4f}) does not beat baseline "
        f"(AUC {m_base.auc:.3f}, Brier {m_base.brier:.4f}) by {MARGIN} AUC with no worse Brier, "
        "so the baseline ships"
    )
    eval_ens, p_eval = (ens_boost, p_boost) if wins else (ens_base, p_base)
    mask = test["in_area"].to_numpy()
    in_area_m = (
        _metrics(yte[mask], p_eval[mask]) if mask.any() and len(np.unique(yte[mask])) == 2 else None
    )

    refit = frame.filter(pl.col("start_date") <= REFIT_END)
    xall, yall = artefacts.feature_matrix(refit), refit["label"].to_numpy()
    shipped_ens = fit_ensemble(recipe, xall, yall, cols, n_boot=args.n_boot)

    card = Card(
        version=f"stop-risk-{today:%Y%m%d}",
        trained_on=today,
        sklearn=sklearn.__version__,
        shipped=recipe,
        shipped_reason=reason,
        filter={
            "study_type": "INTERVENTIONAL",
            "phases": ["PHASE1", "PHASE2", "PHASE3"],
            "intervention_types": ["DRUG", "BIOLOGICAL"],
            "statuses": {"COMPLETED": 0, "TERMINATED": 1},
            "start_year_min": FIRST_YEAR,
            "years_pulled": args.years,
        },
        features=cols,
        excluded=list(EXCLUDED),
        split=artefacts.Split(
            train_end=TRAIN_END.isoformat(), test=[TEST_START.isoformat(), TEST_END.isoformat()]
        ),
        refit_end=REFIT_END.isoformat(),
        metrics=artefacts.MetricSet(
            baseline=m_base, boosted=m_boost, boosted_no_sites=m_nosite, in_area=in_area_m
        ),
        site_leak_flag=bool(m_boost.auc - m_nosite.auc > LEAK_DROP),
        typical=_typical(refit),
        max_start_year=int(refit["start_year"].max()),  # type: ignore[arg-type]
        sponsor_floor=SPONSOR_FLOOR,
        n_train=train.height,
        n_test=test.height,
    )
    heldout = test.select(*FEATURES, "label", "in_area")
    artefacts.save(args.out, eval_ens, shipped_ens, card, heldout, aggregate(history, today))
    for name in ("factor_labels.csv", "README.md"):
        src = _REPO / "config" / "risk" / name
        if not (args.out / name).exists() and src.exists():
            shutil.copy(src, args.out / name)

    print(f"\nstop-risk {card.version}: train {card.n_train}, test {card.n_test}")
    print(f"  baseline          {_fmt(m_base)}")
    print(f"  boosted           {_fmt(m_boost)}")
    print(f"  boosted no sites  {_fmt(m_nosite)}  leak flag: {card.site_leak_flag}")
    print(f"  in area           {_fmt(in_area_m)}")
    print(f"  shipped: {recipe} ({reason})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
