"""Print the most frequent cleaned experimental-arm drug names in a raw snapshot.

Usage: uv run python scripts/top_drugs.py <snapshot.jsonl.gz> [--config PATH] [--top N]
"""

from __future__ import annotations

import argparse
from collections import Counter
from pathlib import Path

from trialradar.config import load_config
from trialradar.explorer.drugs import clean_drug_name
from trialradar.explorer.extras import extract_extras
from trialradar.relevance import filter_relevant
from trialradar.snapshot import read_snapshot
from trialradar.textnorm import load_aliases

_REPO = Path(__file__).resolve().parents[2]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("snapshot", type=Path)
    ap.add_argument("--config", type=Path, default=_REPO / "config" / "area.yaml")
    ap.add_argument("--top", type=int, default=60)
    args = ap.parse_args()

    cfg = load_config(args.config)
    aliases = load_aliases(cfg.aliases_dir / "intervention.csv")
    relevant = filter_relevant(read_snapshot(args.snapshot), cfg)
    counts: Counter[str] = Counter()
    for extras in extract_extras(relevant, cfg)[0].values():
        names = {
            clean_drug_name(n, aliases, cfg.explorer.exclude_terms)
            for n in extras.experimental_drugs
        }
        counts.update(n for n in names if n)
    for name, n in counts.most_common(args.top):
        print(f"{n:6d}  {name}")


if __name__ == "__main__":
    main()
