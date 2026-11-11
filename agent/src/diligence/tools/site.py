"""Tools over the site's own published JSON: pipeline.json, risk.json, trials/<NCT>.json."""

import hashlib
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import httpx

from diligence.tools.http import ToolError, get_json, get_response, trim
from diligence.types import ToolResult

MAX_TRIALS = 20
TITLE_CHARS = 100
WHY_CHARS = 200
STATE_LABEL = {
    "adv": "advanced",
    "run": "running",
    "stop": "stopped",
    "fin": "finished",
    "unk": "unknown",
}


def find_row(pipeline: dict[str, Any], target: str) -> dict[str, Any] | None:
    for row in pipeline.get("rows", []):
        if row.get("id") == target:
            return row  # type: ignore[no-any-return]
    return None


def marks_for(row: dict[str, Any], disease: str) -> list[dict[str, Any]]:
    marks: list[dict[str, Any]] = row.get("marks", [])
    return marks if disease == "all" else [m for m in marks if disease in m.get("dz", [])]


def row_fingerprint(
    pipeline: dict[str, Any], risk: dict[str, Any] | None, target: str, disease: str
) -> str:
    """Hash of what the row shows for this disease: (NCT, state, phase, why) plus rounded risk p."""
    row = find_row(pipeline, target)
    marks = marks_for(row, disease) if row else []
    info = pipeline.get("trials", {})
    parts = sorted(
        (
            m["n"],
            m.get("s") or "",
            -1 if m.get("c") is None else m["c"],
            (info.get(m["n"]) or {}).get("why") or "",
        )
        for m in marks
    )
    risks = (risk or {}).get("trials", {})
    ps = sorted((m["n"], round(float(risks[m["n"]]["p"]), 2)) for m in marks if m["n"] in risks)
    blob = repr((parts, ps)).encode()
    return hashlib.sha256(blob).hexdigest()


def _phase_label(phases: list[str]) -> str:
    """["PHASE1", "PHASE2"] -> "1/2" (compact for the model)."""
    return "/".join(p.replace("PHASE", "") for p in phases) or "NA"


_STATE_ORDER = {"stop": 0, "run": 1, "adv": 2, "fin": 3, "unk": 4}
FETCH_WORKERS = 8


def _pick(marks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The trials worth showing first: stopped, then running, advanced, ...; newest first."""
    return sorted(
        marks,
        key=lambda m: (
            _STATE_ORDER.get(m.get("s") or "unk", 4),
            -(m.get("y2") or m.get("y") or 0),
            m.get("n") or "",
        ),
    )


def _trial(
    m: dict[str, Any], info: dict[str, Any], base_url: str, http: httpx.Client
) -> dict[str, Any]:
    """One trial, compact: empty fields are dropped so the model reads less (R39)."""
    nct = m["n"]
    t: dict[str, Any] = {
        "nct": nct,
        "title": trim((info.get(nct) or {}).get("t", ""), TITLE_CHARS),
        "state": STATE_LABEL.get(m.get("s") or "unk", "unknown"),
        "drug": m.get("drug"),
        "start_year": m.get("y"),
        "end_year": m.get("y2"),
    }
    try:
        resp = get_response(http, f"{base_url}trials/{nct}.json")
        full = resp.json() if resp.status_code == 200 else None
    except (ToolError, ValueError):
        full = None
    if isinstance(full, dict):
        t["title"] = trim(full.get("title") or t["title"], TITLE_CHARS)
        t["phase"] = _phase_label(full.get("phases") or [])
        t["overall_status"] = full.get("overall_status")
        t["why_stopped"] = trim(full.get("why_stopped") or "", WHY_CHARS)
        t["lead_sponsor"] = full.get("lead_sponsor")
    else:
        t["why_stopped"] = (info.get(nct) or {}).get("why")
    return {k: v for k, v in t.items() if v not in (None, "", [])}


def site_target(target: str, disease: str, *, base_url: str, http: httpx.Client) -> ToolResult:
    args = {"target": target, "disease": disease}
    try:
        pipeline = get_json(http, base_url + "pipeline.json")
        row = find_row(pipeline, target)
        if row is None:
            return ToolResult(name="site_target", args=args, error=f"unknown target {target!r}")
        marks = marks_for(row, disease)
        sponsors = pipeline.get("sponsors", [])
        info = pipeline.get("trials", {})
        shown = _pick(marks)[:MAX_TRIALS]
        with ThreadPoolExecutor(max_workers=FETCH_WORKERS) as pool:
            trials = list(pool.map(lambda m: _trial(m, info, base_url, http), shown))
        by_status = Counter(STATE_LABEL.get(m.get("s") or "unk", "unknown") for m in marks)
        by_phase = Counter(
            f"Phase {m['c']}" if m.get("c") is not None else "Phase unknown" for m in marks
        )
        companies = Counter(
            sponsors[m["sp"]]["parent"] for m in marks if 0 <= m.get("sp", -1) < len(sponsors)
        )
        approved = {
            dz: [
                {
                    "drug": a.get("d"),
                    "regulator": a.get("reg"),
                    "year": a.get("y"),
                    "withdrawn": bool(a.get("wd")),
                }
                for a in drugs
            ]
            for dz, drugs in (row.get("ap") or {}).items()
            if disease == "all" or dz == disease
        }
        data: dict[str, Any] = {
            "row": {
                "id": row["id"],
                "label": row.get("label"),
                "gene": row.get("gene"),
                "blurb": row.get("blurb"),
            },
            "trials": trials,
            "trials_total": len(marks),
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
        if len(marks) > len(trials):
            data["note"] = (
                f"Showing {len(trials)} of {len(marks)} trials (stopped first, then running, "
                "advanced, finished; newest first). Counts cover all trials."
            )
        return ToolResult(name="site_target", args=args, data=data, ids=[t["nct"] for t in trials])
    except (ToolError, ValueError, KeyError, TypeError) as exc:
        return ToolResult(name="site_target", args=args, error=f"site data unavailable: {exc}")


def site_risk(target: str, disease: str, *, base_url: str, http: httpx.Client) -> ToolResult:
    args = {"target": target, "disease": disease}
    note = {"note": "Stop-risk estimates unavailable"}
    try:
        pipeline = get_json(http, base_url + "pipeline.json")
        row = find_row(pipeline, target)
        if row is None:
            return ToolResult(name="site_risk", args=args, error=f"unknown target {target!r}")
        resp = get_response(http, base_url + "risk.json")
        if resp.status_code != 200:
            return ToolResult(name="site_risk", args=args, data=note)
        risk = resp.json()
        scored = risk.get("trials", {})
        marks = marks_for(row, disease)
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
