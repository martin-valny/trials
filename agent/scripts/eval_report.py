"""Evaluation report from recordings: metrics computed from the stored result lines, no models.

    uv run python scripts/eval_report.py --recordings eval/recordings --labels eval/labels.csv \
        --out eval/report.json
"""

import argparse
import csv
import json
import shutil
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import site_index

from diligence.config import AgentConfig, load_config
from diligence.model import prompt_hash, read_lines
from diligence.recording import meta_of
from diligence.types import RunRecord

METRICS = (
    "citation_validity",
    "support_rate",
    "judgement_shown_rate",
    "cost_usd_mean",
    "seconds_mean",
)
SUPPORT_TOLERANCE = 0.05
UNRETRIEVED_REASON = "not retrieved in this run"
_STAMP = "%Y-%m-%dT%H:%M:%SZ"


def assert_hash_current(path: Path, cfg: AgentConfig) -> None:
    got = meta_of(path).get("prompt_hash")
    assert got == prompt_hash(cfg), (
        f"{path.name}: prompts, tool schemas or model IDs changed since it was recorded; "
        "re-record the evaluation"
    )


def _load(path: Path) -> tuple[dict[str, Any], RunRecord, set[str]]:
    lines = read_lines(path)
    retrieved: set[str] = set()
    for line in lines:
        if line["kind"] == "tool":
            retrieved.update(line["result"].get("ids", []))
    return lines[0], RunRecord.model_validate(lines[-1]["record"]), retrieved


def _seconds(rec: RunRecord) -> float:
    if not rec.finished_at:
        return 0.0
    start = datetime.strptime(rec.started_at, _STAMP)
    return (datetime.strptime(rec.finished_at, _STAMP) - start).total_seconds()


def _mean(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


def _agreement(labels: Path, verdicts: dict[tuple[str, str], str]) -> float | None:
    if not labels.exists():
        return None
    with labels.open(newline="") as f:
        rows = [r for r in csv.DictReader(f) if (r.get("run"), r.get("sentence_id")) in verdicts]
    if not rows:
        return None
    agree = sum(verdicts[(r["run"], r["sentence_id"])] == r["label"].strip() for r in rows)
    return agree / len(rows)


def build_report(recordings: Path, labels: Path, previous: dict[str, Any] | None) -> dict[str, Any]:
    runs = [(p, *_load(p)) for p in sorted(recordings.glob("*.jsonl"))]
    cites = valid = supported = checked = shown = 0
    written = unretrieved = 0
    verdict_by_sentence: dict[tuple[str, str], str] = {}
    for path, _meta, rec, retrieved in runs:
        if rec.memo:
            for sentence in rec.memo.sections:
                cites += len(sentence.cites)
                valid += sum(c in retrieved for c in sentence.cites)
        # Before the check: sentences the deterministic check removed for an unretrieved ID.
        written += (len(rec.memo.sections) if rec.memo else 0) + len(rec.removed)
        unretrieved += sum(
            str(r.get("reason", "")).endswith(UNRETRIEVED_REASON) for r in rec.removed
        )
        checked += len(rec.verdicts)
        supported += sum(v.verdict == "supported" for v in rec.verdicts)
        shown += rec.judgement_shown
        for v in rec.verdicts:
            verdict_by_sentence[(path.stem, v.sentence_id)] = v.verdict
    n = len(runs)
    report: dict[str, Any] = {
        # After the check this is 1.0 by construction; unretrieved_removal_rate is the model's own rate.
        "citation_validity": valid / cites if cites else (1.0 if n else None),
        "unretrieved_removal_rate": unretrieved / written if written else None,
        "support_rate": supported / checked if checked else None,
        "checker_agreement": _agreement(labels, verdict_by_sentence),
        "judgement_shown_rate": shown / n if n else None,
        "cost_usd_mean": _mean([rec.cost_usd for _, _, rec, _ in runs]),
        "seconds_mean": _mean([_seconds(rec) for _, _, rec, _ in runs]),
        "n_runs": n,
        "models": runs[0][2].models if runs else {},
        "agent_version": runs[0][1].get("agent_version") if runs else None,
        "generated_at": datetime.now(UTC).strftime(_STAMP),
    }
    carried = (previous or {}).get("baseline")
    report["baseline"] = carried if carried else {k: report[k] for k in METRICS}
    return report


def check_gates(report: dict[str, Any]) -> list[str]:
    """Reasons the report fails the gates; empty means it passes."""
    problems: list[str] = []
    validity = report.get("citation_validity")
    if validity is not None and validity != 1.0:
        problems.append(f"citation_validity is {validity}, must be 1.0")
    rate = report.get("support_rate")
    base = (report.get("baseline") or {}).get("support_rate")
    if rate is not None and base is not None and rate < base - SUPPORT_TOLERANCE:
        problems.append(f"support_rate {rate:.3f} is below baseline {base:.3f} minus 0.05")
    return problems


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--recordings", type=Path, default=Path("eval/recordings"))
    ap.add_argument("--labels", type=Path, default=Path("eval/labels.csv"))
    ap.add_argument("--out", type=Path, default=Path("eval/report.json"))
    ap.add_argument("--web-dir", type=Path, help="publish the report and the runs index here")
    args = ap.parse_args(argv)
    previous = json.loads(args.out.read_text()) if args.out.exists() else None
    cfg = load_config()
    for path in sorted(args.recordings.glob("*.jsonl")):
        assert_hash_current(path, cfg)
    report = build_report(args.recordings, args.labels, previous)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2) + "\n")
    problems = check_gates(report)
    for p in problems:
        print(f"GATE FAILED: {p}")
    print(f"{report['n_runs']} runs -> {args.out}")
    if args.web_dir:
        if not problems:
            args.web_dir.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(args.out, args.web_dir / "eval-report.json")
        site_index.write_index(args.web_dir)
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
