"""openFDA label client, offline against MockTransport."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import httpx
import pytest

from trialradar.approvals.openfda import OpenFdaClient, OpenFdaError

LABEL_BODY = {
    "results": [
        {
            "set_id": "abc-1",
            "indications_and_usage": ["INDICATIONS: for A.", "Also for B."],
            "openfda": {"generic_name": ["DRUGNAME"]},
        },
        {"set_id": "abc-2", "openfda": {"generic_name": ["DRUGNAME", "OTHER"]}},
        {"set_id": "abc-3", "spl_product_data_elements": ["Brand drugname X", "Y"]},
    ]
}


def _client(handler: Any, seen: list[httpx.Request] | None = None, **kw: Any) -> OpenFdaClient:
    def wrapped(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(request)
        return handler(request)  # type: ignore[no-any-return]

    http = httpx.Client(transport=httpx.MockTransport(wrapped))
    return OpenFdaClient(http=http, sleep=lambda _s: None, **kw)


def test_openfda_labels_reduced() -> None:
    seen: list[httpx.Request] = []
    client = _client(lambda r: httpx.Response(200, json=LABEL_BODY), seen)
    assert client.labels("drugname") == [
        {
            "set_id": "abc-1",
            "generic_name": "DRUGNAME",
            "indications": "INDICATIONS: for A. Also for B.",
            "product": "",
        },
        {"set_id": "abc-2", "generic_name": "DRUGNAME; OTHER", "indications": "", "product": ""},
        {
            "set_id": "abc-3",
            "generic_name": "",
            "indications": "",
            "product": "Brand drugname X",
        },
    ]
    params = seen[0].url.params
    assert params["search"] == (
        'openfda.generic_name:"drugname" spl_product_data_elements:"drugname"'
    )
    assert params["limit"] == "100"
    assert seen[0].url.path == "/drug/label.json"


def test_openfda_not_found_is_empty_and_cached(tmp_path: Path) -> None:
    seen: list[httpx.Request] = []
    body = {"error": {"code": "NOT_FOUND", "message": "No matches found!"}}
    client = _client(lambda r: httpx.Response(404, json=body), seen, cache_dir=tmp_path)
    assert client.labels("nothing") == []
    assert client.labels("nothing") == []
    assert len(seen) == 1


def test_openfda_other_4xx_raises() -> None:
    client = _client(lambda r: httpx.Response(400, json={"error": {"code": "BAD_REQUEST"}}))
    with pytest.raises(OpenFdaError):
        client.labels("x")


def test_openfda_500_retries_then_raises() -> None:
    seen: list[httpx.Request] = []
    client = _client(lambda r: httpx.Response(500, text="boom"), seen)
    with pytest.raises(OpenFdaError, match="retries"):
        client.labels("x")
    assert len(seen) == 6


def test_openfda_cache_hit_skips_http(tmp_path: Path) -> None:
    seen: list[httpx.Request] = []
    client = _client(lambda r: httpx.Response(200, json=LABEL_BODY), seen, cache_dir=tmp_path)
    first = client.labels("drugname")
    assert client.labels("drugname") == first
    assert len(seen) == 1


def test_openfda_record_trimmer(tmp_path: Path) -> None:
    rec = tmp_path / "rec"
    client = _client(
        lambda r: httpx.Response(200, json=LABEL_BODY),
        record_dir=rec,
        record=lambda _path, body: {"results": body["results"][:1]},
    )
    assert len(client.labels("drugname")) == 3
    import json

    (saved,) = list(rec.iterdir())
    assert len(json.loads(saved.read_text(encoding="utf-8"))["results"]) == 1
