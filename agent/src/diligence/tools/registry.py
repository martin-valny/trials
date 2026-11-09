"""ClinicalTrials.gov API v2 search by intervention."""

from collections import Counter
from typing import Any

import httpx

from diligence.tools.http import ToolError, get_json, trim
from diligence.types import ToolResult

URL = "https://clinicaltrials.gov/api/v2/studies"
FIELDS = "NCTId,BriefTitle,Condition,Phase,OverallStatus,WhyStopped"
MAX_PAGES = 3
MAX_TRIALS = 20


def registry_search(
    intervention: str,
    condition: str | None = None,
    status: str | None = None,
    *,
    http: httpx.Client,
) -> ToolResult:
    args: dict[str, Any] = {"intervention": intervention}
    params: dict[str, Any] = {"query.intr": intervention, "pageSize": 100, "fields": FIELDS}
    if condition:
        params["query.cond"] = condition
        args["condition"] = condition
    if status:
        params["filter.overallStatus"] = status
        args["status"] = status
    try:
        studies: list[dict[str, Any]] = []
        for _ in range(MAX_PAGES):
            page = get_json(http, URL, params)
            studies += page.get("studies", [])
            token = page.get("nextPageToken")
            if not token:
                break
            params = {**params, "pageToken": token}
        by_status: Counter[str] = Counter()
        by_phase: Counter[str] = Counter()
        trials: list[dict[str, Any]] = []
        for s in studies:
            p = s.get("protocolSection", {})
            nct = p.get("identificationModule", {}).get("nctId")
            if not nct:
                continue
            st = p.get("statusModule", {})
            phases = p.get("designModule", {}).get("phases") or []
            phase = "/".join(x.replace("PHASE", "") for x in phases) or "NA"
            by_status[st.get("overallStatus", "UNKNOWN")] += 1
            by_phase[phase] += 1
            if len(trials) < MAX_TRIALS:
                trials.append(
                    {
                        "nct": nct,
                        "title": trim(p.get("identificationModule", {}).get("briefTitle", ""), 140),
                        "conditions": p.get("conditionsModule", {}).get("conditions", [])[:4],
                        "phase": phase,
                        "status": st.get("overallStatus"),
                        "why_stopped": trim(st.get("whyStopped") or "", 300) or None,
                    }
                )
        data = {
            "counted": sum(by_status.values()),
            "counts_by_status": dict(by_status),
            "counts_by_phase": dict(by_phase),
            "trials": trials,
        }
        return ToolResult(
            name="registry_search", args=args, data=data, ids=[t["nct"] for t in trials]
        )
    except (ToolError, ValueError, AttributeError) as exc:
        return ToolResult(name="registry_search", args=args, error=f"registry unavailable: {exc}")
