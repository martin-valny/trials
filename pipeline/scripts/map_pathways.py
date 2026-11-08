"""Map every drug target gene to its pathways: Reactome, then GO, then curated (hand-run).

Reads the target genes of the resolved molecular rows (``mapped`` / ``manual``) in
``config/mechanisms/{drugs,overrides}.csv``, downloads the Reactome files, and writes:

- ``<out>/pathways.json``: lowest-level Reactome pathways per gene, their ancestors, and
  shared-gene overlaps (the floor is raised until the file is under ``--max-bytes``);
- ``<out>/go_fallback.csv``: one GO biological-process term (QuickGO, manually reviewed
  annotations, the most specific term) for each gene with no Reactome pathway or only an
  uninformative one (``UNINFORMATIVE``), unless ``curated_pathways.csv`` covers it.

``curated_pathways.csv`` is hand-written and never touched. The daily run never calls
Reactome or QuickGO.

Usage:
  uv run python scripts/map_pathways.py [--mappings config/mechanisms] [--out config/mechanisms]
      [--cache pipeline/.cache/reactome] [--record DIR] [--max-bytes 1000000]

``--record DIR`` saves every QuickGO response, trimmed to the fields used, as test fixtures.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import tempfile
import time
import zipfile
from collections.abc import Callable
from dataclasses import replace
from pathlib import Path
from typing import Any

import httpx

from trialradar.mechanisms.io import read_mappings
from trialradar.mechanisms.pathways import (
    CURATED_FILE,
    GO_FILE,
    PATHWAYS_FILE,
    Pathways,
    QuickGo,
    build_pathways,
    go_fallback,
    quickgo_key,
    read_curated,
    read_pathways,
    write_go_fallback,
    write_pathways,
)

_REPO = Path(__file__).resolve().parents[2]
REACTOME_DOWNLOAD = "https://reactome.org/download/current"
REACTOME_VERSION = "https://reactome.org/ContentService/data/database/version"
REACTOME_FILES = (
    "ReactomePathways.gmt.zip",
    "ReactomePathways.txt",
    "ReactomePathwaysRelation.txt",
)

# Excluded with everything below them (spec §6.1 item 3): the "Disease" branch, "Drug ADME",
# and the drug-action pathways that sit inside normal branches. These would make the graph
# circular (rituximab → MS4A1 → "Rituximab:MS4A1 targets B cells ..."). Reviewed against
# Reactome release 98: every human pathway whose name describes a drug acting.
EXCLUDE_ROOTS = frozenset(
    {
        "R-HSA-1643685",  # Disease
        "R-HSA-9748784",  # Drug ADME
        "R-HSA-9992296",  # Rituximab:MS4A1 (rituximab:CD20) targets B cells for ADCC by NK cells
        "R-HSA-9754119",  # Drug-mediated inhibition of CDK4/CDK6 activity
        "R-HSA-9652282",  # Drug-mediated inhibition of ERBB2 signaling
        "R-HSA-9734091",  # Drug-mediated inhibition of MET activation
        "R-HSA-9730737",  # Alkylating DNA damage induced by chemotherapeutic drugs
        "R-HSA-9729902",  # Reversible DNA damage induced by alkylating chemotherapeutic drugs
        "R-HSA-9750126",  # Drug-induced formation of DNA interstrand crosslinks
    }
)
# Targets whose only Reactome pathways say nothing about how the drug works; they use the
# GO / curated layers instead. CD52 (alemtuzumab): only GPI-anchor biosynthesis.
UNINFORMATIVE = frozenset({"CD52"})
RESOLVED = ("mapped", "manual")
FLOORS = (0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0)
MAX_BYTES = 1_000_000
RETRIES = 2  # one retry, then stop
TIMEOUT_SECONDS = 60


def _write_atomic(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        os.chmod(tmp, 0o644)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


class Fetcher:
    """GET with one retry on a network error or 5xx."""

    def __init__(self, http: httpx.Client, sleep: Callable[[float], None] = time.sleep) -> None:
        self._http = http
        self._sleep = sleep

    def get(self, url: str) -> bytes:
        last = ""
        for attempt in range(RETRIES):
            try:
                r = self._http.get(url, headers={"Accept": "application/json, */*"})
            except httpx.TransportError as exc:
                last = f"{type(exc).__name__}: {exc}"
            else:
                if r.status_code < 500:
                    r.raise_for_status()
                    return r.content
                last = f"HTTP {r.status_code}"
            if attempt + 1 < RETRIES:
                self._sleep(5.0)
        raise SystemExit(f"giving up on {url}: {last}")


def _trim(body: Any) -> Any:
    """Keep only what :class:`QuickGo` reads, so fixtures stay small."""
    if not isinstance(body, dict):
        return body
    keep: tuple[str, ...] = ("id", "symbol", "databaseSubset", "taxonId", "goId")
    keep += ("goEvidence", "qualifier", "name", "isObsolete", "ancestors")
    return {
        "pageInfo": body.get("pageInfo"),
        "results": [
            {k: r.get(k) for k in keep if k in r}
            for r in body.get("results") or []
            if isinstance(r, dict)
        ],
    }


def quickgo_getter(fetch: Fetcher, cache: Path, record: Path | None) -> Callable[[str], Any]:
    """QuickGO JSON by URL, cached on disk (and saved trimmed under ``record``)."""

    def get(url: str) -> Any:
        path = cache / quickgo_key(url)
        if path.is_file():
            body = json.loads(path.read_text(encoding="utf-8"))
        else:
            body = _trim(json.loads(fetch.get(url)))
            _write_atomic(path, json.dumps(body).encode("utf-8"))
        if record is not None:
            _write_atomic(record / quickgo_key(url), json.dumps(body, indent=1).encode("utf-8"))
        return body

    return get


def download_reactome(fetch: Fetcher, cache: Path) -> tuple[str, Path]:
    """The current release number and a directory holding its three files (cached by release)."""
    release = fetch.get(REACTOME_VERSION).decode("utf-8").strip()
    if not release.isdigit():
        raise SystemExit(f"unexpected Reactome version {release!r}")
    folder = cache / f"release-{release}"
    for name in REACTOME_FILES:
        target = folder / name.removesuffix(".zip")
        if target.is_file():
            continue
        data = fetch.get(f"{REACTOME_DOWNLOAD}/{name}")
        if name.endswith(".zip"):
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                data = z.read(target.name)
        _write_atomic(target, data)
    return release, folder


def target_genes(mappings: Path) -> set[str]:
    """Gene targets of the resolved molecular rows (kind keys carry no targets)."""
    return {t for m in read_mappings(mappings).values() if m.status in RESOLVED for t in m.targets}


def _size(p: Pathways) -> int:
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / PATHWAYS_FILE
        write_pathways(path, p)
        return path.stat().st_size


def fit_floor(p: Pathways, max_bytes: int) -> tuple[Pathways, float]:
    """The lowest floor in ``FLOORS`` whose file is under ``max_bytes``."""
    for floor in FLOORS:
        cut = replace(p, overlaps=tuple(o for o in p.overlaps if o[2] >= floor))
        if _size(cut) <= max_bytes:
            return cut, floor
    raise SystemExit(f"pathways.json stays over {max_bytes} bytes even without overlaps")


def run(
    *,
    mappings: Path,
    out: Path,
    cache: Path,
    http: httpx.Client,
    record: Path | None,
    exclude_roots: frozenset[str] = EXCLUDE_ROOTS,
    max_bytes: int = MAX_BYTES,
    sleep: Callable[[float], None] = time.sleep,
) -> Pathways:
    fetch = Fetcher(http, sleep)
    quickgo = QuickGo(quickgo_getter(fetch, cache / "quickgo", record))
    targets = target_genes(mappings)
    # Only human proteins get pathways: Reactome's GMT also names viral proteins (``M``).
    genes = {g for g in targets if quickgo.is_human(g)}
    release, files = download_reactome(fetch, cache)
    built = build_pathways(
        sorted(genes - UNINFORMATIVE),
        files / "ReactomePathways.gmt",
        files / "ReactomePathways.txt",
        files / "ReactomePathwaysRelation.txt",
        exclude_roots=exclude_roots,
        floor=FLOORS[0],
    )
    reactome, floor = fit_floor(replace(built, release=release), max_bytes)
    curated = read_curated(out / CURATED_FILE)
    gaps = sorted(g for g in genes if g not in reactome.targets and g not in curated)
    go_rows = go_fallback(gaps, quickgo)

    out.mkdir(parents=True, exist_ok=True)
    write_pathways(out / PATHWAYS_FILE, reactome)
    write_go_fallback(out / GO_FILE, go_rows)
    final = read_pathways(out)

    by_source = {"reactome": 0, "go": 0, "curated": 0}
    for gene in genes:
        ids = final.targets.get(gene)
        if ids:
            by_source[final.pathways[ids[0]].source] += 1
    none = sorted(g for g in genes if g not in final.targets)
    kept = sum(1 for r in final.pathways.values() if r.source == "reactome")
    print(f"Reactome release {release}: {kept} pathways kept, {len(reactome.overlaps)} overlaps")
    print(f"overlap floor {floor} ({_size(reactome):,} bytes)")
    print(
        f"{len(genes)} human targets: reactome {by_source['reactome']}, go {by_source['go']}, "
        f"curated {by_source['curated']}, none {len(none)}"
    )
    if none:
        print("no pathway: " + ", ".join(none))
    if other := sorted(targets - genes):
        print(
            f"{len(other)} targets not a reviewed human protein (no pathway): " + ", ".join(other)
        )
    return final


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--mappings", type=Path, default=_REPO / "config" / "mechanisms")
    ap.add_argument("--out", type=Path, default=_REPO / "config" / "mechanisms")
    ap.add_argument("--cache", type=Path, default=_REPO / "pipeline" / ".cache" / "reactome")
    ap.add_argument("--record", type=Path, default=None, help="save trimmed QuickGO responses")
    ap.add_argument("--max-bytes", type=int, default=MAX_BYTES)
    args = ap.parse_args()
    with httpx.Client(timeout=TIMEOUT_SECONDS, follow_redirects=True) as http:
        run(
            mappings=args.mappings,
            out=args.out,
            cache=args.cache,
            http=http,
            record=args.record,
            max_bytes=args.max_bytes,
        )


if __name__ == "__main__":
    main()
