"""ChEMBL client and drug mapping, offline against recorded fixtures (MockTransport)."""

from __future__ import annotations

import gzip
import importlib.util
import json
import sys
from collections.abc import Callable
from pathlib import Path
from types import ModuleType
from typing import Any

import httpx
import pytest
from conftest import REPO_ROOT, make_study

from trialradar.mechanisms.chembl import ChemblClient, ChemblError, cache_key
from trialradar.mechanisms.classify import map_drug
from trialradar.mechanisms.io import DrugMapping, read_mappings, read_target_labels

FIXTURES = REPO_ROOT / "pipeline" / "tests" / "fixtures" / "chembl"
LABELS = read_target_labels(REPO_ROOT / "config" / "mechanisms" / "target_labels.csv")
UNKNOWN_NAME = "zzqx not a real drug"


def _fixture_handler(seen: list[str] | None = None) -> Callable[[httpx.Request], httpx.Response]:
    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if seen is not None:
            seen.append(url)
        path = FIXTURES / cache_key(url)
        if not path.is_file():
            return httpx.Response(404, text=f"no fixture for {url}")
        return httpx.Response(200, content=path.read_bytes())

    return handler


def _client(seen: list[str] | None = None, **kw: Any) -> ChemblClient:
    http = httpx.Client(transport=httpx.MockTransport(_fixture_handler(seen)))
    return ChemblClient(http=http, sleep=lambda _s: None, **kw)


def _json_client(routes: dict[str, Any]) -> ChemblClient:
    """A client whose transport answers by URL path+query substring from ``routes``."""

    def handler(request: httpx.Request) -> httpx.Response:
        for key, body in routes.items():
            if key in str(request.url):
                return httpx.Response(200, json=body)
        return httpx.Response(404)

    return ChemblClient(
        http=httpx.Client(transport=httpx.MockTransport(handler)), sleep=lambda _s: None
    )


def test_find_molecule_exact_match_prefers_the_parent() -> None:
    mol = _client().find_molecule("Fingolimod")
    assert mol is not None
    # the hydrochloride salt also lists the synonym "Fingolimod"; the self-parent wins,
    # and fuzzy hits such as FTY720-P are ignored
    assert mol["molecule_chembl_id"] == "CHEMBL314854"
    assert _client().parent_id(mol) == "CHEMBL314854"


def test_find_molecule_ignores_fuzzy_hits() -> None:
    client = _json_client(
        {
            "molecule/search.json": {
                "molecules": [
                    {
                        "molecule_chembl_id": "CHEMBL1",
                        "pref_name": "FINGOLIMOD PHOSPHATE",
                        "molecule_synonyms": [{"molecule_synonym": "Fingolimod-P"}],
                        "molecule_hierarchy": None,
                    }
                ],
                "page_meta": {"next": None},
            },
            "molecule.json": {"molecules": [], "page_meta": {"next": None}},
        }
    )
    assert client.find_molecule("fingolimod") is None


def test_unknown_name_is_none() -> None:
    assert _client().find_molecule(UNKNOWN_NAME) is None


def test_parent_id_falls_back_to_own_id() -> None:
    c = _client()
    assert c.parent_id({"molecule_chembl_id": "CHEMBL9", "molecule_hierarchy": None}) == "CHEMBL9"
    salt = {
        "molecule_chembl_id": "CHEMBL544665",
        "molecule_hierarchy": {"parent_chembl_id": "CHEMBL314854"},
    }
    assert c.parent_id(salt) == "CHEMBL314854"


def test_mechanisms_are_fetched_by_parent_id() -> None:
    seen: list[str] = []
    rows = _client(seen).mechanisms("CHEMBL314854")
    assert {r["action_type"] for r in rows} == {"AGONIST", "BINDING AGENT"}
    assert all("parent_molecule_chembl_id=CHEMBL314854" in u for u in seen)


def test_target_genes_are_sorted_unique_gene_symbols() -> None:
    c = _client()
    assert c.target_genes(c.target("CHEMBL2363041")) == (
        "S1PR1",
        "S1PR2",
        "S1PR3",
        "S1PR4",
        "S1PR5",
    )
    assert c.target_genes(c.target("CHEMBL2058")) == ("MS4A1",)


