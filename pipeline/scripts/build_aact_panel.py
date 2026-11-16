"""Build the compact AACT quarterly panel (git-ignored Parquet under the cache dir).

Usage: uv run python scripts/build_aact_panel.py --cache .cache/aact [--credentials PATH] [--only 2021-12-01]

Resumable: dates whose nine table parquets exist are skipped, and a complete extracted
raw/<date>/<table>.txt (never a .tmp) is reused instead of downloaded again. The
latest-2026-01 (outcome) archive is processed first, then the quarterly ones; the in-scope id set accumulates across
archives (persisted in <cache>/panel/ids.parquet) so a trial in scope at the end keeps its
rows in earlier snapshots.
"""

from __future__ import annotations

import argparse
import logging
import time
from collections.abc import Callable
from datetime import date
from pathlib import Path

import httpx
import polars as pl

from trialradar.aact.archive import Archive, extract_table, list_archives, read_api_key
from trialradar.aact.panel import (
    TABLES,
    fold_archive,
    monthly_studies,
    panel_scope_ids,
    pick_quarterly,
)

HOME = Path.home()
DEFAULT_CREDENTIALS = HOME / "Desktop/event-signal-backtest/data/raw/aact/.credentials"
DEFAULT_MONTHLY = HOME / "Desktop/event-signal-backtest/data/raw/aact/studies"
DEFAULT_CACHE = Path(".cache/aact")


def _done(panel: Path, snap: date) -> bool:
    return all((panel / t / f"{snap.isoformat()}.parquet").exists() for t in TABLES)


def ensure_table(
    arch: Archive,
    table: str,
    raw: Path,
    api_key: str,
    *,
    client: httpx.Client,
    extract: Callable[..., Path] = extract_table,
) -> Path:
    """Reuse a complete ``raw/<table>.txt``, else extract it.

    ``extract_table`` CRC-checks into ``<table>.txt.tmp`` before renaming, so a final ``.txt``
    is always complete; a leftover ``.tmp`` is never reused (extract overwrites it).
    """
    final = raw / f"{table}.txt"
    if final.is_file():
        print(f"{arch.snap_date} {table}: reusing {final}")
        return final
    return extract(arch, table, raw, api_key, client=client)


def _load_ids(panel: Path) -> set[str]:
    path = panel / "ids.parquet"
    return set(pl.read_parquet(path)["nct_id"].to_list()) if path.exists() else set()


def _save_ids(panel: Path, ids: set[str]) -> None:
    tmp = panel / "ids.parquet.tmp"
    pl.DataFrame({"nct_id": sorted(ids)}, schema={"nct_id": pl.String}).write_parquet(tmp)
    tmp.replace(panel / "ids.parquet")


def _os_trust_client() -> httpx.Client:
    """HTTP client verifying TLS with the OS trust store (corporate TLS interception)."""
    import ssl

    try:
        import truststore
    except ImportError as exc:
        raise SystemExit("truststore is required: run `uv sync` (dev dependency group)") from exc
    return httpx.Client(verify=truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT), timeout=120)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--cache", type=Path, default=DEFAULT_CACHE)
    ap.add_argument("--credentials", type=Path, default=DEFAULT_CREDENTIALS)
    ap.add_argument("--monthly-src", type=Path, default=DEFAULT_MONTHLY)
    ap.add_argument(
        "--only", type=date.fromisoformat, default=None, help="process one snapshot date"
    )
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    api_key = read_api_key(args.credentials)
    panel = args.cache / "panel"
    panel.mkdir(parents=True, exist_ok=True)
    client = _os_trust_client()
    picked = pick_quarterly(list_archives(args.cache, api_key, client=client))
    if not picked:
        raise SystemExit("no AACT archives picked: listing empty or no archive near any quarter")
    if (picked[-1].snap_date.year, picked[-1].snap_date.month) != (2026, 1):
        raise SystemExit(
            f"outcome archive missing: latest pick is {picked[-1].snap_date}, expected 2026-01"
        )
    order = [picked[-1], *picked[:-1]]  # outcome archive first
    ids = _load_ids(panel)
    for arch in order:
        if args.only and arch.snap_date != args.only:
            continue
        if _done(panel, arch.snap_date):
            ids |= panel_scope_ids(panel, arch.snap_date)  # self-heal ids after a crash
            print(f"{arch.snap_date} skip (done)")
            continue
        t0 = time.monotonic()
        raw = args.cache / "raw" / arch.snap_date.isoformat()
        for table in TABLES:
            ensure_table(arch, table, raw, api_key, client=client)
        ids |= fold_archive(raw, arch.snap_date, panel, ids)
        _save_ids(panel, ids)
        rows = {
            t: pl.scan_parquet(panel / t / f"{arch.snap_date}.parquet")
            .select(pl.len())
            .collect()
            .item()
            for t in TABLES
        }
        print(f"{arch.snap_date} {time.monotonic() - t0:.0f}s rows={rows} ids={len(ids)}")
    _save_ids(panel, ids)
    print(f"in-scope ids (union): {len(ids)}")
    if args.monthly_src.exists():
        monthly_studies(args.monthly_src, panel, ids)


if __name__ == "__main__":
    main()
