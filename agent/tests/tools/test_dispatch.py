import httpx
from helpers import fixture, json_response

from diligence.tools.registry_of_tools import TOOL_SPECS, ToolContext, dispatch


def test_dispatch_unknown_tool(ctx: ToolContext) -> None:
    res = dispatch("rm_rf", {}, ctx)
    assert res.error and "unknown tool" in res.error


def test_dispatch_validates_args(ctx: ToolContext) -> None:
    assert "missing" in (dispatch("site_target", {"target": "cd20"}, ctx).error or "")
    assert dispatch("chembl_drug", {"name": 3}, ctx).error
    assert dispatch("literature_search", {"query": "x", "since_year": "2020"}, ctx).error


def test_dispatch_routes_and_never_raises(make_http, ctx: ToolContext) -> None:  # type: ignore[no-untyped-def]
    http = make_http(lambda r: json_response(fixture("epmc_search.json")))
    good = dispatch("literature_search", {"query": "x"}, ToolContext(http, ctx.base_url))
    assert good.ids and good.error is None

    def broken(request: httpx.Request) -> httpx.Response:
        raise RuntimeError("unexpected")

    res = dispatch("fda_label", {"drug": "x"}, ToolContext(make_http(broken), ctx.base_url))
    assert res.error


def test_tool_specs_shape() -> None:
    names = [s["toolSpec"]["name"] for s in TOOL_SPECS]
    assert names == [
        "site_target",
        "site_risk",
        "registry_search",
        "chembl_drug",
        "literature_search",
        "fda_label",
        "submit_memo",
    ]
    memo = TOOL_SPECS[-1]["toolSpec"]["inputSchema"]["json"]
    assert set(memo["required"]) == {"sections", "read", "judgement", "would_change"}
