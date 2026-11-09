"""Record the paid evaluation: one run per pair against Bedrock and the live site data.

    uv run python scripts/record_eval.py --pairs eval/pairs.yaml --out eval/recordings \
        [--only cd20/MS] [--profile NAME]

Writes <out>/<target>__<disease>.jsonl, the RunRecord JSON to web/public/diligence/, then the
evaluation report (also copied to web/public/diligence/eval-report.json). Needs AWS credentials.
"""

import argparse
import shutil
import sys
from pathlib import Path
from typing import Any

import eval_report
import httpx
import yaml

from diligence.config import AgentConfig, load_config
from diligence.loop import RunRequest
from diligence.model import BedrockModel, ModelClient
from diligence.recording import record_run
from diligence.tools.http import client
from diligence.tools.registry_of_tools import ToolContext
from diligence.tools.site import row_fingerprint

PLACEHOLDER = "REPLACE_WITH"
ROOT = Path(__file__).resolve().parents[2]
WEB_DIR = ROOT / "web" / "public" / "diligence"


def record_pair(
    target: str,
    disease: str,
    *,
    cfg: AgentConfig,
    model: ModelClient,
    http: httpx.Client,
    base_url: str,
    out_dir: Path,
    web_dir: Path,
) -> float:
    """Record one pair; returns its cost in USD."""
    pipeline: dict[str, Any] = http.get(base_url + "pipeline.json").raise_for_status().json()
    risk_resp = http.get(base_url + "risk.json")
    risk = risk_resp.json() if risk_resp.status_code == 200 else None
    meta = http.get(base_url + "meta.json").raise_for_status().json()
    row = next((r for r in pipeline["rows"] if r["id"] == target), None)
    if row is None:
        raise ValueError(f"unknown target {target!r}")
    name = f"{target}__{disease}"
    rec = record_run(
        out_dir / f"{name}.jsonl",
        req=RunRequest(target, disease),
        cfg=cfg,
        model=model,
        ctx=ToolContext(http=http, base_url=base_url),
        fingerprint=row_fingerprint(pipeline, risk, target, disease),
        data_date=str(meta.get("generated_for", "")),
        label=row.get("label"),
    )
    if rec.status == "done":
        web_dir.mkdir(parents=True, exist_ok=True)
        (web_dir / f"{name}.json").write_text(rec.model_dump_json(indent=1) + "\n")
    else:
        print(f"warning: {name} ended {rec.status}; not published to the site", file=sys.stderr)
    return rec.cost_usd


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--pairs", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--only", help="target/disease")
    ap.add_argument("--profile", help="AWS profile name")
    args = ap.parse_args(argv)

    cfg = load_config()
    model_ids = cfg.models.model_dump().values()
    if any(PLACEHOLDER in m for m in model_ids):
        print(
            "config.yaml still has placeholder model IDs (REPLACE_WITH_...); "
            "set the Bedrock model IDs and prices first.",
            file=sys.stderr,
        )
        return 2
    if any(
        (p := cfg.prices.get(m)) is None or (p.input_per_mtok == 0 and p.output_per_mtok == 0)
        for m in model_ids
    ):
        print(
            "config.yaml has a missing or zero price for a model; "
            "enter the Bedrock prices first so costs are real.",
            file=sys.stderr,
        )
        return 2
    pairs = yaml.safe_load(args.pairs.read_text())["pairs"]
    if args.only:
        pairs = [p for p in pairs if f"{p['target']}/{p['disease']}" == args.only]
        if not pairs:
            print(f"no pair matches {args.only!r}", file=sys.stderr)
            return 2

    import boto3

    session = boto3.Session(profile_name=args.profile) if args.profile else boto3.Session()
    model = BedrockModel(cfg.region, client=session.client("bedrock-runtime", cfg.region))
    http = client()
    total = 0.0
    for p in pairs:
        cost = record_pair(
            p["target"],
            p["disease"],
            cfg=cfg,
            model=model,
            http=http,
            base_url=cfg.site_base_url,
            out_dir=args.out,
            web_dir=WEB_DIR,
        )
        total += cost
        print(f"{p['target']}/{p['disease']}: ${cost:.4f}")
    print(f"total: ${total:.4f}")

    report = args.out.parent / "report.json"
    code = eval_report.main(
        [
            "--recordings",
            str(args.out),
            "--labels",
            str(args.out.parent / "labels.csv"),
            "--out",
            str(report),
        ]
    )
    if code == 0:
        WEB_DIR.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(report, WEB_DIR / "eval-report.json")
    else:
        print("report gates failed; eval-report.json not copied to the site", file=sys.stderr)
    return code


if __name__ == "__main__":
    raise SystemExit(main())
