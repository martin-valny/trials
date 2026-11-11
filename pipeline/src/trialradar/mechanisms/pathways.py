"""Pathway reference data for the mechanism graph: target gene → pathway.

Three layers, each marked by ``source`` (spec 2026-11-06 §6.1 items 3 and 7):

- **Reactome** (``pathways.json``): the lowest-level human pathways that list a target gene,
  their ancestors, and shared-gene (Jaccard) overlaps between them. The "Disease" and
  drug-action branches are excluded with all their descendants.
- **Gene Ontology** (``go_fallback.csv``, script-written): one biological-process term for a
  target with no Reactome pathway, or only an uninformative one.
- **Curated** (``curated_pathways.csv``, hand-written): links neither covers well. A curated
  row replaces GO (and Reactome) for that target.

The daily run only reads these files (:func:`read_pathways`); the downloads and QuickGO
calls happen in the hand-run ``scripts/map_pathways.py``.
"""

from __future__ import annotations

import csv
import hashlib
import json
import re
from collections import Counter
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal, get_args
from urllib.parse import quote

Source = Literal["reactome", "go", "curated"]
SOURCES: frozenset[str] = frozenset(get_args(Source))

PATHWAYS_FILE = "pathways.json"
GO_FILE = "go_fallback.csv"
CURATED_FILE = "curated_pathways.csv"
GO_COLUMNS = ("target", "go_id", "go_name")
CURATED_COLUMNS = ("target", "node_label", "note", "source_url")
_GO_ID = re.compile(r"GO:\d{7}")
JACCARD_DIGITS = 3


@dataclass(frozen=True)
class PathwayRef:
    id: str
    name: str
    parents: tuple[str, ...]
    genes: int  # Reactome gene-set size; 0 for GO and curated nodes (not counted)
    source: Source


@dataclass(frozen=True)
class Pathways:
    release: str
    targets: dict[str, tuple[str, ...]]  # gene symbol -> lowest-level pathway ids
    pathways: dict[str, PathwayRef]
    overlaps: tuple[tuple[str, str, float], ...]  # reactome only, jaccard >= floor
    urls: dict[str, str] = field(default_factory=dict)  # curated id -> source_url


# --- Reactome ----------------------------------------------------------------------------


def _read_gmt(path: Path, prefix: str) -> dict[str, frozenset[str]]:
    """``name<TAB>id<TAB>gene...`` rows → pathway id → gene symbols (human only)."""
    out: dict[str, frozenset[str]] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        cells = line.split("\t")
        if len(cells) >= 2 and cells[1].startswith(prefix):
            out[cells[1]] = frozenset(g for g in cells[2:] if g)
    return out


