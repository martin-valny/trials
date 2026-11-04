"""ClinicalTrials.gov v2 client with retry/backoff and de-duplication."""

from __future__ import annotations

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


class CtGovError(RuntimeError):
    """Raised when the API fails after retries or returns a non-retryable error."""


def _nct_id(study: dict[str, Any]) -> str:
    return str(study["protocolSection"]["identificationModule"]["nctId"])


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
                return max(0.0, float(str(resp.headers["Retry-After"])))
            except (KeyError, ValueError):
                pass
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
                    body = resp.json()
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
        return str(self._get("/version")["dataTimestamp"])

    def iter_studies(self, cfg: AreaConfig) -> Iterator[dict[str, Any]]:
        params = build_params(cfg)
        studies: dict[str, dict[str, Any]] = {}
        while True:
            payload = self._get("/studies", params)
            for study in payload.get("studies", []):
                studies[_nct_id(study)] = study  # last occurrence wins, first-seen order kept
            token = payload.get("nextPageToken")
            if not token:
                break
            params = {**params, "pageToken": token}
        yield from studies.values()
