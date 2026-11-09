"""Tools over the site's own published JSON: pipeline.json, risk.json, trials/<NCT>.json."""

import hashlib
from collections import Counter
from typing import Any

import httpx

from diligence.tools.http import ToolError, get_json, get_response, trim
from diligence.types import ToolResult

MAX_TRIALS = 30
STATE_LABEL = {
    "adv": "advanced",
    "run": "running",
    "stop": "stopped",
    "fin": "finished",
    "unk": "unknown",
}


def _find_row(pipeline: dict[str, Any], target: str) -> dict[str, Any] | None:
    for row in pipeline.get("rows", []):
        if row.get("id") == target:
            return row  # type: ignore[no-any-return]
    return None


def _marks(row: dict[str, Any], disease: str) -> list[dict[str, Any]]:
    marks: list[dict[str, Any]] = row.get("marks", [])
    return marks if disease == "all" else [m for m in marks if disease in m.get("dz", [])]


def row_fingerprint(
    pipeline: dict[str, Any], risk: dict[str, Any] | None, target: str, disease: str
) -> str:
    """Hash of what the row shows for this disease: (NCT, state, phase, why) plus rounded risk p."""
    row = _find_row(pipeline, target)
    marks = _marks(row, disease) if row else []
    info = pipeline.get("trials", {})
    parts = sorted(
        (m["n"], m.get("s"), m.get("c"), (info.get(m["n"]) or {}).get("why") or "") for m in marks
    )
    risks = (risk or {}).get("trials", {})
    ps = sorted((m["n"], round(float(risks[m["n"]]["p"]), 2)) for m in marks if m["n"] in risks)
    blob = repr((parts, ps)).encode()
    return hashlib.sha256(blob).hexdigest()


def _phase_label(phases: list[str]) -> str:
    return "/".join(p.replace("PHASE", "") for p in phases) or "NA"


def site_target(target: str, disease: str, *, base_url: str, http: httpx.Client) -> ToolResult:
    args = {"target": target, "disease": disease}
    try:
        pipeline = get_json(http, base_url + "pipeline.json")
        row = _find_row(pipeline, target)
        if row is None:
            return ToolResult(name="site_target", args=args, error=f"unknown target {target!r}")
        marks = _marks(row, disease)
        sponsors = pipeline.get("sponsors", [])
        info = pipeline.get("trials", {})
        trials: list[dict[str, Any]] = []
        for m in marks:
            nct = m["n"]
            t: dict[str, Any] = {
                "nct": nct,
                "title": trim((info.get(nct) or {}).get("t", ""), 120),
                "state": STATE_LABEL.get(m.get("s", "unk"), "unknown"),
                "drug": m.get("drug"),
                "start_year": m.get("y"),
                "end_year": m.get("y2"),
            }
            resp = get_response(http, f"{base_url}trials/{nct}.json")
            if resp.status_code == 200:
                full = resp.json()
                t["title"] = trim(full.get("title") or t["title"], 120)
                t["phases"] = full.get("phases", [])
                t["overall_status"] = full.get("overall_status")
                t["why_stopped"] = trim(full.get("why_stopped") or "", 300) or None
                t["lead_sponsor"] = full.get("lead_sponsor")
            else:
                t["why_stopped"] = (info.get(nct) or {}).get("why")
            trials.append(t)
        by_status = Counter(t["state"] for t in trials)
        by_phase = Counter(f"Phase {m.get('c')}" for m in marks)
        companies = Counter(
            sponsors[m["sp"]]["parent"] for m in marks if 0 <= m.get("sp", -1) < len(sponsors)
        )
        approved = {
            dz: [
                {
                    "drug": a["d"],
                    "regulator": a.get("reg"),
                    "year": a.get("y"),
                    "withdrawn": bool(a.get("wd")),
                }
                for a in drugs
            ]
            for dz, drugs in (row.get("ap") or {}).items()
            if disease == "all" or dz == disease
        }
        data = {
            "row": {
                "id": row["id"],
                "label": row.get("label"),
                "gene": row.get("gene"),
                "blurb": row.get("blurb"),
            },
            "trials": trials[:MAX_TRIALS],
            "trials_total": len(trials),
            "counts_by_status": dict(by_status),
            "counts_by_phase": dict(sorted(by_phase.items())),
            "companies": dict(companies.most_common(10)),
            "chain": {
                "family": row.get("sub"),
                "drugs": sorted({m["drug"] for m in marks if m.get("drug")}),
                "approved": approved,
                "related_targets": row.get("related", []),
            },
        }
        ids = [t["nct"] for t in trials[:MAX_TRIALS]]
        return ToolResult(name="site_target", args=args, data=data, ids=ids)
    except (ToolError, ValueError, KeyError, TypeError) as exc:
        return ToolResult(name="site_target", args=args, error=f"site data unavailable: {exc}")


def site_risk(target: str, disease: str, *, base_url: str, http: httpx.Client) -> ToolResult:
    args = {"target": target, "disease": disease}
    note = {"note": "Stop-risk estimates unavailable"}
    try:
        pipeline = get_json(http, base_url + "pipeline.json")
        row = _find_row(pipeline, target)
        if row is None:
            return ToolResult(name="site_risk", args=args, error=f"unknown target {target!r}")
        resp = get_response(http, base_url + "risk.json")
        if resp.status_code != 200:
            return ToolResult(name="site_risk", args=args, data=note)
        risk = resp.json()
        scored = risk.get("trials", {})
        marks = _marks(row, disease)
        trials = [
            {
                "nct": m["n"],
                "p": s["p"],
                "lo": s.get("lo"),
                "hi": s.get("hi"),
                "typical": s.get("typical"),
                "basis": s.get("basis"),
                "factors": [f"{f['label']} ({f['dir']})" for f in s.get("factors", [])],
            }
            for m in marks
            if (s := scored.get(m["n"]))
        ]
        if not trials:
            return ToolResult(name="site_risk", args=args, data=note)
        target_summary = (risk.get("targets") or {}).get(target) or {}
        summary = (
            target_summary.get("all")
            if disease == "all"
            else (target_summary.get("by_disease") or {}).get(disease)
        )
        data = {"trials": trials, "summary": summary, "generated_for": risk.get("generated_for")}
        return ToolResult(name="site_risk", args=args, data=data, ids=[t["nct"] for t in trials])
    except (ToolError, ValueError, KeyError, TypeError) as exc:
        return ToolResult(name="site_risk", args=args, error=f"site data unavailable: {exc}")
