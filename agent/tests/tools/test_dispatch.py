import json

import httpx
import pytest
from helpers import fixture, json_response

from diligence.tools.registry_of_tools import TOOL_SPECS, WRITER_TOOLS, ToolContext, dispatch


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


def test_unexpected_tool_failure_is_logged(capsys: pytest.CaptureFixture[str]) -> None:
    """I7/R42: the result says only the class; the log line has the message."""
    from diligence import tools

    def explode(_a: object, _c: object) -> None:
        raise RuntimeError("upstream said: quota exceeded for key-less client")

    impls = tools.registry_of_tools._IMPLS
    old = impls["fda_label"]
    impls["fda_label"] = explode  # type: ignore[assignment]
    try:
        res = dispatch("fda_label", {"drug": "x"}, ToolContext(httpx.Client(), "https://e/"))
    finally:
        impls["fda_label"] = old
    assert res.error == "tool failed: RuntimeError"
    line = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert line["where"] == "tool fda_label" and "quota exceeded" in line["message"]


def test_tool_specs_shape() -> None:
    names = [s["toolSpec"]["name"] for s in TOOL_SPECS]
    assert names == [
        "site_target",
        "site_risk",
        "registry_search",
        "chembl_drug",
        "literature_search",
        "fda_label",
    ]
    memo = WRITER_TOOLS[-1]["toolSpec"]["inputSchema"]["json"]
    assert set(memo["required"]) == {"sections", "read", "judgement", "would_change"}


def test_outage_trips_the_breaker_for_the_rest_of_the_run(make_http, ctx: ToolContext) -> None:  # type: ignore[no-untyped-def]
    calls: list[str] = []

    def down(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        return httpx.Response(500)

    run_ctx = ToolContext(make_http(down), ctx.base_url)
    first = dispatch("chembl_drug", {"name": "ocrelizumab"}, run_ctx)
    assert first.error and "HTTP 500" in first.error
    n = len(calls)
    second = dispatch("chembl_drug", {"name": "ofatumumab"}, run_ctx)
    assert second.error == "unavailable earlier in this run; not called again"
    assert len(calls) == n  # no request made
    # Other tools, and a fresh run, are unaffected.
    assert "chembl_drug" not in ToolContext(make_http(down), ctx.base_url).down


def test_not_found_does_not_trip_the_breaker(make_http, ctx: ToolContext) -> None:  # type: ignore[no-untyped-def]
    run_ctx = ToolContext(make_http(lambda r: json_response({"molecules": []})), ctx.base_url)
    assert dispatch("chembl_drug", {"name": "nothing"}, run_ctx).error is None
    assert run_ctx.down == set()
