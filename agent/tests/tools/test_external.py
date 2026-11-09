from collections.abc import Callable

import httpx
from helpers import fixture, json_response

from diligence.tools.chembl import chembl_drug
from diligence.tools.fda import fda_label
from diligence.tools.literature import literature_search
from diligence.tools.registry import registry_search

Make = Callable[..., httpx.Client]


def test_registry_search_pages_and_counts(make_http: Make) -> None:
    seen: list[httpx.URL] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url)
        if request.url.params.get("pageToken"):
            return json_response(fixture("ctgov_page2.json"))
        return json_response(fixture("ctgov_page1.json"))

    res = registry_search("rituximab", "multiple sclerosis", "TERMINATED", http=make_http(handler))
    assert res.error is None
    assert res.ids == ["NCT00087529", "NCT01212094", "NCT03193866", "NCT05000001"]
    assert res.data["counted"] == 4
    assert res.data["counts_by_status"] == {"COMPLETED": 2, "TERMINATED": 1, "RECRUITING": 1}
    assert res.data["counts_by_phase"] == {"2/3": 1, "1/2": 1, "NA": 1, "3": 1}
    assert res.data["trials"][1]["why_stopped"].startswith("The efficacy on CSF")
    assert len(seen) == 2
    p = seen[0].params
    assert p["query.intr"] == "rituximab" and p["query.cond"] == "multiple sclerosis"
    assert p["filter.overallStatus"] == "TERMINATED"


def test_chembl_drug(make_http: Make) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        name = request.url.path.rsplit("/", 1)[-1]
        return json_response(
            fixture(
                {
                    "molecule.json": "chembl_molecule.json",
                    "mechanism.json": "chembl_mechanism.json",
                    "drug_indication.json": "chembl_indication.json",
                }[name]
            )
        )

    res = chembl_drug("ocrelizumab", http=make_http(handler))
    assert res.error is None
    assert res.ids == ["CHEMBL2108041"]
    assert res.data["max_phase"] == 4.0
    assert res.data["mechanisms"][0]["mechanism"] == "B-lymphocyte antigen CD20 binding agent"
    assert (
        res.data["indications"][0]
        == {
            "indication": "Multiple Sclerosis, Chronic Progressive",
            "max_phase": 4.0,
        }
        or res.data["indications"][0]["max_phase"] == 4.0
    )
    assert {i["indication"] for i in res.data["indications"]} >= {"Arthritis, Rheumatoid"}


def test_chembl_unknown_drug_note(make_http: Make) -> None:
    res = chembl_drug("zzz", http=make_http(lambda r: json_response({"molecules": []})))
    assert res.error is None and res.ids == [] and "not found" in res.data["note"]


def test_literature_search(make_http: Make) -> None:
    seen: list[httpx.URL] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url)
        return json_response(fixture("epmc_search.json"))

    res = literature_search("ocrelizumab", 2020, http=make_http(handler))
    assert res.error is None
    assert res.ids == ["PMID:42949019", "PMID:42768184"]
    first = res.data["abstracts"][0]
    assert len(first["abstract"]) <= 1200 and "<h4>" not in first["abstract"]
    assert first["year"] == "2026"
    p = seen[0].params
    assert "FIRST_PDATE:[2020-01-01" in p["query"] and p["resultType"] == "core"
    assert p["pageSize"] == "8"


def test_fda_label(make_http: Make) -> None:
    seen: list[httpx.URL] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url)
        return json_response(fixture("fda_label.json"))

    res = fda_label("ocrelizumab", http=make_http(handler))
    sid = "9da42362-3bb5-4b83-b4bb-b59fd4e55f0d"
    assert res.ids == [f"FDA:{sid}"]
    assert res.data["boxed_warning"] is None
    assert len(res.data["warnings_and_cautions"]) <= 1500
    assert res.data["indications_and_usage"]
    assert seen[0].params["search"] == 'openfda.generic_name:"ocrelizumab"'
    assert seen[0].params["limit"] == "1"


def test_tools_degrade_on_http_errors(make_http: Make) -> None:
    calls = {"n": 0}

    def down(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(503)

    http = make_http(down)
    for res in (
        registry_search("x", http=http),
        chembl_drug("x", http=http),
        literature_search("x", http=http),
        fda_label("x", http=http),
    ):
        assert res.error and res.ids == []
    assert calls["n"] == 4 * 3  # initial try plus two retries each

    def boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("slow")

    assert registry_search("x", http=make_http(boom)).error

    empty = literature_search(
        "x", http=make_http(lambda r: json_response(fixture("epmc_empty.json")))
    )
    assert empty.error is None and empty.data["abstracts"] == [] and empty.ids == []

    nf = fda_label(
        "nothing", http=make_http(lambda r: json_response(fixture("fda_notfound.json"), 404))
    )
    assert nf.error is None and nf.data == {"note": "No FDA label found"} and nf.ids == []
