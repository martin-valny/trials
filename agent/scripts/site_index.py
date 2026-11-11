"""Index of the recorded runs published to the site.

    uv run python scripts/site_index.py [--web-dir web/public/diligence]

Writes index.json next to the memos: {"runs": [{"target", "disease"}]}, sorted, from the
records whose status is done. The site derives stance and claim counts from each memo.
"""

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WEB_DIR = ROOT / "web" / "public" / "diligence"
_NOT_MEMOS = {"eval-report.json", "index.json"}


def write_index(web_dir: Path) -> int:
    """Rebuild index.json from the done memos in web_dir; returns the number of runs."""
    pairs: set[tuple[str, str]] = set()
    for path in web_dir.glob("*__*.json"):
        if path.name in _NOT_MEMOS:
            continue
        try:
            record = json.loads(path.read_text())
            if record["status"] == "done":
                pairs.add((str(record["target"]), str(record["disease"])))
        except (OSError, ValueError, KeyError, TypeError):
            continue
    runs = [{"target": t, "disease": d} for t, d in sorted(pairs)]
    web_dir.mkdir(parents=True, exist_ok=True)
    (web_dir / "index.json").write_text(json.dumps({"runs": runs}, indent=1) + "\n")
    return len(runs)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--web-dir", type=Path, default=WEB_DIR)
    args = ap.parse_args(argv)
    print(f"{write_index(args.web_dir)} runs -> {args.web_dir / 'index.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
