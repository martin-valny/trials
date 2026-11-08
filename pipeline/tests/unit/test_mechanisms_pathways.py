"""Pathway reference data: Reactome build, GO / curated fallbacks, read/write (offline)."""

from __future__ import annotations

import importlib.util
import itertools
import json
import sys
from pathlib import Path
from types import ModuleType

import httpx
import pytest
from conftest import REPO_ROOT

from trialradar.mechanisms.pathways import (
    PathwayRef,
    Pathways,
    QuickGo,
    build_pathways,
    go_fallback,
    quickgo_key,
    read_pathways,
    write_pathways,
)

REACTOME = REPO_ROOT / "pipeline" / "tests" / "fixtures" / "reactome"
QUICKGO = REPO_ROOT / "pipeline" / "tests" / "fixtures" / "quickgo"
GMT = REACTOME / "ReactomePathways.gmt"
NAMES = REACTOME / "ReactomePathways.txt"
RELATIONS = REACTOME / "ReactomePathwaysRelation.txt"

DISEASE = "R-HSA-1643685"
RITUXIMAB_ACTION = "R-HSA-9992296"  # "Rituximab:MS4A1 targets B cells ...": drug action
EXCLUDE = frozenset({DISEASE, RITUXIMAB_ACTION})
GENES = ("MS4A1", "S1PR1", "C5", "CD52", "FCGRT")


def _build(floor: float = 0.3, genes: tuple[str, ...] = GENES) -> Pathways:
    return build_pathways(genes, GMT, NAMES, RELATIONS, exclude_roots=EXCLUDE, floor=floor)


def test_gmt_maps_symbols_to_lowest_pathways() -> None:
    p = _build()
    assert p.targets["MS4A1"] == ("R-HSA-983695",)  # the BCR second-messenger step
    assert p.targets["CD52"] == ("R-HSA-163125",)  # GPI-anchor synthesis
    assert set(p.targets["S1PR1"]) == {"R-HSA-419408", "R-HSA-6785807"}
    assert set(p.targets["C5"]) == {
        "R-HSA-166665",  # Terminal pathway of complement
        "R-HSA-174577",  # Activation of C3 and C5
        "R-HSA-977606",  # Regulation of Complement cascade
        "R-HSA-418594",  # G alpha (i) signalling events
        "R-HSA-375276",  # Peptide ligand-binding receptors
    }
    # FcRn has no Reactome pathway at all, so it is left out
    assert "FCGRT" not in p.targets
    assert all(p.pathways[i].source == "reactome" for ids in p.targets.values() for i in ids)
    assert p.pathways["R-HSA-983695"].genes == 7
    assert p.release == ""


def test_disease_branch_excluded() -> None:
    p = _build()
    for gone in (DISEASE, "R-HSA-5663205", "R-HSA-9824446", "R-HSA-9679506", "R-HSA-9679191"):
        assert gone not in p.pathways
    assert RITUXIMAB_ACTION not in p.pathways
    assert all(not pid.startswith("R-MMU-") for pid in p.pathways)  # human only
    for ref in p.pathways.values():
        assert DISEASE not in ref.parents


def test_ancestors_kept() -> None:
    p = _build()
    chain = ["R-HSA-983695", "R-HSA-983705", "R-HSA-1280218", "R-HSA-168256"]
    for child, parent in itertools.pairwise(chain):
        assert p.pathways[child].parents == (parent,)
    assert p.pathways["R-HSA-168256"].parents == ()
    assert p.pathways["R-HSA-168256"].name == "Immune System"
    # nothing kept that no target reaches
    assert p.pathways.keys() >= {"R-HSA-162582", "R-HSA-392499"}
    only_ms4a1 = _build(genes=("MS4A1",))
    assert set(only_ms4a1.pathways) == set(chain)


def test_overlaps_above_floor_only() -> None:
    low = _build(floor=0.0001)
    high = _build(floor=0.5)
    assert high.overlaps and set(high.overlaps) < set(low.overlaps)
    for a, b, j in low.overlaps:
        assert a < b and a in low.pathways and b in low.pathways
        assert low.pathways[a].source == "reactome" == low.pathways[b].source
        assert 0 < j <= 1
    assert all(j >= 0.5 for _a, _b, j in high.overlaps)
    pairs = {(a, b): j for a, b, j in low.overlaps}
    # Lysosphingolipid {S1PR1,S1PR5} vs Peptide ligand-binding {C3,C5}: nothing shared
    assert ("R-HSA-375276", "R-HSA-419408") not in pairs
    # G alpha (i) {C3,C5,S1PR5} vs Peptide ligand-binding {C3,C5}: 2/3
    assert pairs[("R-HSA-375276", "R-HSA-418594")] == pytest.approx(2 / 3, abs=1e-3)
    # a pathway and its own ancestor are the hierarchy, not crosstalk
    assert ("R-HSA-166658", "R-HSA-166665") not in pairs


