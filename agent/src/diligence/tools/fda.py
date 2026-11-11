"""openFDA drug labels (the 404 NOT_FOUND = no matches handling mirrors the pipeline's client)."""

from typing import Any

import httpx

from diligence.tools.http import ToolError, get_response, trim
from diligence.types import ToolResult

URL = "https://api.fda.gov/drug/label.json"
SECTION_CHARS = 1500


def _is_not_found(resp: httpx.Response) -> bool:
    if resp.status_code != 404:
        return False
    try:
        body = resp.json()
    except ValueError:
        return False
    error = body.get("error") if isinstance(body, dict) else None
    return isinstance(error, dict) and error.get("code") == "NOT_FOUND"


def _section(label: dict[str, Any], *keys: str) -> str | None:
    for key in keys:
        value = label.get(key)
        if isinstance(value, list):
            value = " ".join(str(v) for v in value)
        if value:
            return trim(str(value), SECTION_CHARS)
    return None


def fda_label(drug: str, *, http: httpx.Client) -> ToolResult:
    args = {"drug": drug}
    name = drug.replace('"', " ").strip()
    try:
        resp = get_response(http, URL, {"search": f'openfda.generic_name:"{name}"', "limit": 1})
        if _is_not_found(resp):
            return ToolResult(name="fda_label", args=args, data={"note": "No FDA label found"})
        if resp.status_code >= 400:
            raise ToolError(f"upstream returned HTTP {resp.status_code}")
        results = resp.json().get("results") or []
        if not results or not results[0].get("set_id"):
            return ToolResult(name="fda_label", args=args, data={"note": "No FDA label found"})
        label = results[0]
        set_id = label["set_id"]
        data = {
            "set_id": set_id,
            "boxed_warning": _section(label, "boxed_warning"),
            "warnings_and_cautions": _section(label, "warnings_and_cautions", "warnings"),
            "indications_and_usage": _section(label, "indications_and_usage"),
        }
        return ToolResult(name="fda_label", args=args, data=data, ids=[f"FDA:{set_id}"])
    except (ToolError, ValueError, AttributeError) as exc:
        return ToolResult(name="fda_label", args=args, error=f"openFDA unavailable: {exc}")