def test_fingolimod_maps_to_s1p_receptor_modulator() -> None:
    # Review Focus 1: no mechanism sits on CHEMBL314854 itself, only on its salts
    m = map_drug(_client(), "fingolimod", LABELS)
    assert m == DrugMapping(
        drug="fingolimod",
        status="mapped",
        chembl_id="CHEMBL314854",
        modality="small molecule",
        mechanism_class=("S1P receptor modulator",),
        mechanism=(
            "Sphingosine 1-phosphate receptor agonist",
            "Sphingosine 1-phosphate receptor binding agent",
        ),
        action_type=("AGONIST", "BINDING AGENT"),
        targets=("S1PR1", "S1PR2", "S1PR3", "S1PR4", "S1PR5"),
    )


def test_ocrelizumab_and_efgartigimod() -> None:
    ocr = map_drug(_client(), "ocrelizumab", LABELS)
    assert (ocr.status, ocr.modality, ocr.mechanism_class, ocr.targets) == (
        "mapped",
        "antibody",
        ("anti-CD20",),
        ("MS4A1",),
    )
    efg = map_drug(_client(), "efgartigimod", LABELS)
    assert (efg.status, efg.modality, efg.mechanism_class, efg.targets) == (
        "mapped",
        "protein",
        ("anti-FcRn",),
        ("FCGRT",),
    )


def test_unknown_name_maps_to_unmapped_with_empty_fields() -> None:
    assert map_drug(_client(), UNKNOWN_NAME, LABELS) == DrugMapping(
        drug=UNKNOWN_NAME,
        status="unmapped",
        chembl_id=None,
        modality=None,
        mechanism_class=(),
        mechanism=(),
        action_type=(),
        targets=(),
    )


def test_molecule_without_mechanisms_is_unmapped_but_keeps_id() -> None:
    client = _json_client(
        {
            "molecule/search.json": {
                "molecules": [
                    {
                        "molecule_chembl_id": "CHEMBL7",
                        "pref_name": "VITAMIN X",
                        "molecule_synonyms": [],
                        "molecule_hierarchy": {"parent_chembl_id": "CHEMBL7"},
                        "molecule_type": "Small molecule",
                    }
                ],
                "page_meta": {"next": None},
            },
            "mechanism.json": {"mechanisms": [], "page_meta": {"next": None}},
        }
    )
    m = map_drug(client, "vitamin x", LABELS)
    assert (m.status, m.chembl_id, m.modality, m.mechanism_class) == (
        "unmapped",
        "CHEMBL7",
        "small molecule",
        (),
    )


def test_salt_hit_takes_modality_from_the_parent() -> None:
    client = _json_client(
        {
            "molecule/search.json": {
                "molecules": [
                    {
                        "molecule_chembl_id": "CHEMBL2",
                        "pref_name": "DRUG HCL",
                        "molecule_synonyms": [{"molecule_synonym": "Drugx"}],
                        "molecule_hierarchy": {"parent_chembl_id": "CHEMBL1"},
                        "molecule_type": "Unknown",
                    }
                ],
                "page_meta": {"next": None},
            },
            "molecule/CHEMBL1.json": {
                "molecule_chembl_id": "CHEMBL1",
                "molecule_type": "Antibody",
            },
            "mechanism.json": {"mechanisms": [], "page_meta": {"next": None}},
        }
    )
    m = map_drug(client, "drugx", LABELS)
    assert (m.chembl_id, m.modality) == ("CHEMBL1", "antibody")


def test_mechanisms_follow_all_pages() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        offset = int(request.url.params["offset"])
        nxt = "/chembl/api/data/mechanism.json?offset=100" if offset == 0 else None
        rows = [{"action_type": "INHIBITOR", "n": offset + i} for i in range(2)]
        return httpx.Response(200, json={"mechanisms": rows, "page_meta": {"next": nxt}})

    c = ChemblClient(http=httpx.Client(transport=httpx.MockTransport(handler)))
    assert [r["n"] for r in c.mechanisms("CHEMBL1")] == [0, 1, 100, 101]


