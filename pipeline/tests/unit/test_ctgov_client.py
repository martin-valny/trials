"""Tests for the ClinicalTrials.gov client (no real network)."""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any

import httpx
import pytest
from conftest import REPO_ROOT, make_study

from trialradar.config import AreaConfig
from trialradar.ctgov.client import MAX_PAGES, CtGovClient, CtGovError

Handler = Callable[[httpx.Request], httpx.Response]


def _client(handler: Handler, delays: list[float] | None = None) -> CtGovClient:
    sink = delays if delays is not None else []
    return CtGovClient(
        http=httpx.Client(transport=httpx.MockTransport(handler)),
        sleep=sink.append,
        rng=lambda lo, hi: 1.0,
    )


def _page(*studies: dict[str, Any], token: str | None = None) -> httpx.Response:
    body: dict[str, Any] = {"studies": list(studies)}
    if token:
        body["nextPageToken"] = token
    return httpx.Response(200, json=body)


def _ids(studies: list[dict[str, Any]]) -> list[str]:
    return [s["protocolSection"]["identificationModule"]["nctId"] for s in studies]


def test_paginates_until_no_token(cfg: AreaConfig) -> None:
    requests: list[httpx.Request] = []
    pages = [
        _page(make_study("NCT00000001"), token="t2"),
        _page(make_study("NCT00000002"), token="t3"),
        _page(make_study("NCT00000003")),
    ]

    def handler(req: httpx.Request) -> httpx.Response:
        requests.append(req)
        return pages[len(requests) - 1]

    studies = list(_client(handler).iter_studies(cfg))
    assert _ids(studies) == ["NCT00000001", "NCT00000002", "NCT00000003"]
    assert "pageToken" not in requests[0].url.params
    assert requests[1].url.params["pageToken"] == "t2"
    assert requests[2].url.params["pageToken"] == "t3"
    assert requests[0].url.params["pageSize"] == "1000"


def test_dedupes_study_seen_on_two_pages(cfg: AreaConfig) -> None:
    old = make_study(
        "NCT00000001", **{"statusModule.lastUpdatePostDateStruct": {"date": "2025-01"}}
    )
    new = make_study(
        "NCT00000001", **{"statusModule.lastUpdatePostDateStruct": {"date": "2025-02"}}
    )
    pages = iter(
        [_page(old, make_study("NCT00000002"), token="t2"), _page(new, make_study("NCT00000003"))]
    )
    studies = list(_client(lambda req: next(pages)).iter_studies(cfg))
    assert _ids(studies) == ["NCT00000001", "NCT00000002", "NCT00000003"]
    assert studies[0] is not old
    assert studies[0]["protocolSection"]["statusModule"]["lastUpdatePostDateStruct"] == {
        "date": "2025-02"
    }


def test_retries_429_and_5xx_then_succeeds(cfg: AreaConfig) -> None:
    responses = iter([httpx.Response(429), httpx.Response(503), _page(make_study())])
    delays: list[float] = []
    studies = list(_client(lambda req: next(responses), delays).iter_studies(cfg))
    assert len(studies) == 1
    assert len(delays) == 2
    assert delays[1] > delays[0]


def test_honours_retry_after_on_429(cfg: AreaConfig) -> None:
    responses = iter([httpx.Response(429, headers={"Retry-After": "7"}), _page(make_study())])
    delays: list[float] = []
    list(_client(lambda req: next(responses), delays).iter_studies(cfg))
    assert delays == [7.0]


