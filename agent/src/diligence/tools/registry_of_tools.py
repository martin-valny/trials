"""Tool schemas (Converse toolSpec) and dispatch. Tools never raise to the loop."""

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import httpx

from diligence.log import log_error
from diligence.prompts import MEMO_TOOL, READY_TOOL
from diligence.tools.chembl import chembl_drug
from diligence.tools.fda import fda_label
from diligence.tools.literature import literature_search
from diligence.tools.registry import registry_search
from diligence.tools.site import site_risk, site_target
from diligence.types import ToolResult

# Slow external services: after one transport or server failure in a run, further calls to the
# same tool fail at once instead of spending the run's time budget on more timeouts.
BREAKER_TOOLS = frozenset({"chembl_drug", "literature_search"})


@dataclass
class ToolContext:
    http: httpx.Client
    base_url: str
    # Tools that failed with an outage this run (see BREAKER_TOOLS); one context per run.
    down: set[str] = field(default_factory=set)


def _spec(
    name: str, description: str, properties: dict[str, Any], required: list[str]
) -> dict[str, Any]:
    return {
        "toolSpec": {
            "name": name,
            "description": description,
            "inputSchema": {
                "json": {"type": "object", "properties": properties, "required": required}
            },
        }
    }


_STR = {"type": "string"}
_TARGET = {"target": {**_STR, "description": "Pipeline row id, e.g. cd20"}}
_DISEASE = {"disease": {**_STR, "description": "Disease code, or 'all'"}}

TOOL_SPECS: list[dict[str, Any]] = [
    _spec(
        "site_target",
        "Trials of the target row from the site's published pipeline (phase, status, company, "
        "years, stop reasons) plus counts and the mechanism chain. Start here.",
        {**_TARGET, **_DISEASE},
        ["target", "disease"],
    ),
    _spec(
        "site_risk",
        "Stop-risk estimates for the row's running trials from the site's risk model.",
        {**_TARGET, **_DISEASE},
        ["target", "disease"],
    ),
    _spec(
        "registry_search",
        "ClinicalTrials.gov search by drug name across all diseases: counts by status and phase "
        "plus up to 20 trials.",
        {
            "intervention": {**_STR, "description": "Drug or intervention name"},
            "condition": {**_STR, "description": "Optional condition filter"},
            "status": {**_STR, "description": "Optional overall status, e.g. TERMINATED"},
        },
        ["intervention"],
    ),
    _spec(
        "chembl_drug",
        "ChEMBL: max clinical phase, mechanism and indications of a drug.",
        {"name": {**_STR, "description": "Drug name"}},
        ["name"],
    ),
    _spec(
        "literature_search",
        "Europe PMC search (PubMed, PMC, preprints): top abstracts with ids, year and journal.",
        {
            "query": {**_STR, "description": "Search query"},
            "since_year": {"type": "integer", "description": "Only papers from this year on"},
        },
        ["query"],
    ),
    _spec(
        "fda_label",
        "openFDA drug label of an approved drug: boxed warning, warnings, indications.",
        {"drug": {**_STR, "description": "Generic drug name"}},
        ["drug"],
    ),
]

# What each model call is offered. The planner gathers and ends with ready_to_write; only the
# writer call (forced submit_memo) can file a memo. The writer keeps the planner's tools because
# the history it reads holds toolUse blocks for them.
PLANNER_TOOLS: list[dict[str, Any]] = [*TOOL_SPECS, READY_TOOL]
WRITER_TOOLS: list[dict[str, Any]] = [*PLANNER_TOOLS, MEMO_TOOL]

_REQUIRED: dict[str, list[str]] = {
    s["toolSpec"]["name"]: s["toolSpec"]["inputSchema"]["json"]["required"] for s in TOOL_SPECS
}
_PROPS: dict[str, dict[str, Any]] = {
    s["toolSpec"]["name"]: s["toolSpec"]["inputSchema"]["json"]["properties"] for s in TOOL_SPECS
}

_Impl = Callable[[dict[str, Any], ToolContext], ToolResult]
_IMPLS: dict[str, _Impl] = {
    "site_target": lambda a, c: site_target(
        a["target"], a["disease"], base_url=c.base_url, http=c.http
    ),
    "site_risk": lambda a, c: site_risk(
        a["target"], a["disease"], base_url=c.base_url, http=c.http
    ),
    "registry_search": lambda a, c: registry_search(
        a["intervention"], a.get("condition"), a.get("status"), http=c.http
    ),
    "chembl_drug": lambda a, c: chembl_drug(a["name"], http=c.http),
    "literature_search": lambda a, c: literature_search(
        a["query"], a.get("since_year"), http=c.http
    ),
    "fda_label": lambda a, c: fda_label(a["drug"], http=c.http),
}


def dispatch(name: str, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    """Run a tool. Unknown tools, bad arguments and unexpected failures become error results."""
    if name not in _IMPLS:
        return ToolResult(name=name, args=args, error=f"unknown tool {name!r}")
    if not isinstance(args, dict):
        return ToolResult(name=name, error="arguments must be an object")
    clean: dict[str, Any] = {}
    for key, spec in _PROPS[name].items():
        if key not in args or args[key] is None:
            continue
        value = args[key]
        ok = (
            isinstance(value, int) and not isinstance(value, bool)
            if spec["type"] == "integer"
            else isinstance(value, str)
        )
        if not ok:
            return ToolResult(
                name=name, args=args, error=f"argument {key!r} must be a {spec['type']}"
            )
        clean[key] = value
    missing = [k for k in _REQUIRED[name] if k not in clean or clean[k] == ""]
    if missing:
        return ToolResult(name=name, args=args, error=f"missing required argument(s): {missing}")
    if name in ctx.down:
        return ToolResult(
            name=name, args=clean, error="unavailable earlier in this run; not called again"
        )
    try:
        result = _IMPLS[name](clean, ctx)
    except Exception as exc:  # noqa: BLE001 - tools must never raise into the loop
        log_error(f"tool {name}", exc)
        return ToolResult(name=name, args=clean, error=f"tool failed: {type(exc).__name__}")
    if name in BREAKER_TOOLS and _is_outage(result.error):
        ctx.down.add(name)
    return result


def _is_outage(error: str | None) -> bool:
    """A transport failure or a 5xx, as the tools word them (not "not found" or a bad argument)."""
    return error is not None and ("request failed:" in error or "upstream returned HTTP 5" in error)
