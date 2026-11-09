"""Report on a built site's ``pipeline.json`` (spec §6): coverage, tuning gaps, size.

``uv run python scripts/pipeline_report.py <site_dir>``. Exit code 1 if the file is over
200 KB or missing. Unlisted classes and sponsors come from the run warnings in ``meta.json``.
"""

from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

MAX_BYTES = 200 * 1024
COMPARATOR_ROWS = frozenset({"interferon-beta", "glatiramer", "glucocorticoids"})
UNLISTED = ("pipeline_unlisted_classes", "pipeline_unlisted_sponsors")


def report(site: Path) -> tuple[str, int]:
    path = site / "pipeline.json"
    if not path.is_file():
        return f"no pipeline.json in {site}\n", 1
    size = path.stat().st_size
    doc: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    lines: list[str] = [f"pipeline.json for {doc['generated_for']}", ""]
    c = doc["counts"]
    lines.append(
        f"trials {c['trials']}, targeted {c['targeted']}, in rows {c['in_rows']}, "
        f"targeted but not in a row {c['targeted_not_rowed']}"
    )
    lines += ["", f"{'row':<22}{'running':>8}{'total':>7}{'advanced':>9}{'stopped':>8}"]
    in_rows: dict[str, list[str]] = defaultdict(list)
    for row in doc["rows"]:
        states = Counter(m["s"] for m in row["marks"])
        lines.append(
            f"{row['id']:<22}{states['run']:>8}{len(row['marks']):>7}"
            f"{states['adv']:>9}{states['stop']:>8}"
        )
        for m in row["marks"]:
            in_rows[m["n"]].append(row["id"])
    approved = Counter(code for row in doc["rows"] for code in row.get("ap", {}))
    cells = ", ".join(
        f"{d['code']} {approved[d['code']]}" for d in doc["diseases"] if approved[d["code"]]
    )
    lines += ["", f"Approved cells: {cells or 'none'}"]
    reasons = [t["r"] for t in doc["trials"].values() if "r" in t and t["r"] != "Not given"]
    other = reasons.count("Other")
    share = f"{other / len(reasons):.1%}" if reasons else "n/a"
    lines += ["", f"Other share of stopped trials with a reason: {other}/{len(reasons)} = {share}"]
    lines.append(
        "Stop reasons: " + ", ".join(f"{g} {n}" for g, n in Counter(reasons).most_common())
    )
    meta_path = site / "meta.json"
    warnings: list[str] = []
    if meta_path.is_file():
        warnings = json.loads(meta_path.read_text(encoding="utf-8")).get("warnings", [])
    lines.append("")
    for key in UNLISTED:
        found = [w for w in warnings if w.startswith(key)]
        lines.append(found[0] if found else f"{key}: none")
    cases = sorted(
        (n, ids) for n, ids in in_rows.items() if len(ids) >= 2 and COMPARATOR_ROWS & set(ids)
    )
    lines += ["", f"Comparator cases (in 2+ rows, one a comparator row): {len(cases)}"]
    lines += [f"  {n}: {', '.join(ids)}" for n, ids in cases]
    lines += ["", f"size {size} bytes ({size / 1024:.1f} KB; limit {MAX_BYTES // 1024} KB)"]
    return "\n".join(lines) + "\n", 1 if size > MAX_BYTES else 0


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: pipeline_report.py <site_dir>", file=sys.stderr)
        return 2
    text, code = report(Path(argv[1]))
    sys.stdout.write(text)
    return code


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
