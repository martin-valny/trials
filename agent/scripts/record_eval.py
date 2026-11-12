"""Record the paid evaluation: one run per pair against Bedrock and the live site data.

    uv run python scripts/record_eval.py --pairs eval/pairs.yaml --out eval/recordings \
        [--only cd20/MS] [--profile NAME] [--web-dir DIR]

A model trial uses another config file and a scratch --web-dir so nothing reaches the site:
    DILIGENCE_CONFIG=eval/setups/haiku.yaml uv run python scripts/record_eval.py \
        --pairs eval/pairs.yaml --out ../.trials/haiku/recordings --web-dir ../.trials/haiku/web \
        --only cd20/MS

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
import site_index
import yaml

from diligence.config import AgentConfig, load_config
from diligence.loop import RunRequest
from diligence.model import ModelClient, bedrock_client_config, bedrock_for
from diligence.recording import record_run
from diligence.tools.http import client
from diligence.tools.registry_of_tools import ToolContext
from diligence.tools.site import row_fingerprint

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


def _os_trust_client() -> httpx.Client:
    """The tool client, verifying HTTPS with the operating system's trust store.

    A corporate network may re-sign HTTPS for some hosts (e.g. ebi.ac.uk) with a root only the
    OS trusts. Only the tools' client gets it: botocore keeps its own (injecting truststore
    globally recurses inside botocore). Local recording only; the Lambda uses client().
    """
    import ssl

    import truststore

    ctx = truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    return client(transport=httpx.HTTPTransport(verify=ctx))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--pairs", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--only", help="target/disease")
    ap.add_argument("--profile", help="AWS profile name")
    ap.add_argument(
        "--web-dir",
        type=Path,
        default=WEB_DIR,
        help="where memos, eval-report.json and index.json go (a scratch dir for model trials)",
    )
    args = ap.parse_args(argv)

    cfg = load_config()
    model_ids = cfg.models.model_dump().values()
    if cfg.has_placeholder_models():
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
    bedrock = session.client("bedrock-runtime", cfg.region, config=bedrock_client_config())
    model = bedrock_for(cfg, cfg.region, client=bedrock)
    return record_all(
        pairs, cfg=cfg, model=model, http=_os_trust_client(), out_dir=args.out, web_dir=args.web_dir
    )


def record_all(
    pairs: list[dict[str, str]],
    *,
    cfg: AgentConfig,
    model: ModelClient,
    http: httpx.Client,
    out_dir: Path,
    web_dir: Path = WEB_DIR,
) -> int:
    """Record every pair; a failing pair is reported and skipped, never aborting the batch."""
    total = 0.0
    failed: list[str] = []
    for p in pairs:
        name = f"{p['target']}/{p['disease']}"
        try:
            cost = record_pair(
                p["target"],
                p["disease"],
                cfg=cfg,
                model=model,
                http=http,
                base_url=cfg.site_base_url,
                out_dir=out_dir,
                web_dir=web_dir,
            )
        except Exception as exc:  # noqa: BLE001 - one bad pair must not lose the paid batch
            failed.append(name)
            print(f"{name}: FAILED ({type(exc).__name__}: {exc})", file=sys.stderr)
            continue
        total += cost
        print(f"{name}: ${cost:.4f}")
    print(f"total: ${total:.4f}")
    if failed:
        print(f"{len(failed)} pair(s) failed: {', '.join(failed)}", file=sys.stderr)

    report = out_dir.parent / "report.json"
    code = eval_report.main(
        [
            "--recordings",
            str(out_dir),
            "--labels",
            str(out_dir.parent / "labels.csv"),
            "--out",
            str(report),
        ]
    )
    if code == 0:
        web_dir.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(report, web_dir / "eval-report.json")
    else:
        print("report gates failed; eval-report.json not copied to the site", file=sys.stderr)
    site_index.write_index(web_dir)
    return code or (1 if failed else 0)


if __name__ == "__main__":
    raise SystemExit(main())
