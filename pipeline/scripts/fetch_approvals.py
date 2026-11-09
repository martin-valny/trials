"""Find which drugs are approved for which disease, per pipeline row (hand-run, network).

Usage:
  uv run python scripts/fetch_approvals.py [--config ../config/area.yaml]
      [--out config/approvals] [--cache pipeline/.cache/approvals] [--record DIR]

Reads the figure rows, the mechanism CSVs and each condition's ``approvals`` block from the
area config, asks ChEMBL (phase-4 indications) and openFDA (label text) about every drug on
each row's target, applies ``<out>/overrides.csv`` (never written here) and writes
``<out>/approvals.csv``. Prints a review: cells found by one source only, cells where the
sources disagree, every hand row, label matches with a negation nearby, then approved rows
per disease. A client error aborts the run before anything is written.
``--record DIR`` saves every fetched response as test fixtures. On this Mac, set
``SSL_CERT_FILE`` as for ``map_mechanisms.py``.
"""

from __future__ import annotations

import argparse
from collections.abc import Sequence
from pathlib import Path

from trialradar.approvals.build import Review, build_approvals
from trialradar.approvals.io import read_overrides, write_approvals
from trialradar.approvals.openfda import OpenFdaClient
from trialradar.config import ApprovalTerms, load_config
from trialradar.mechanisms.chembl import ChemblClient
from trialradar.mechanisms.io import read_mappings
from trialradar.pipeline_figure.io import read_figure_config

_REPO = Path(__file__).resolve().parents[2]


def print_review(review: Review) -> None:
    blocks = (
        ("Found by one source only", review.one_source),
        ("Sources disagree", review.disagree),
        ("Hand rows", review.hand),
        ("Label mentions with a negation nearby", review.negated),
    )
    for title, lines in blocks:
        print(f"\n{title} ({len(lines)})")
        for line in lines:
            print(f"  {line}")
    print("\nApproved rows per disease")
    for disease, n in review.counts.items():
        print(f"  {disease}: {n}")


def main(argv: Sequence[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--config", type=Path, default=_REPO / "config" / "area.yaml")
    ap.add_argument("--out", type=Path, default=_REPO / "config" / "approvals")
    ap.add_argument("--cache", type=Path, default=_REPO / "pipeline" / ".cache" / "approvals")
    ap.add_argument("--record", type=Path, default=None, help="save fetched responses here")
    args = ap.parse_args(argv)
    cfg = load_config(args.config)
    rows = read_figure_config(cfg.pipeline_dir, cfg.sponsors_dir, cfg.stop_reasons).rows
    terms: dict[str, ApprovalTerms] = {
        c.code: c.approvals for c in cfg.conditions if c.code and c.approvals
    }
    chembl = ChemblClient(cache_dir=args.cache / "chembl", record_dir=args.record)
    fda = OpenFdaClient(cache_dir=args.cache / "openfda", record_dir=args.record)
    items, review = build_approvals(
        rows,
        read_mappings(cfg.mechanisms_dir),
        terms,
        chembl,
        fda,
        read_overrides(args.out / "overrides.csv"),
    )
    args.out.mkdir(parents=True, exist_ok=True)
    write_approvals(args.out / "approvals.csv", items)
    print(f"wrote {len(items)} approvals to {args.out / 'approvals.csv'}")
    print_review(review)


if __name__ == "__main__":
    main()
