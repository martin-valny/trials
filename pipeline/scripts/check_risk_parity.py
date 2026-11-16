"""Train/serve parity for the stop-risk v2 features: AACT snapshot vs the live registry API.

Usage (hand-run, needs network):
  uv run python scripts/check_risk_parity.py --panel .cache/aact/panel --sample 500
      [--config ../config/area.yaml] [--out parity.json] [--seed 0]

Spec 2026-11-15 section 6.4. From the outcome (2026-01) AACT snapshot, takes the trials in the
model's scope (``split_v2.in_scope``) in a seeded random order, fetches their live records from
ClinicalTrials.gov in batches (``CtGovClient`` + ``normalize``, as the daily run reads them) and
keeps those whose live ``last_update_post_date`` equals the AACT one (the record has not changed
since the snapshot) and that the daily run would still score live on the snapshot date (status
still running and not finished in all but status; the registry flips lapsed records to UNKNOWN
without a new update date, and those are counted in the meta file, not compared), until
``--sample`` are kept. Both sides go through ``build_v2`` with the
same ``as_of`` (the snapshot date) and the same sponsor table (the snapshot's own finished
trials), and every FEATURES_V2 feature is compared trial by trial, matched by nct_id: ints and
flags exactly, floats within 1e-9, null equal to null.

Writes ``--out`` (default parity.json): ``{feature: mismatch share}`` for every FEATURES_V2
feature plus ``"exempt"`` (the sponsor features: reported, never part of the bar), the format
``train_stop_risk_v2.py --parity`` reads. Counts and dates go to ``<out stem>.meta.json``
beside it, so the trainer never mistakes them for a feature.
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from collections.abc import Iterable, Iterator, Mapping, Sequence
from datetime import date
from pathlib import Path
from typing import Any, Protocol

import httpx
import polars as pl

from trialradar.aact.adapter import load_snapshot, mesh_categories
from trialradar.config import load_config
from trialradar.ctgov.client import CtGovClient
from trialradar.explorer.extras import extract_extras
from trialradar.normalize import normalize
from trialradar.risk.explain import SPONSOR_FEATURES  # exempt from the bar (spec 6.4)
from trialradar.risk.features_v2 import FEATURES_V2, build_v2
from trialradar.risk.scope import RUNNING, finished_reason
from trialradar.risk.split_v2 import in_scope
from trialradar.risk.sponsors import aggregate, history_rows, live_counts
from trialradar.tables import Tables
from trialradar.textnorm import load_alias_set

_REPO = Path(__file__).resolve().parents[2]
FLOAT_TOL = 1e-9
BATCH = 100
"""NCT ids per API request (keeps the query string short)."""
OUTCOME_MONTH = (2026, 1)


class _Client(Protocol):
    def iter_query(self, params: dict[str, str]) -> Iterator[dict[str, Any]]: ...


def _exact(dtype: pl.DataType) -> bool:
    return dtype.is_integer() or dtype == pl.Boolean


def compare(
    a: pl.DataFrame, b: pl.DataFrame, features: Sequence[str] = FEATURES_V2
) -> tuple[dict[str, float], int]:
    """({feature: share of shared trials whose values differ}, number of shared trials).

    Rows are matched by nct_id (never by position); trials on one side only are left out.
    Ints and flags must be equal, floats within FLOAT_TOL; null equals null, NaN counts as null,
    null against a value is a mismatch."""
    joined = a.select("nct_id", *features).join(
        b.select("nct_id", *features), on="nct_id", how="inner", suffix="__b"
    )
    if joined.height == 0:
        raise ValueError("no trial is on both sides: nothing to compare")
    out: dict[str, float] = {}
    for f in features:
        exact = _exact(a.schema[f]) and _exact(b.schema[f])
        x = pl.col(f).cast(pl.Float64).fill_nan(None)
        y = pl.col(f"{f}__b").cast(pl.Float64).fill_nan(None)
        same_value = (x == y) if exact else ((x - y).abs() <= FLOAT_TOL)
        same = (x.is_null() & y.is_null()) | same_value.fill_null(False)
        out[f] = float(joined.select((~same).mean()).item())
    return out, joined.height


def _batches(ids: Sequence[str], size: int) -> Iterable[list[str]]:
    for i in range(0, len(ids), size):
        yield list(ids[i : i + size])


def live_exclusion(trial: Mapping[str, Any], has_results: bool, as_of: date) -> str | None:
    """Why the daily run would not score this live record on `as_of`, or None.

    "live_not_running": its status left RUNNING (the registry flips a record whose verification
    lapsed to UNKNOWN without changing last_update_post_date); "live_finished": finished in all
    but status (``scope.finished_reason``). Neither is a train/serve mismatch, so such trials
    are counted and left out of the comparison."""
    if trial["overall_status"] not in RUNNING:
        return "live_not_running"
    if finished_reason(trial, has_results, as_of) is not None:
        return "live_finished"
    return None


def matched_sample(
    client: _Client,
    aact_updates: Mapping[str, date | None],
    *,
    n: int,
    aliases_dir: Path,
    as_of: date,
    seed: int = 0,
    batch: int = BATCH,
) -> tuple[list[dict[str, Any]], Tables, dict[str, int]]:
    """Live records and tables for up to `n` trials that are unchanged since the snapshot (live
    last_update_post_date equals the AACT one) and still scored live on `as_of`.

    Candidates (`aact_updates` keys) are shuffled with `seed` and fetched `batch` at a time
    until `n` are kept; a trial without an AACT update date never matches, and an unchanged
    record the daily run would not score (``live_exclusion``) is counted, not kept. Returns the
    kept raw records, their normalized tables and counts (candidates, fetched, unchanged,
    live_not_running, live_finished, matched)."""
    order = sorted(aact_updates)
    random.Random(seed).shuffle(order)
    kept: list[dict[str, Any]] = []
    counts = {"fetched": 0, "unchanged": 0, "live_not_running": 0, "live_finished": 0}
    for ids in _batches(order, batch):
        params = {"filter.ids": ",".join(ids), "pageSize": str(batch), "format": "json"}
        studies = list(client.iter_query(params))
        counts["fetched"] += len(studies)
        live = {r["nct_id"]: r for r in normalize(studies, aliases_dir).trial.iter_rows(named=True)}
        for s in studies:
            if len(kept) >= n:
                break
            nct = s["protocolSection"]["identificationModule"]["nctId"]
            row = live.get(nct)
            if row is None or aact_updates.get(nct) is None:
                continue
            if row["last_update_post_date"] != aact_updates[nct]:
                continue
            counts["unchanged"] += 1
            if reason := live_exclusion(row, bool(s.get("hasResults", False)), as_of):
                counts[reason] += 1
                continue
            kept.append(s)
        if len(kept) >= n:
            break
    report = {"candidates": len(order), **counts, "matched": len(kept)}
    return kept, normalize(kept, aliases_dir), report


def write_parity(out: Path, shares: Mapping[str, float], meta: Mapping[str, Any]) -> Path:
    """parity.json (shares + "exempt") and its sibling <stem>.meta.json; returns the meta path."""
    body: dict[str, Any] = {f: shares[f] for f in shares}
    body["exempt"] = sorted(SPONSOR_FEATURES)
    out.write_text(json.dumps(body, indent=2) + "\n")
    meta_path = out.with_name(f"{out.stem}.meta.json")
    meta_path.write_text(json.dumps(dict(meta), indent=2) + "\n")
    return meta_path


def _os_trust_client() -> httpx.Client:
    """HTTP client verifying TLS with the OS trust store (corporate TLS interception)."""
    import ssl

    try:
        import truststore
    except ImportError as exc:
        raise SystemExit("truststore is required: run `uv sync` (dev dependency group)") from exc
    return httpx.Client(verify=truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT), timeout=120)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--panel", type=Path, required=True)
    ap.add_argument("--sample", type=int, default=500)
    ap.add_argument("--config", type=Path, default=_REPO / "config" / "area.yaml")
    ap.add_argument("--out", type=Path, default=Path("parity.json"))
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    cfg = load_config(args.config)
    dates = sorted(date.fromisoformat(p.stem) for p in (args.panel / "studies").glob("*.parquet"))
    if not dates or (dates[-1].year, dates[-1].month) != OUTCOME_MONTH:
        raise SystemExit(f"outcome snapshot missing: latest panel date {dates[-1:]}, want 2026-01")
    as_of = dates[-1]
    snap = load_snapshot(
        args.panel,
        as_of,
        aliases=load_alias_set(cfg.aliases_dir),
        categories=mesh_categories(args.panel, as_of),
    )
    scope = in_scope(snap)
    aact_trial = snap.tables.trial
    updates = {
        n: d
        for n, d in aact_trial.select("nct_id", "last_update_post_date").iter_rows()
        if n in scope
    }
    print(f"{as_of}: {len(scope)} trials in scope; fetching live records ...", flush=True)
    studies, live, report = matched_sample(
        CtGovClient(http=_os_trust_client()),
        updates,
        n=args.sample,
        aliases_dir=cfg.aliases_dir,
        as_of=as_of,
        seed=args.seed,
    )
    print(
        f"fetched {report['fetched']}, unchanged since the snapshot {report['unchanged']}, "
        f"left out as no longer running live {report['live_not_running']}, as finished in all "
        f"but status live {report['live_finished']}; compared {report['matched']}"
    )
    if report["matched"] == 0:
        raise SystemExit("no live record matches its AACT update date: nothing to compare")

    # One sponsor table for both sides: the snapshot's own finished trials before as_of.
    table = aggregate(history_rows(aact_trial).filter(pl.col("end_date") < as_of), as_of)
    a = build_v2(snap.tables, snap.fields, live_counts(aact_trial, table), as_of=as_of)
    extras, _ = extract_extras(studies, cfg)
    fields = {n: x.risk for n, x in extras.items() if x.risk is not None}
    b = build_v2(live, fields, live_counts(live.trial, table), as_of=as_of)
    shares, n = compare(a, b)
    for f in FEATURES_V2:
        mark = "  (exempt)" if f in SPONSOR_FEATURES else ""
        print(f"{f:<40} {shares[f]:7.2%}{mark}")
    meta = {"as_of": as_of.isoformat(), "n_trials": n, "seed": args.seed, **report}
    meta_path = write_parity(args.out, shares, meta)
    print(f"wrote {args.out} and {meta_path} ({n} trials)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