def _read_names(path: Path, prefix: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        cells = line.split("\t")
        if len(cells) >= 2 and cells[0].startswith(prefix):
            out[cells[0]] = cells[1].strip()
    return out


def _read_parents(path: Path, prefix: str) -> dict[str, tuple[str, ...]]:
    """``parent<TAB>child`` rows → child → sorted parents (human only)."""
    out: dict[str, set[str]] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        cells = line.split()
        if len(cells) == 2 and all(c.startswith(prefix) for c in cells):
            out.setdefault(cells[1], set()).add(cells[0])
    return {k: tuple(sorted(v)) for k, v in out.items()}


def _excluded(parents: Mapping[str, tuple[str, ...]], roots: frozenset[str]) -> set[str]:
    """The roots and every pathway below one of them."""
    memo: dict[str, bool] = {}

    def under(pid: str, seen: frozenset[str] = frozenset()) -> bool:
        if pid in roots:
            return True
        if pid not in memo:
            memo[pid] = any(under(p, seen | {pid}) for p in parents.get(pid, ()) if p not in seen)
        return memo[pid]

    ids = set(parents) | {p for ps in parents.values() for p in ps} | set(roots)
    return {pid for pid in ids if under(pid)}


def _ancestors(pid: str, parents: Mapping[str, tuple[str, ...]]) -> set[str]:
    out: set[str] = set()
    stack = list(parents.get(pid, ()))
    while stack:
        p = stack.pop()
        if p not in out:
            out.add(p)
            stack.extend(parents.get(p, ()))
    return out


def build_pathways(
    genes: Iterable[str],
    gmt: Path,
    names: Path,
    relations: Path,
    *,
    human_prefix: str = "R-HSA-",
    exclude_roots: frozenset[str],
    floor: float,
) -> Pathways:
    """Reactome pathways for ``genes`` from the downloadable files.

    Each gene maps to its lowest-level pathways: the ones that list it while none of their
    (kept) child pathways do. The GMT lists every level's full gene set, so this is the
    deepest step that names the gene. ``exclude_roots`` and everything below them are
    dropped first. Kept: those pathways plus all their ancestors. ``overlaps`` holds the
    Jaccard index of the gene sets of two kept pathways when it is at least ``floor`` and
    neither is an ancestor of the other (that is the hierarchy, not crosstalk).
    ``release`` is left empty; the caller sets it.
    """
    sets = _read_gmt(gmt, human_prefix)
    labels = _read_names(names, human_prefix)
    parents = _read_parents(relations, human_prefix)
    gone = _excluded(parents, exclude_roots)
    sets = {k: v for k, v in sets.items() if k not in gone}
    parents = {
        k: tuple(p for p in ps if p not in gone and p in sets)
        for k, ps in parents.items()
        if k not in gone and k in sets
    }
    children: dict[str, set[str]] = {}
    for child, ps in parents.items():
        for p in ps:
            children.setdefault(p, set()).add(child)

    targets: dict[str, tuple[str, ...]] = {}
    for gene in sorted(set(genes)):
        holding = {pid for pid, members in sets.items() if gene in members}
        lowest = sorted(p for p in holding if not (children.get(p, set()) & holding))
        if lowest:
            targets[gene] = tuple(lowest)

    keep: set[str] = set()
    for ids in targets.values():
        for pid in ids:
            keep |= {pid} | _ancestors(pid, parents)
    pathways = {
        pid: PathwayRef(
            id=pid,
            name=labels.get(pid, pid),
            parents=parents.get(pid, ()),
            genes=len(sets[pid]),
            source="reactome",
        )
        for pid in sorted(keep)
    }

    lineage = {pid: _ancestors(pid, parents) for pid in keep}
    ordered = sorted(keep)
    overlaps: list[tuple[str, str, float]] = []
    for i, a in enumerate(ordered):
        sa = sets[a]
        for b in ordered[i + 1 :]:
            if a in lineage[b] or b in lineage[a]:
                continue
            sb = sets[b]
            shared = len(sa & sb)
            if not shared:
                continue
            j = round(shared / len(sa | sb), JACCARD_DIGITS)
            if j >= floor and j > 0:
                overlaps.append((a, b, j))
    return Pathways(release="", targets=targets, pathways=pathways, overlaps=tuple(overlaps))


# --- QuickGO (Gene Ontology fallback) ----------------------------------------------------

QUICKGO_URL = "https://www.ebi.ac.uk/QuickGO/services"
HUMAN_TAXON = 9606
QUICKGO_LIMIT = 100
MAX_PAGES = 20
# Electronic annotations are not manually reviewed.
UNREVIEWED_EVIDENCE = frozenset({"IEA"})


def quickgo_key(url: str) -> str:
    """A readable, collision-safe file name for a QuickGO ``url`` (cache and fixtures)."""
    rel = url.split("/QuickGO/services/", 1)[-1]
    slug = re.sub(r"[^A-Za-z0-9.-]+", "_", rel).strip("_")[:80]
    digest = hashlib.sha1(url.encode("utf-8")).hexdigest()[:10]
    return f"{slug}-{digest}.json"


Json = dict[str, Any]


class QuickGo:
    """The three QuickGO calls the fallback needs; ``get_json(url)`` does the HTTP."""

    def __init__(self, get_json: Callable[[str], Any], base_url: str = QUICKGO_URL) -> None:
        self._get = get_json
        self._base = base_url

    def _pages(self, url: str) -> list[Json]:
        out: list[Json] = []
        for page in range(1, MAX_PAGES + 1):
            body = self._get(f"{url}&page={page}")
            if not isinstance(body, dict):
                raise _invalid(f"QuickGO: not a JSON object from {url}")
            out.extend(r for r in body.get("results") or [] if isinstance(r, dict))
            info = body.get("pageInfo") or {}
            if not isinstance(info, dict) or int(info.get("total") or 1) <= page:
                break
        return out

    def _reviewed(self, gene: str) -> set[str]:
        url = (
            f"{self._base}/geneproduct/search?query={quote(gene)}"
            f"&taxonId={HUMAN_TAXON}&type=protein&limit={QUICKGO_LIMIT}"
        )
        return {
            str(r.get("id"))
            for r in self._pages(url)
            if r.get("symbol") == gene
            and r.get("databaseSubset") == "Swiss-Prot"
            and r.get("taxonId") == HUMAN_TAXON
            and r.get("id")
        }

    def is_human(self, gene: str) -> bool:
        """Whether ``gene`` is the exact symbol of a reviewed (Swiss-Prot) human protein.

        Viral and bacterial targets (influenza ``M``, ``rplA``) are not, even when Reactome
        lists a viral protein of the same name inside a human pathway.
        """
        return bool(self._reviewed(gene))

    def accession(self, gene: str) -> str | None:
        """The one reviewed (Swiss-Prot) human protein whose symbol is exactly ``gene``."""
        hits = self._reviewed(gene)
        return hits.pop() if len(hits) == 1 else None

    def process_terms(self, accession: str) -> Counter[str]:
        """Manually reviewed, positive biological-process GO ids → number of annotations."""
        url = (
            f"{self._base}/annotation/search?geneProductId={quote(accession)}"
            f"&aspect=biological_process&taxonId={HUMAN_TAXON}&limit={QUICKGO_LIMIT}"
        )
        return Counter(
            str(r["goId"])
            for r in self._pages(url)
            if isinstance(r.get("goId"), str)
            and r.get("goEvidence") not in UNREVIEWED_EVIDENCE
            and not str(r.get("qualifier") or "").startswith("NOT")
        )

    def ancestry(self, ids: Iterable[str]) -> dict[str, tuple[str, frozenset[str]]]:
        """GO id → (name, ancestors over is_a/part_of, self excluded); obsolete terms dropped."""
        ids = sorted(set(ids))
        if not ids:
            return {}
        url = f"{self._base}/ontology/go/terms/{','.join(ids)}/ancestors?relations=is_a,part_of"
        body = self._get(url)
        out: dict[str, tuple[str, frozenset[str]]] = {}
        for r in (body.get("results") if isinstance(body, dict) else None) or []:
            if not isinstance(r, dict) or r.get("isObsolete") or not isinstance(r.get("id"), str):
                continue
            gid = r["id"]
            anc = frozenset(a for a in r.get("ancestors") or [] if isinstance(a, str)) - {gid}
            out[gid] = (str(r.get("name") or gid), anc)
        return out


def go_fallback(genes: Iterable[str], quickgo: QuickGo) -> dict[str, tuple[str, str]]:
    """Gene → (GO id, name): its most specific manually reviewed biological-process term.

    Most specific: not an ancestor of another of the gene's terms; then the deepest (most
    ancestors); then the most annotations; then the lowest id. Genes without a single
    reviewed human protein or without such a term are left out.
    """
    out: dict[str, tuple[str, str]] = {}
    for gene in sorted(set(genes)):
        acc = quickgo.accession(gene)
        if acc is None:
            continue
        counts = quickgo.process_terms(acc)
        terms = quickgo.ancestry(counts)
        if not terms:
            continue
        above = set().union(*(anc for _name, anc in terms.values()))
        leaves = [g for g in terms if g not in above]
        best = min(leaves, key=lambda g: (-len(terms[g][1]), -counts[g], g))
        out[gene] = (best, terms[best][0])
    return out


# --- files ---------------------------------------------------------------------------------


def write_pathways(path: Path, p: Pathways) -> None:
    """``pathways.json``: release, targets, pathways (with ``source``) and overlaps."""
    doc = {
        "reactome_release": p.release,
        "targets": {g: list(ids) for g, ids in sorted(p.targets.items())},
        "pathways": {
            pid: {
                "name": ref.name,
                "parents": list(ref.parents),
                "genes": ref.genes,
                "source": ref.source,
            }
            for pid, ref in sorted(p.pathways.items())
        },
        "overlaps": [[a, b, j] for a, b, j in sorted(p.overlaps)],
    }
    path.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


def _invalid(message: str) -> ValueError:
    """Bad file content is a ``ValueError`` even when the problem is a JSON value's type."""
    return ValueError(message)


def _str(value: Any, where: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise _invalid(f"{where}: expected a non-empty string")
    return value.strip()


def _str_list(value: Any, where: str) -> tuple[str, ...]:
    if not isinstance(value, list):
        raise _invalid(f"{where}: expected a list")
    return tuple(_str(v, where) for v in value)


def _parse_json(path: Path) -> Pathways:
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"{path.name}: {exc}") from exc
    if not isinstance(doc, dict):
        raise _invalid(f"{path.name}: expected a JSON object")
    for key in ("reactome_release", "targets", "pathways", "overlaps"):
        if key not in doc:
            raise ValueError(f"{path.name}: missing {key!r}")
    release = doc["reactome_release"]
    if not isinstance(release, str):
        raise _invalid(f"{path.name}: reactome_release must be a string")
    raw_pw, raw_targets, raw_overlaps = doc["pathways"], doc["targets"], doc["overlaps"]
    if not isinstance(raw_pw, dict) or not isinstance(raw_targets, dict):
        raise _invalid(f"{path.name}: targets and pathways must be objects")
    if not isinstance(raw_overlaps, list):
        raise _invalid(f"{path.name}: overlaps must be a list")
    pathways: dict[str, PathwayRef] = {}
    for pid, raw in raw_pw.items():
        where = f"{path.name} pathway {pid}"
        if not isinstance(raw, dict):
            raise _invalid(f"{where}: expected an object")
        genes = raw.get("genes")
        if not isinstance(genes, int) or isinstance(genes, bool) or genes < 0:
            raise _invalid(f"{where}: genes must be a count")
        source = raw.get("source", "reactome")
        if source not in SOURCES:
            raise ValueError(f"{where}: bad source {source!r}")
        pathways[pid] = PathwayRef(
            id=pid,
            name=_str(raw.get("name"), where),
            parents=_str_list(raw.get("parents"), where),
            genes=genes,
            source=source,
        )
    for pid, ref in pathways.items():
        if missing := [p for p in ref.parents if p not in pathways]:
            raise ValueError(f"{path.name} pathway {pid}: unknown parent {missing[0]}")
    targets: dict[str, tuple[str, ...]] = {}
    for gene, ids in raw_targets.items():
        where = f"{path.name} target {gene}"
        targets[_str(gene, where)] = ids_ = _str_list(ids, where)
        if missing := [i for i in ids_ if i not in pathways]:
            raise ValueError(f"{where}: unknown pathway {missing[0]}")
    overlaps: list[tuple[str, str, float]] = []
    for row in raw_overlaps:
        ok = (
            isinstance(row, list)
            and len(row) == 3
            and all(isinstance(v, str) and v in pathways for v in row[:2])
            and isinstance(row[2], int | float)
            and not isinstance(row[2], bool)
            and 0 < row[2] <= 1
        )
        if not ok:
            raise ValueError(f"{path.name}: bad overlap {row!r}")
        overlaps.append((row[0], row[1], float(row[2])))
    return Pathways(release, targets, pathways, tuple(overlaps))


def _csv_rows(path: Path, columns: tuple[str, ...]) -> list[dict[str, str]]:
    if not path.is_file():
        return []
    with path.open(newline="", encoding="utf-8-sig") as f:
        try:
            reader = csv.DictReader(f)
            missing = [c for c in columns if c not in (reader.fieldnames or [])]
            if missing:
                raise ValueError(f"{path.name}: missing column(s) {', '.join(missing)}")
            rows: list[dict[str, str]] = []
            for raw in reader:
                if None in raw:
                    raise ValueError(f"{path.name} line {reader.line_num}: more cells than columns")
                rows.append({c: (raw.get(c) or "").strip() for c in columns})
            return rows
        except csv.Error as exc:
            raise ValueError(f"{path.name}: {exc}") from exc


def curated_id(label: str) -> str:
    """``curated:<slug>`` for a curated node label (``lymphocyte depletion`` → ...-depletion)."""
    slug = re.sub(r"[^a-z0-9]+", "-", label.casefold()).strip("-")
    if not slug:
        raise ValueError(f"curated label {label!r} has no letters or digits")
    return f"curated:{slug}"


def read_go_fallback(path: Path) -> dict[str, tuple[str, str]]:
    """``go_fallback.csv`` → gene → (GO id, name). A missing file is empty."""
    out: dict[str, tuple[str, str]] = {}
    for n, row in enumerate(_csv_rows(path, GO_COLUMNS), start=2):
        where = f"{path.name} line {n}"
        gene, go_id, name = (row[c] for c in GO_COLUMNS)
        if not gene or not name:
            raise ValueError(f"{where}: empty target or go_name")
        if not _GO_ID.fullmatch(go_id):
            raise ValueError(f"{where}: bad GO id {go_id!r}")
        if gene in out:
            raise ValueError(f"{where}: duplicate target {gene!r}")
        out[gene] = (go_id, name)
    return out


def _read_curated_rows(path: Path) -> dict[str, list[tuple[str, str, str]]]:
    """``curated_pathways.csv`` → gene → [(curated id, label, source_url), ...]."""
    out: dict[str, list[tuple[str, str, str]]] = {}
    for n, row in enumerate(_csv_rows(path, CURATED_COLUMNS), start=2):
        where = f"{path.name} line {n}"
        gene, label, url = row["target"], row["node_label"], row["source_url"]
        if not gene or not label:
            raise ValueError(f"{where}: empty target or node_label")
        if not url.startswith(("https://", "http://")):
            raise ValueError(f"{where}: source_url is required")
        node = (curated_id(label), label)
        if node in [(cid, lab) for cid, lab, _url in out.get(gene, [])]:
            raise ValueError(f"{where}: duplicate row for {gene!r}")
        out.setdefault(gene, []).append((*node, url))
    return out


def read_curated(path: Path) -> dict[str, tuple[tuple[str, str], ...]]:
    """``curated_pathways.csv`` → gene → ((curated id, label), ...). A missing file is empty."""
    return {
        g: tuple((cid, label) for cid, label, _url in rows)
        for g, rows in _read_curated_rows(path).items()
    }


def read_pathways(dir: Path) -> Pathways:
    """``pathways.json`` with ``go_fallback.csv`` and then ``curated_pathways.csv`` applied.

    A GO row replaces the target's Reactome pathways; a curated row replaces both. Raises
    ``OSError`` if ``pathways.json`` is missing (the CSVs are optional) and ``ValueError``
    on invalid content.
    """
    base = _parse_json(dir / PATHWAYS_FILE)
    targets = dict(base.targets)
    pathways = dict(base.pathways)
    for gene, (go_id, name) in read_go_fallback(dir / GO_FILE).items():
        targets[gene] = (go_id,)
        pathways[go_id] = PathwayRef(go_id, name, (), 0, "go")
    urls: dict[str, str] = {}
    for gene, rows in _read_curated_rows(dir / CURATED_FILE).items():
        targets[gene] = tuple(cid for cid, _label, _url in rows)
        for cid, label, url in rows:
            pathways[cid] = PathwayRef(cid, label, (), 0, "curated")
            urls.setdefault(cid, url)
    return Pathways(
        release=base.release,
        targets=dict(sorted(targets.items())),
        pathways=dict(sorted(pathways.items())),
        overlaps=base.overlaps,
        urls=dict(sorted(urls.items())),
    )


def write_go_fallback(path: Path, rows: Mapping[str, tuple[str, str]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(GO_COLUMNS)
        for gene, (go_id, name) in sorted(rows.items()):
            w.writerow((gene, go_id, name))
