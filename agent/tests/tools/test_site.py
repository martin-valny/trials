import copy
from collections.abc import Callable

import httpx
from helpers import BASE, FIXTURES, fixture, json_response

from diligence.tools.site import row_fingerprint, site_risk, site_target


def _site_handler(request: httpx.Request) -> httpx.Response:
    rel = request.url.path.removeprefix("/data/")
    path = FIXTURES / "site" / rel
    if path.exists():
        return httpx.Response(200, content=path.read_bytes())
    return httpx.Response(404)


def test_site_target_happy(make_http: Callable[..., httpx.Client]) -> None:
    res = site_target("cd20", "MS", base_url=BASE, http=make_http(_site_handler))
    assert res.error is None
    assert res.ids == ["NCT90000001", "NCT90000002", "NCT90000004"]
    assert res.data["row"]["label"] == "CD20"
    assert res.data["row"]["gene"] == "MS4A1"
    assert res.data["counts_by_status"] == {"stopped": 1, "running": 2}
    assert res.data["counts_by_phase"] == {"Phase 2": 3}
    assert res.data["companies"] == {"Acme Biotech": 1, "Example Pharma": 2}
    first = res.data["trials"][0]
    assert first["why_stopped"] == "Sponsor decision after interim safety review"
    assert first["lead_sponsor"] == "Acme Biotech"
    assert first["phases"] == ["PHASE2"]
    assert res.data["chain"]["drugs"] == ["example drug"]
    assert "MS" in res.data["chain"]["approved"]


def test_site_target_disease_scoped_and_unknown(make_http: Callable[..., httpx.Client]) -> None:
    http = make_http(_site_handler)
    empty = site_target("cd20", "CIDP", base_url=BASE, http=http)
    assert empty.ids == [] and empty.data["trials"] == []
    assert site_target("nope", "all", base_url=BASE, http=http).error is not None


def test_site_risk_happy(make_http: Callable[..., httpx.Client]) -> None:
    res = site_risk("cd20", "MS", base_url=BASE, http=make_http(_site_handler))
    assert res.error is None
    assert res.ids == ["NCT90000002", "NCT90000004"]
    assert res.data["trials"][1]["p"] == 0.661
    assert res.data["summary"]["n"] == 7


def test_site_risk_missing_file_note(make_http: Callable[..., httpx.Client]) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("risk.json"):
            return httpx.Response(404)
        return _site_handler(request)

    res = site_risk("cd20", "MS", base_url=BASE, http=make_http(handler))
    assert res.error is None
    assert res.data == {"note": "Stop-risk estimates unavailable"}


def test_site_risk_no_entry_note(make_http: Callable[..., httpx.Client]) -> None:
    res = site_risk("cd20", "CIDP", base_url=BASE, http=make_http(_site_handler))
    assert res.data == {"note": "Stop-risk estimates unavailable"}


def test_row_fingerprint_stable_and_disease_scoped() -> None:
    pipeline = fixture("site/pipeline.json")
    risk = fixture("site/risk.json")
    other = copy.deepcopy(pipeline["rows"][0])
    other["id"] = "cd19"
    pipeline["rows"].append(other)
    base = row_fingerprint(pipeline, risk, "cd20", "MS")
    assert base == row_fingerprint(copy.deepcopy(pipeline), copy.deepcopy(risk), "cd20", "MS")
    changed = copy.deepcopy(pipeline)
    changed["rows"][0]["marks"][1]["s"] = "stop"
    assert row_fingerprint(changed, risk, "cd20", "MS") != base
    elsewhere = copy.deepcopy(pipeline)
    elsewhere["rows"][1]["marks"][1]["s"] = "stop"
    assert row_fingerprint(elsewhere, risk, "cd20", "MS") == base
    # risk p is rounded to 2 dp: a tiny change is ignored, a real one is not
    nudged = copy.deepcopy(risk)
    nudged["trials"]["NCT90000002"]["p"] = 0.2441
    assert row_fingerprint(pipeline, nudged, "cd20", "MS") == base
    nudged["trials"]["NCT90000002"]["p"] = 0.5
    assert row_fingerprint(pipeline, nudged, "cd20", "MS") != base
    assert row_fingerprint(pipeline, None, "cd20", "MS") != base
    assert json_response  # silence unused-import linters for shared helper
