"""Shared httpx client: timeouts, retry with backoff on 5xx and timeouts."""

import time
from collections.abc import Callable
from typing import Any

import httpx

USER_AGENT = "trial-radar-diligence/0.1 (+https://martin-valny.github.io/trials/)"


class ToolError(Exception):
    """An upstream call failed in a way the tool cannot recover from."""


class RetryTransport(httpx.BaseTransport):
    """Wraps a transport: retries 5xx responses and transport errors with exponential backoff."""

    def __init__(
        self,
        inner: httpx.BaseTransport,
        *,
        retries: int = 2,
        backoff_s: float = 0.5,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._inner = inner
        self._retries = retries
        self._backoff_s = backoff_s
        self._sleep = sleep

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        attempt = 0
        while True:
            try:
                response = self._inner.handle_request(request)
            except httpx.TransportError:
                if attempt >= self._retries:
                    raise
            else:
                if response.status_code < 500 or attempt >= self._retries:
                    return response
                response.close()
            self._sleep(self._backoff_s * (2**attempt))
            attempt += 1

    def close(self) -> None:
        self._inner.close()


def client(
    timeout_s: float = 10,
    *,
    transport: httpx.BaseTransport | None = None,
    retries: int = 2,
    backoff_s: float = 0.5,
    sleep: Callable[[float], None] = time.sleep,
) -> httpx.Client:
    """A client that retries twice on 5xx or timeout. Tests pass a mock transport and a no-op sleep."""
    inner = transport if transport is not None else httpx.HTTPTransport()
    return httpx.Client(
        timeout=timeout_s,
        follow_redirects=True,
        headers={"User-Agent": USER_AGENT},
        transport=RetryTransport(inner, retries=retries, backoff_s=backoff_s, sleep=sleep),
    )


def get_response(
    http: httpx.Client, url: str, params: dict[str, Any] | None = None
) -> httpx.Response:
    """GET; transport failures become ToolError, status codes are left to the caller."""
    try:
        return http.get(url, params=params)
    except httpx.HTTPError as exc:
        raise ToolError(f"request failed: {type(exc).__name__}") from exc


def get_json(http: httpx.Client, url: str, params: dict[str, Any] | None = None) -> Any:
    """GET and decode JSON; any non-2xx or bad body is a ToolError."""
    resp = get_response(http, url, params)
    if resp.status_code >= 400:
        raise ToolError(f"upstream returned HTTP {resp.status_code}")
    try:
        return resp.json()
    except ValueError as exc:
        raise ToolError("upstream returned invalid JSON") from exc


def trim(text: str, limit: int) -> str:
    """Collapse whitespace and cut to ``limit`` characters (ellipsis counts)."""
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"
