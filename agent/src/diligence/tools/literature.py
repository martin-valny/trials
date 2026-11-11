"""Europe PMC search: abstracts with PMIDs (or preprint ids)."""

import re
from typing import Any

import httpx

from diligence.tools.http import ToolError, get_json, trim
from diligence.types import ToolResult

URL = "https://www.ebi.ac.uk/europepmc/webservices/rest/search"
ABSTRACT_CHARS = 1200
_TAGS = re.compile(r"<[^>]+>")


def _cite_id(rec: dict[str, Any]) -> str | None:
    if rec.get("pmid"):
        return f"PMID:{rec['pmid']}"
    if str(rec.get("id", "")).startswith("PPR"):
        return str(rec["id"])
    return None


def literature_search(
    query: str, since_year: int | None = None, *, http: httpx.Client, n: int = 8
) -> ToolResult:
    args: dict[str, Any] = {"query": query}
    q = query
    if since_year:
        args["since_year"] = since_year
        q = f"({query}) AND FIRST_PDATE:[{since_year}-01-01 TO 3000-12-31]"
    params = {"query": q, "resultType": "core", "pageSize": n, "format": "json"}
    try:
        body = get_json(http, URL, params)
        if "errCode" in body:
            raise ToolError(f"Europe PMC error {body['errCode']}")
        abstracts: list[dict[str, Any]] = []
        for rec in body.get("resultList", {}).get("result", []):
            cid = _cite_id(rec)
            if cid is None:
                continue
            journal = ((rec.get("journalInfo") or {}).get("journal") or {}).get("title")
            abstracts.append(
                {
                    "id": cid,
                    "title": trim(rec.get("title") or "", 200),
                    "year": rec.get("pubYear"),
                    "journal": journal,
                    "abstract": trim(_TAGS.sub(" ", rec.get("abstractText") or ""), ABSTRACT_CHARS),
                }
            )
        return ToolResult(
            name="literature_search",
            args=args,
            data={"hit_count": body.get("hitCount", 0), "abstracts": abstracts},
            ids=[a["id"] for a in abstracts],
        )
    except (ToolError, ValueError, AttributeError) as exc:
        return ToolResult(
            name="literature_search", args=args, error=f"literature unavailable: {exc}"
        )
