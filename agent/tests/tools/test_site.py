import copy
from collections.abc import Callable

import httpx
from helpers import BASE, FIXTURES, fixture

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


def _big_pipeline() -> dict:  # type: ignore[type-arg]
    pipeline = fixture("site/pipeline.json")
    marks = [
        {
            "n": f"NCT{10000000 + i}",
            "c": 2,
            "s": "run",
            "y": 2020,
            "y2": 2020 + i % 5,
            "dz": ["MS"],
            "drug": "d",
            "sp": 0,
        }
        for i in range(40)
    ]
    marks[35]["s"] = "stop"  # past position 30 in raw order
    pipeline["rows"][0]["marks"] = marks
    return pipeline


def _big_handler(request: httpx.Request) -> httpx.Response:
    if request.url.path.endswith("pipeline.json"):
        return httpx.Response(200, json=_big_pipeline())
    return httpx.Response(404)


def test_site_target_cap_picks_stopped_first_and_reports_total(
    make_http: Callable[..., httpx.Client],
) -> None:
    res = site_target("cd20", "all", base_url=BASE, http=make_http(_big_handler))
    assert res.error is None
    assert len(res.ids) == 30 and res.ids[0] == "NCT10000035"
    assert res.data["trials_total"] == 40
    assert "Showing 30 of 40" in res.data["note"]
    assert sum(res.data["counts_by_status"].values()) == 40
    assert res.data["counts_by_status"]["stopped"] == 1
    ends = [t["end_year"] for t in res.data["trials"][1:]]
    assert ends == sorted(ends, reverse=True)


def test_site_target_trial_file_404_falls_back_to_pipeline_info(
    make_http: Callable[..., httpx.Client],
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("NCT90000001.json"):
            return httpx.Response(404)
        return _site_handler(request)

    res = site_target("cd20", "MS", base_url=BASE, http=make_http(handler))
    assert res.error is None and "note" not in res.data
    first = next(t for t in res.data["trials"] if t["nct"] == "NCT90000001")
    assert first["why_stopped"] == "Sponsor decision after interim safety review"
    assert "lead_sponsor" not in first and res.data["trials_total"] == 3


def test_row_fingerprint_handles_missing_phase_and_state() -> None:
    pipeline = fixture("site/pipeline.json")
    for m in pipeline["rows"][0]["marks"]:
        m.pop("c", None)
        m.pop("s", None)
    assert row_fingerprint(pipeline, None, "cd20", "MS")