def test_retries_transport_errors(cfg: AreaConfig) -> None:
    calls = 0

    def handler(req: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise httpx.ConnectError("boom", request=req)
        return _page(make_study())

    delays: list[float] = []
    assert len(list(_client(handler, delays).iter_studies(cfg))) == 1
    assert calls == 2
    assert len(delays) == 1


def test_gives_up_after_5_retries(cfg: AreaConfig) -> None:
    calls = 0

    def handler(req: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(503)

    delays: list[float] = []
    with pytest.raises(CtGovError):
        list(_client(handler, delays).iter_studies(cfg))
    assert calls == 6
    assert delays == [1.0, 2.0, 4.0, 8.0, 16.0]


def test_backoff_uses_rng_and_caps_at_60() -> None:
    delays: list[float] = []
    client = CtGovClient(
        http=httpx.Client(transport=httpx.MockTransport(lambda req: httpx.Response(503))),
        sleep=delays.append,
        rng=lambda lo, hi: hi,
    )
    with pytest.raises(CtGovError):
        client.data_timestamp()
    assert delays == [1.5, 3.0, 6.0, 12.0, 24.0]


def test_non_retryable_400_raises_immediately(cfg: AreaConfig) -> None:
    calls = 0

    def handler(req: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(400, text="bad")

    with pytest.raises(CtGovError):
        list(_client(handler).iter_studies(cfg))
    assert calls == 1


def test_data_timestamp() -> None:
    body = (REPO_ROOT / "pipeline" / "tests" / "fixtures" / "http" / "version.json").read_text()
    seen: list[str] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req.url.path)
        return httpx.Response(200, json=json.loads(body))

    assert _client(handler).data_timestamp() == json.loads(body)["dataTimestamp"]
    assert seen == ["/api/v2/version"]


def test_timeout_is_30s() -> None:
    client = CtGovClient()
    assert client._http.timeout == httpx.Timeout(30)


@pytest.mark.parametrize(
    "bad",
    [
        {"protocolSection": {"identificationModule": {}}},
        {"protocolSection": {"identificationModule": {"nctId": ""}}},
        {"protocolSection": {}},
        {},
    ],
)
def test_study_without_nct_id_raises(cfg: AreaConfig, bad: dict[str, Any]) -> None:
    client = _client(lambda req: _page(make_study(), bad))
    with pytest.raises(CtGovError, match=r"page 1.*index 1"):
        list(client.iter_studies(cfg))


@pytest.mark.parametrize("content", [b"<html>nope", b"[1, 2]", b'"str"'])
def test_non_object_or_invalid_json_body_raises(cfg: AreaConfig, content: bytes) -> None:
    calls = 0

    def handler(req: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, content=content)

    client = _client(handler)
    with pytest.raises(CtGovError):
        client.data_timestamp()
    with pytest.raises(CtGovError):
        list(client.iter_studies(cfg))
    assert calls == 2  # no retries


@pytest.mark.parametrize("body", [{}, {"dataTimestamp": ""}, {"dataTimestamp": 5}])
def test_version_without_data_timestamp_raises(body: dict[str, Any]) -> None:
    client = _client(lambda req: httpx.Response(200, json=body))
    with pytest.raises(CtGovError, match="dataTimestamp"):
        client.data_timestamp()


@pytest.mark.parametrize("body", [{}, {"studies": None}, {"studies": {"a": 1}}, {"studies": "x"}])
def test_studies_missing_or_not_list_raises(cfg: AreaConfig, body: dict[str, Any]) -> None:
    client = _client(lambda req: httpx.Response(200, json=body))
    with pytest.raises(CtGovError, match="studies"):
        list(client.iter_studies(cfg))


def test_repeated_page_token_raises(cfg: AreaConfig) -> None:
    calls = 0

    def handler(req: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return _page(make_study(), token="a" if calls == 1 else "b" if calls == 2 else "a")

    with pytest.raises(CtGovError, match="repeated"):
        list(_client(handler).iter_studies(cfg))
    assert calls == 3


def test_page_cap_raises(cfg: AreaConfig) -> None:
    calls = 0

    def handler(req: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return _page(make_study(), token=f"t{calls}")

    with pytest.raises(CtGovError, match="100 pages"):
        list(_client(handler).iter_studies(cfg))
    assert calls == MAX_PAGES


@pytest.mark.parametrize(
    ("header", "expected"),
    [("1e9", 60.0), ("inf", 1.0), ("nan", 1.0), ("-5", 1.0), ("soon", 1.0), ("0", 0.0)],
)
def test_retry_after_is_sanitised(cfg: AreaConfig, header: str, expected: float) -> None:
    responses = iter([httpx.Response(429, headers={"Retry-After": header}), _page(make_study())])
    delays: list[float] = []
    list(_client(lambda req: next(responses), delays).iter_studies(cfg))
    assert delays == [expected]


def test_iter_query_pages_and_dedupes() -> None:
    requests: list[httpx.Request] = []
    pages = [
        _page(make_study("NCT00000001"), token="t2"),
        _page(make_study("NCT00000001"), make_study("NCT00000002")),
    ]

    def handler(req: httpx.Request) -> httpx.Response:
        requests.append(req)
        return pages[len(requests) - 1]

    studies = list(_client(handler).iter_query({"pageSize": "1000", "format": "json"}))
    assert _ids(studies) == ["NCT00000001", "NCT00000002"]
    assert "pageToken" not in requests[0].url.params
    assert requests[1].url.params["pageToken"] == "t2"
