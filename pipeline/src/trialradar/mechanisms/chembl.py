"""A small, polite ChEMBL REST client: JSON, on-disk cache keyed by URL, retry with backoff."""

from __future__ import annotations

import hashlib
import json
import math
import os
import random
import re
import tempfile
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


def _read_cache(path: Path) -> Json | None:
    """The cached body, or None (a miss) if absent, unreadable or not a JSON object."""
    try:
        body = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return body if isinstance(body, dict) else None


def _write_atomic(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


class _Ambiguous:
    """Exact matches that resolve to different parents: not a miss, so no fallback."""


_AMBIGUOUS = _Ambiguous()


class JsonClient:
    """Shared JSON-over-HTTP transport: on-disk cache, retry with backoff, optional recording.

    Subclasses set ``error_class`` (raised on failure) and may override :meth:`_accepted_error`.
    """

    error_class: type[RuntimeError] = ChemblError

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
                        raise self.error_class(f"GET {url}: response is not valid JSON") from exc
                    if not isinstance(body, dict):
                        raise self.error_class(f"GET {url}: unexpected response body")
                    return body
                accepted = self._accepted_error(resp)
                if accepted is not None:
                    return accepted
                failure = f"HTTP {resp.status_code}"
                if resp.status_code != 429 and resp.status_code < 500:
                    raise self.error_class(f"GET {url} failed: {failure}")
            if attempt == MAX_RETRIES:
                raise self.error_class(f"GET {url} failed after {MAX_RETRIES} retries: {failure}")
            self._sleep(self._backoff(attempt, resp))
        raise AssertionError("unreachable")

    def _accepted_error(self, resp: httpx.Response) -> Json | None:
        """A body to return instead of failing on a non-200 response (default: none)."""
        return None

    def _get(self, path: str, params: dict[str, str | int] | None = None) -> Json:
        url = self._url(path, params)
        key = cache_key(url)
        cached = self._cache_dir / key if self._cache_dir is not None else None
        body = _read_cache(cached) if cached is not None else None
        if body is None:
            body = self._fetch(url)
            if cached is not None:
                _write_atomic(cached, json.dumps(body))
        if self._record_dir is not None:
            saved = self._record(path, body) if self._record is not None else body
            self._record_dir.mkdir(parents=True, exist_ok=True)
            (self._record_dir / key).write_text(
                json.dumps(saved, indent=1, sort_keys=True, ensure_ascii=False) + "\n",
                encoding="utf-8",
            )
        return body


class ChemblClient(JsonClient):
    # --- API ---------------------------------------------------------------------

    def find_molecule(self, name: str) -> Json | None:
        """The molecule whose pref_name or a synonym equals ``name`` (casefolded), or None.

        Tries the free-text search, then (only on a miss) exact ``pref_name`` and exact
        synonym lookups. Several exact matches with one parent (a parent and its salts often
        share a synonym): the self-parent wins, else the first in ChEMBL's order. Exact
        matches with different parents are ambiguous → None (left to ``overrides.csv``).
        """
        want = name.casefold().strip()
        lookups: list[tuple[str, dict[str, str | int]]] = [
            ("molecule/search.json", {"q": want, "limit": SEARCH_LIMIT}),
            ("molecule.json", {"pref_name__iexact": want, "limit": SEARCH_LIMIT}),
            (
                "molecule.json",
                {"molecule_synonyms__molecule_synonym__iexact": want, "limit": SEARCH_LIMIT},
            ),
        ]
        for path, params in lookups:
            picked = self._pick(want, self._get(path, params).get("molecules"))
            if picked is _AMBIGUOUS:
                return None
            if isinstance(picked, dict):
                return picked
        return None

    def _pick(self, want: str, molecules: Any) -> Json | _Ambiguous | None:
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
        if len({self.parent_id(m) for m in exact}) > 1:
            return _AMBIGUOUS
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
        return self._paged("mechanism.json", "mechanisms", {"parent_molecule_chembl_id": parent_id})

    def mechanisms_on_target(self, target_id: str) -> list[Json]:
        """Every mechanism row recorded against the target ``target_id``."""
        return self._paged("mechanism.json", "mechanisms", {"target_chembl_id": target_id})

    def indications(self, parent_id: str) -> list[Json]:
        """Every drug-indication row for ``parent_id`` (``mesh_heading``, ``efo_term``, ...)."""
        return self._paged(
            "drug_indication.json",
            "drug_indications",
            {"parent_molecule_chembl_id": parent_id},
        )

    def _paged(self, path: str, key: str, params: dict[str, str | int]) -> list[Json]:
        rows: list[Json] = []
        for page in range(MAX_PAGES):
            body = self._get(path, {**params, "limit": PAGE_LIMIT, "offset": page * PAGE_LIMIT})
            found = body.get(key)
            rows += [r for r in found if isinstance(r, dict)] if isinstance(found, list) else []
            meta = body.get("page_meta")
            if not (isinstance(meta, dict) and meta.get("next")):
                return rows
        raise ChemblError(f"{path} for {params} exceeded {MAX_PAGES} pages")

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