def _quickgo(seen: list[str] | None = None) -> QuickGo:
    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if seen is not None:
            seen.append(url)
        path = QUICKGO / quickgo_key(url)
        if not path.is_file():
            return httpx.Response(404, text=f"no fixture for {url}")
        return httpx.Response(200, content=path.read_bytes())

    http = httpx.Client(transport=httpx.MockTransport(handler))
    return QuickGo(lambda url: http.get(url).raise_for_status().json())


def test_go_fallback_for_target_without_reactome() -> None:
    rows = go_fallback(["FCGRT"], _quickgo())
    # the most specific manually reviewed biological-process term
    assert rows == {
        "FCGRT": (
            "GO:0002416",
            (
                "IgG immunoglobulin transcytosis in epithelial cells mediated by FcRn "
                "immunoglobulin receptor"
            ),
        )
    }


def test_go_fallback_skips_unknown_symbol() -> None:
    assert go_fallback(["ZZQXNOTAGENE"], _quickgo()) == {}


def test_is_human_needs_a_reviewed_human_protein() -> None:
    q = _quickgo()
    assert q.is_human("FCGRT") and q.is_human("MS4A1")
    assert not q.is_human("rplA")  # bacterial ribosomal protein
    assert not q.is_human("ZZQXNOTAGENE")


def _write_dir(tmp_path: Path, p: Pathways) -> Path:
    write_pathways(tmp_path / "pathways.json", p)
    return tmp_path


def test_curated_replaces_go(tmp_path: Path) -> None:
    d = _write_dir(tmp_path, _build())
    (d / "go_fallback.csv").write_text(
        "target,go_id,go_name\n"
        "FCGRT,GO:0002416,IgG transcytosis\n"
        "CD52,GO:0007204,positive regulation of cytosolic calcium ion concentration\n",
        encoding="utf-8",
    )
    (d / "curated_pathways.csv").write_text(
        "target,node_label,note,source_url\n"
        "CD52,lymphocyte depletion,alemtuzumab label,https://example.org/lemtrada\n",
        encoding="utf-8",
    )
    p = read_pathways(d)
    assert p.targets["CD52"] == ("curated:lymphocyte-depletion",)
    assert p.pathways["curated:lymphocyte-depletion"] == PathwayRef(
        "curated:lymphocyte-depletion", "lymphocyte depletion", (), 0, "curated"
    )
    assert p.targets["FCGRT"] == ("GO:0002416",)
    assert p.pathways["GO:0002416"].source == "go"
    assert p.pathways["GO:0002416"].parents == ()
    assert p.targets["MS4A1"] == ("R-HSA-983695",)


@pytest.mark.parametrize(
    ("name", "text"),
    [
        ("pathways.json", "[]"),
        (
            "pathways.json",
            '{"reactome_release": "98", "targets": {"A": ["X"]}, "pathways": {}, "overlaps": []}',
        ),
        (
            "pathways.json",
            (
                '{"reactome_release": "98", "targets": {}, '
                '"pathways": {"X": {"name": "x", "parents": ["Y"], "genes": 1}}, "overlaps": []}'
            ),
        ),
        ("pathways.json", "{not json"),
        ("go_fallback.csv", "target,go_id\nFCGRT,GO:0002416\n"),
        ("go_fallback.csv", "target,go_id,go_name\nFCGRT,R-HSA-1,x\n"),
        ("go_fallback.csv", "target,go_id,go_name\nFCGRT,GO:0002416,x\nFCGRT,GO:0002417,y\n"),
        (
            "curated_pathways.csv",
            "target,node_label,note,source_url\nCD52,lymphocyte depletion,,\n",
        ),
    ],
)
def test_read_pathways_invalid_raises(tmp_path: Path, name: str, text: str) -> None:
    _write_dir(tmp_path, _build())
    (tmp_path / name).write_text(text, encoding="utf-8")
    with pytest.raises(ValueError):
        read_pathways(tmp_path)


def test_read_pathways_missing_raises_oserror(tmp_path: Path) -> None:
    with pytest.raises(OSError):
        read_pathways(tmp_path)


