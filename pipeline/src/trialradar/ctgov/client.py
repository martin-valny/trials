"""ClinicalTrials.gov v2 client with retry/backoff and de-duplication."""

from __future__ import annotations

import math
import random
import time
from collections.abc import Callable, Iterator
from typing import Any

import httpx

from trialradar.config import AreaConfig
from trialradar.ctgov.query import build_params

MAX_RETRIES = 5
TIMEOUT_SECONDS = 30
MAX_BACKOFF_SECONDS = 60
MAX_PAGES = 100  # ~100k studies at pageSize 1000


class CtGovError(RuntimeError):
    """Raised when the API fails after retries or returns a non-retryable error."""


def _nct_id(study: Any, page: int, index: int) -> str:
    try:
        nct = study["protocolSection"]["identificationModule"]["nctId"]
    except (KeyError, TypeError):
        nct = None
    if not isinstance(nct, str) or not nct:
        raise CtGovError(f"study on page {page} index {index} has no nctId")
    return nct


class CtGovClient:
    def __init__(
        self,
        http: httpx.Client | None = None,
        base_url: str = "https://clinicaltrials.gov/api/v2",
        sleep: Callable[[float], None] = time.sleep,
        rng: Callable[[float, float], float] = random.uniform,
    ) -> None:
        self._http = http if http is not None else httpx.Client(timeout=TIMEOUT_SECONDS)
        self._base_url = base_url.rstrip("/")
        self._sleep = sleep
        self._rng = rng

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

    def _get(self, path: str, params: dict[str, str] | None = None) -> dict[str, Any]:
        url = f"{self._base_url}{path}"
        for attempt in range(MAX_RETRIES + 1):
            resp: httpx.Response | None = None
            try:
                resp = self._http.get(url, params=params)
            except httpx.TransportError as exc:
                failure = f"transport error: {exc}"
            else:
                if resp.status_code == 200:
                    try:
                        body = resp.json()
                    except ValueError as exc:
                        raise CtGovError(f"GET {path}: response is not valid JSON") from exc
                    if not isinstance(body, dict):
                        raise CtGovError(f"GET {path}: unexpected response body")
                    return body
                failure = f"HTTP {resp.status_code}"
                if resp.status_code != 429 and resp.status_code < 500:
                    raise CtGovError(f"GET {path} failed: {failure}: {resp.text[:200]}")
            if attempt == MAX_RETRIES:
                raise CtGovError(f"GET {path} failed after {MAX_RETRIES} retries: {failure}")
            self._sleep(self._backoff(attempt, resp))
        raise AssertionError("unreachable")

    def data_timestamp(self) -> str:
        ts = self._get("/version").get("dataTimestamp")
        if not isinstance(ts, str) or not ts:
            raise CtGovError("GET /version: missing or invalid dataTimestamp")
        return ts

    def iter_studies(self, cfg: AreaConfig) -> Iterator[dict[str, Any]]:
        return self.iter_query(build_params(cfg))

    def iter_query(self, params: dict[str, str]) -> Iterator[dict[str, Any]]:
        """Page through any ``/studies`` query, de-duplicated by NCT id."""
        studies: dict[str, dict[str, Any]] = {}
        seen_tokens: set[str] = set()
        page = 0
        while True:
            page += 1
            if page > MAX_PAGES:
                raise CtGovError(f"crawl exceeded {MAX_PAGES} pages")
            payload = self._get("/studies", params)
            page_studies = payload.get("studies")
            if not isinstance(page_studies, list):
                raise CtGovError(f"GET /studies page {page}: 'studies' missing or not a list")
            for index, study in enumerate(page_studies):
                # last occurrence wins, first-seen order kept
                studies[_nct_id(study, page, index)] = study
            token = payload.get("nextPageToken")
            if not token:
                break
            if not isinstance(token, str) or token in seen_tokens:
                raise CtGovError(f"GET /studies page {page}: repeated or invalid nextPageToken")
            seen_tokens.add(token)
            params = {**params, "pageToken": token}
        yield from studies.values()
