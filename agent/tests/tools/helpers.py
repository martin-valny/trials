"""Fixture loading helpers; tools never touch the network in tests."""

import json
from pathlib import Path
from typing import Any

import httpx

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "http"
BASE = "https://example.test/data/"


def fixture(name: str) -> Any:
    return json.loads((FIXTURES / name).read_text())


def json_response(body: Any, status: int = 200) -> httpx.Response:
    return httpx.Response(status, json=body)
