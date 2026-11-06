"""A small, polite ChEMBL REST client: JSON, on-disk cache keyed by URL, retry with backoff."""

from __future__ import annotations

import hashlib
import json
import math
import random
import re
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

import httpx

BASE_URL = "https://www.ebi.ac.uk/chembl/api/data"
MAX_RETRIES = 5
TIMEOUT_SECONDS = 30
MAX_BACKOFF_SECONDS = 60
SEARCH_LIMIT = 25
PAGE_LIMIT = 100
MAX_PAGES = 50

Json = dict[str, Any]


class ChemblError(RuntimeError):
    """Raised when ChEMBL fails after retries or returns a non-retryable error."""


def cache_key(url: str) -> str:
    """A readable, collision-safe file name for ``url`` (used by the cache and ``--record``)."""
    rel = url.split("/chembl/api/data/", 1)[-1]
    slug = re.sub(r"[^A-Za-z0-9.-]+", "_", rel).strip("_")[:80]
    digest = hashlib.sha1(url.encode("utf-8")).hexdigest()[:10]
    return f"{slug}-{digest}.json"


def _str(value: Any) -> str | None:
    return value if isinstance(value, str) and value else None


class ChemblClient:
    def __init__(
        self,
        http: httpx.Client | None = None,
        cache_dir: Path | None = None,
        *,
        base_url: str = BASE_URL,
        record_dir: Path | None = None,
        record: Callable[[str, Json], Json] | None = None,
        sleep: Callable[[float], None] = time.sleep,
        rng: Callable[[float, float], float] = random.uniform,
    ) -> None:
        """``record_dir`` saves every fetched URL's JSON (passed through ``record``, e.g. a
        trimmer) under :func:`cache_key`, for recording test fixtures."""
        self._http = http if http is not None else httpx.Client(timeout=TIMEOUT_SECONDS)
        self._base_url = base_url.rstrip("/")
        self._cache_dir = cache_dir
        self._record_dir = record_dir
        self._record = record
        self._sleep = sleep
        self._rng = rng

    # --- transport ---------------------------------------------------------------

    def _url(self, path: str, params: dict[str, str | int] | None = None) -> str:
        return str(httpx.URL(f"{self._base_url}/{path}", params=params))

    def _backoff(self, attempt: int, resp: httpx.Response | None) -> float:
        if resp is not None and resp.status_code == 429:
            try:
                wait = float(str(resp.headers["Retry-After"]))
            except (KeyError, ValueError):
                pass
            else:
                if math.isfinite(wait) and wait >= 0:
                    return min(wait, float(MAX_BACKOFF_SECONDS))
        return float(min(MAX_BACKOFF_SECONDS, 2**attempt) * self._rng(0.5, 1.5))

    def _fetch(self, url: str) -> Json:
        for attempt in range(MAX_RETRIES + 1):
            resp: httpx.Response | None = None
            try:
                resp = self._http.get(url, headers={"Accept": "application/json"})
            except httpx.TransportError as exc:
                failure = f"transport error: {exc}"
            else:
                if resp.status_code == 200:
                    try:
                        body = resp.json()
                    except ValueError as exc:
                        raise ChemblError(f"GET {url}: response is not valid JSON") from exc
                    if not isinstance(body, dict):
                        raise ChemblError(f"GET {url}: unexpected response body")
                    return body
                failure = f"HTTP {resp.status_code}"
                if resp.status_code != 429 and resp.status_code < 500:
                    raise ChemblError(f"GET {url} failed: {failure}")
            if attempt == MAX_RETRIES:
                raise ChemblError(f"GET {url} failed after {MAX_RETRIES} retries: {failure}")
            self._sleep(self._backoff(attempt, resp))
        raise AssertionError("unreachable")

    def _get(self, path: str, params: dict[str, str | int] | None = None) -> Json:
        url = self._url(path, params)
        key = cache_key(url)
        cached = self._cache_dir / key if self._cache_dir is not None else None
        if cached is not None and cached.is_file():
            body: Json = json.loads(cached.read_text(encoding="utf-8"))
        else:
            body = self._fetch(url)
            if cached is not None:
                cached.parent.mkdir(parents=True, exist_ok=True)
                cached.write_text(json.dumps(body), encoding="utf-8")
        if self._record_dir is not None:
            saved = self._record(path, body) if self._record is not None else body
            self._record_dir.mkdir(parents=True, exist_ok=True)
            (self._record_dir / key).write_text(
                json.dumps(saved, indent=1, sort_keys=True, ensure_ascii=False) + "\n",
                encoding="utf-8",
            )
        return body

    # --- API ---------------------------------------------------------------------

    def find_molecule(self, name: str) -> Json | None:
        """The molecule whose pref_name or a synonym equals ``name`` (casefolded), or None.

        Several exact matches (a parent and its salts often share a synonym): the one that
        is its own parent wins, else the first in ChEMBL's order.
        """
        want = name.casefold().strip()
        body = self._get("molecule/search.json", {"q": want, "limit": SEARCH_LIMIT})
        molecules = body.get("molecules")
        exact: list[Json] = []
        for mol in molecules if isinstance(molecules, list) else []:
            if not isinstance(mol, dict) or not _str(mol.get("molecule_chembl_id")):
                continue
            names = [mol.get("pref_name")]
            syns = mol.get("molecule_synonyms")
            names += [s.get("molecule_synonym") for s in syns or [] if isinstance(s, dict)]
            if any(isinstance(n, str) and n.casefold().strip() == want for n in names):
                exact.append(mol)
        if not exact:
            return None
        for mol in exact:
            if self.parent_id(mol) == mol["molecule_chembl_id"]:
                return mol
        return exact[0]

    def parent_id(self, mol: Json) -> str:
        hierarchy = mol.get("molecule_hierarchy")
        parent = _str(hierarchy.get("parent_chembl_id")) if isinstance(hierarchy, dict) else None
        own = mol.get("molecule_chembl_id")
        if parent is None and not isinstance(own, str):
            raise ChemblError("molecule has no molecule_chembl_id")
        return parent or str(own)

    def molecule(self, chembl_id: str) -> Json:
        return self._get(f"molecule/{chembl_id}.json")

    def mechanisms(self, parent_id: str) -> list[Json]:
        """Every mechanism row recorded against ``parent_id`` or any of its salts/forms."""
        rows: list[Json] = []
        for page in range(MAX_PAGES):
            body = self._get(
                "mechanism.json",
                {
                    "parent_molecule_chembl_id": parent_id,
                    "limit": PAGE_LIMIT,
                    "offset": page * PAGE_LIMIT,
                },
            )
            found = body.get("mechanisms")
            rows += [r for r in found if isinstance(r, dict)] if isinstance(found, list) else []
            meta = body.get("page_meta")
            if not (isinstance(meta, dict) and meta.get("next")):
                return rows
        raise ChemblError(f"mechanisms for {parent_id} exceeded {MAX_PAGES} pages")

    def target(self, target_id: str) -> Json:
        return self._get(f"target/{target_id}.json")

    def target_genes(self, target: Json) -> tuple[str, ...]:
        genes: set[str] = set()
        components = target.get("target_components")
        for comp in components if isinstance(components, list) else []:
            syns = comp.get("target_component_synonyms") if isinstance(comp, dict) else None
            for syn in syns if isinstance(syns, list) else []:
                if isinstance(syn, dict) and syn.get("syn_type") == "GENE_SYMBOL":
                    if gene := _str(syn.get("component_synonym")):
                        genes.add(gene)
                    break
        return tuple(sorted(genes))
