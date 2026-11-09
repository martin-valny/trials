"""Mock-transport fixtures: tools never touch the network in tests."""

from collections.abc import Callable

import httpx
import pytest
from helpers import BASE

from diligence.tools.http import client
from diligence.tools.registry_of_tools import ToolContext


@pytest.fixture
def make_http() -> Callable[[Callable[[httpx.Request], httpx.Response]], httpx.Client]:
    def make(handler: Callable[[httpx.Request], httpx.Response]) -> httpx.Client:
        return client(transport=httpx.MockTransport(handler), sleep=lambda _s: None)

    return make


@pytest.fixture
def ctx(
    make_http: Callable[[Callable[[httpx.Request], httpx.Response]], httpx.Client],
) -> ToolContext:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503)

    return ToolContext(http=make_http(handler), base_url=BASE)