def test_retries_then_succeeds_and_caches(tmp_path: Path) -> None:
    calls: list[int] = []
    sleeps: list[float] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        if len(calls) == 1:
            return httpx.Response(503)
        return httpx.Response(200, json={"target_chembl_id": "T1", "target_components": []})

    c = ChemblClient(
        http=httpx.Client(transport=httpx.MockTransport(handler)),
        cache_dir=tmp_path,
        sleep=sleeps.append,
        rng=lambda a, b: 1.0,
    )
    assert c.target("T1")["target_chembl_id"] == "T1"
    assert len(calls) == 2 and sleeps == [1.0]

    def boom(request: httpx.Request) -> httpx.Response:
        raise AssertionError("cache should answer")

    cached = ChemblClient(
        http=httpx.Client(transport=httpx.MockTransport(boom)), cache_dir=tmp_path
    )
    assert cached.target("T1")["target_chembl_id"] == "T1"


def test_client_error_is_not_retried() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404)

    c = ChemblClient(http=httpx.Client(transport=httpx.MockTransport(handler)))
    with pytest.raises(ChemblError, match="404"):
        c.target("CHEMBL0")


# --- the hand-run script -------------------------------------------------------


def _load_script() -> ModuleType:
    path = REPO_ROOT / "pipeline" / "scripts" / "map_mechanisms.py"
    spec = importlib.util.spec_from_file_location("map_mechanisms", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _drug_study(nct: str, name: str) -> dict[str, Any]:
    return make_study(
        nct, **{"armsInterventionsModule.interventions": [{"type": "DRUG", "name": name}]}
    )


def test_script_writes_drugs_csv_and_reports_coverage(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    mm = _load_script()
    snap = tmp_path / "2026-11-01.jsonl.gz"
    studies = [
        _drug_study("NCT00000001", "Fingolimod"),
        _drug_study("NCT00000002", "Fingolimod 0.5 mg"),
        _drug_study("NCT00000003", "Ocrelizumab"),
        _drug_study("NCT00000004", UNKNOWN_NAME),
    ]
    with gzip.open(snap, "wt", encoding="utf-8") as f:
        for s in studies:
            f.write(json.dumps(s) + "\n")
    out = tmp_path / "mech"
    out.mkdir()
    (out / "overrides.csv").write_text("hand-written, untouched\n", encoding="utf-8")
    (out / "target_labels.csv").write_text(
        (REPO_ROOT / "config" / "mechanisms" / "target_labels.csv").read_text(encoding="utf-8"),
        encoding="utf-8",
    )
    record = tmp_path / "rec"
    mm.run(
        snapshot=tmp_path,  # a raw dir: the newest snapshot is used
        config=REPO_ROOT / "config" / "area.yaml",
        out=out,
        client=_client(record_dir=record),
        only=None,
    )
    assert (out / "overrides.csv").read_text(encoding="utf-8") == "hand-written, untouched\n"
    (out / "overrides.csv").unlink()
    got = read_mappings(out)
    assert list(got) == ["fingolimod", "ocrelizumab", UNKNOWN_NAME]
    assert got["fingolimod"].mechanism_class == ("S1P receptor modulator",)
    assert got[UNKNOWN_NAME].status == "unmapped"
    report = capsys.readouterr().out
    assert "mapped 2 / 3 drugs" in report
    assert "trial-weighted coverage 3 / 4" in report
    assert f"1  {UNKNOWN_NAME}" in report
    assert sorted(p.name for p in record.iterdir()) == sorted(
        p.name
        for p in FIXTURES.iterdir()
        if "efgartigimod" not in p.name
        and "CHEMBL4297551" not in p.name
        and "CHEMBL5966" not in p.name
    )


def test_script_only_filter_includes_names_absent_from_the_snapshot(tmp_path: Path) -> None:
    mm = _load_script()
    snap = tmp_path / "2026-11-01.jsonl.gz"
    with gzip.open(snap, "wt", encoding="utf-8") as f:
        f.write(json.dumps(_drug_study("NCT00000001", "Fingolimod")) + "\n")
        f.write(json.dumps(_drug_study("NCT00000002", "Ocrelizumab")) + "\n")
    out = tmp_path / "mech"
    out.mkdir()
    mm.run(
        snapshot=snap,
        config=REPO_ROOT / "config" / "area.yaml",
        out=out,
        client=_client(),
        only=["fingolimod", "efgartigimod"],
        labels_path=REPO_ROOT / "config" / "mechanisms" / "target_labels.csv",
    )
    assert list(read_mappings(out)) == ["efgartigimod", "fingolimod"]


def _mol(cid: str, parent: str, name: str, *syns: str) -> dict[str, Any]:
    return {
        "molecule_chembl_id": cid,
        "pref_name": name,
        "molecule_synonyms": [{"molecule_synonym": s} for s in syns],
        "molecule_hierarchy": {"parent_chembl_id": parent},
        "molecule_type": "Small molecule",
    }


def _page(*mols: dict[str, Any]) -> dict[str, Any]:
    return {"molecules": list(mols), "page_meta": {"next": None}}


def _routing_client(routes: dict[str, dict[str, Any]], seen: list[str]) -> ChemblClient:
    """Routes by a query-parameter name present in the request URL."""

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        for param, body in routes.items():
            if param in request.url.params:
                return httpx.Response(200, json=body)
        return httpx.Response(404)

    return ChemblClient(http=httpx.Client(transport=httpx.MockTransport(handler)))


def test_exact_matches_with_different_parents_are_ambiguous() -> None:
    seen: list[str] = []
    client = _routing_client(
        {
            "q": _page(
                _mol("CHEMBL1", "CHEMBL1", "VITAMIN B12"),
                _mol("CHEMBL2", "CHEMBL2", "HYDROXOCOBALAMIN", "Vitamin B12"),
            ),
            "pref_name__iexact": _page(_mol("CHEMBL1", "CHEMBL1", "VITAMIN B12")),
        },
        seen,
    )
    assert client.find_molecule("vitamin b12") is None
    assert len(seen) == 1  # ambiguous is not a miss: no fallback lookups


def test_search_miss_falls_back_to_exact_pref_name_then_synonym() -> None:
    seen: list[str] = []
    client = _routing_client(
        {
            "q": _page(_mol("CHEMBL9", "CHEMBL9", "SOMETHING ELSE")),
            "pref_name__iexact": _page(),
            "molecule_synonyms__molecule_synonym__iexact": _page(
                _mol("CHEMBL5", "CHEMBL4", "DRUGX SODIUM", "Drug-X"),
                _mol("CHEMBL4", "CHEMBL4", "DRUGX", "Drug-X"),
            ),
        },
        seen,
    )
    mol = client.find_molecule("Drug-X")
    assert mol is not None and mol["molecule_chembl_id"] == "CHEMBL4"
    assert [httpx.URL(u).path.rsplit("/", 1)[-1] for u in seen] == [
        "search.json",
        "molecule.json",
        "molecule.json",
    ]


def test_fallback_hit_on_pref_name_stops_there() -> None:
    seen: list[str] = []
    client = _routing_client(
        {"q": _page(), "pref_name__iexact": _page(_mol("CHEMBL3", "CHEMBL3", "DRUG Y"))},
        seen,
    )
    mol = client.find_molecule("drug y")
    assert mol is not None and mol["molecule_chembl_id"] == "CHEMBL3"
    assert len(seen) == 2


def test_unreadable_cache_entry_is_a_miss_and_is_rewritten(tmp_path: Path) -> None:
    body = {"target_chembl_id": "T1", "target_components": []}
    calls: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(200, json=body)

    c = ChemblClient(http=httpx.Client(transport=httpx.MockTransport(handler)), cache_dir=tmp_path)
    url = str(httpx.URL("https://www.ebi.ac.uk/chembl/api/data/target/T1.json"))
    (tmp_path / cache_key(url)).write_text('{"truncated": ', encoding="utf-8")
    assert c.target("T1") == body
    assert calls == [1]
    assert json.loads((tmp_path / cache_key(url)).read_text(encoding="utf-8")) == body
    assert [p.name for p in tmp_path.iterdir()] == [cache_key(url)]  # no temp files left
    assert c.target("T1") == body and calls == [1]