def test_roundtrip_write_read(tmp_path: Path) -> None:
    p = Pathways(**{**_build().__dict__, "release": "98"})
    d = _write_dir(tmp_path, p)
    assert read_pathways(d) == p
    doc = json.loads((d / "pathways.json").read_text(encoding="utf-8"))
    assert doc["reactome_release"] == "98"
    assert set(doc) == {"reactome_release", "targets", "pathways", "overlaps"}


def test_committed_pathways_read() -> None:
    p = read_pathways(REPO_ROOT / "config" / "mechanisms")
    assert p.release
    assert p.targets["MS4A1"]
    assert p.pathways[p.targets["FCGRT"][0]].source == "go"
    assert p.pathways[p.targets["CD52"][0]].source == "curated"
    assert (REPO_ROOT / "config" / "mechanisms" / "pathways.json").stat().st_size < 1_100_000


# --- the hand-run script, offline -------------------------------------------------------


def _load_script() -> ModuleType:
    path = REPO_ROOT / "pipeline" / "scripts" / "map_pathways.py"
    spec = importlib.util.spec_from_file_location("map_pathways", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _reactome_handler(request: httpx.Request) -> httpx.Response:
    url = str(request.url)
    if url.endswith("/ContentService/data/database/version"):
        return httpx.Response(200, text="98")
    if "/download/current/" in url:
        name = url.rsplit("/", 1)[-1]
        if name == "ReactomePathways.gmt.zip":
            import io
            import zipfile

            buf = io.BytesIO()
            with zipfile.ZipFile(buf, "w") as z:
                z.write(GMT, "ReactomePathways.gmt")
            return httpx.Response(200, content=buf.getvalue())
        return httpx.Response(200, content=(REACTOME / name).read_bytes())
    path = QUICKGO / quickgo_key(url)
    if path.is_file():
        return httpx.Response(200, content=path.read_bytes())
    return httpx.Response(404, text=f"no fixture for {url}")


def test_script_writes_reactome_go_and_keeps_curated(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    mp = _load_script()
    mappings = tmp_path / "mappings"
    mappings.mkdir()
    (mappings / "drugs.csv").write_text(
        "drug,status,chembl_id,modality,mechanism_class,mechanism,action_type,targets\n"
        "alemtuzumab,mapped,CHEMBL1201587,antibody,anti-CD52,,,CD52\n"
        "efgartigimod,manual,,antibody,anti-FcRn,,,FCGRT\n"
        "rituximab,mapped,CHEMBL1201576,antibody,anti-CD20,,,MS4A1\n"
        "mystery,unmapped,,,,,,ZZQXNOTAGENE\n"
        "bacterial,manual,,small molecule,30S inhibitor,,,rplA\n"
        "msc product,manual,,cell therapy,msc,,,\n",
        encoding="utf-8",
    )
    out = tmp_path / "out"
    out.mkdir()
    (out / "curated_pathways.csv").write_text(
        "target,node_label,note,source_url\n"
        "CD52,lymphocyte depletion,alemtuzumab label,https://example.org/lemtrada\n",
        encoding="utf-8",
    )
    http = httpx.Client(transport=httpx.MockTransport(_reactome_handler))
    mp.run(
        mappings=mappings,
        out=out,
        cache=tmp_path / "cache",
        http=http,
        record=None,
        exclude_roots=EXCLUDE,
        sleep=lambda _s: None,
    )
    p = read_pathways(out)
    assert p.release == "98"
    assert p.targets["MS4A1"] == ("R-HSA-983695",)
    assert p.targets["FCGRT"] == ("GO:0002416",)
    assert p.targets["CD52"] == ("curated:lymphocyte-depletion",)  # CD52 is uninformative
    assert "ZZQXNOTAGENE" not in p.targets  # unmapped rows are not read
    go_rows = (out / "go_fallback.csv").read_text(encoding="utf-8").splitlines()
    assert go_rows[0] == "target,go_id,go_name" and len(go_rows) == 2  # curated CD52 skipped
    printed = capsys.readouterr().out
    assert "reactome 1" in printed and "go 1" in printed and "curated 1" in printed
    assert "none 0" in printed
    assert "1 targets not a reviewed human protein (no pathway): rplA" in printed
    assert "rplA" not in p.targets
    # the downloads are cached: a second run needs only the version call
    seen: list[str] = []

    def counting(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        return _reactome_handler(request)

    mp.run(
        mappings=mappings,
        out=out,
        cache=tmp_path / "cache",
        http=httpx.Client(transport=httpx.MockTransport(counting)),
        record=None,
        exclude_roots=EXCLUDE,
        sleep=lambda _s: None,
    )
    assert not [u for u in seen if "/download/" in u or "QuickGO" in u]
    assert len(seen) == 1
    assert read_pathways(out) == p
