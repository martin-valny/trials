from __future__ import annotations

import json
import re
import zipfile
from collections.abc import Iterator
from datetime import date
from io import BytesIO
from pathlib import Path

import httpx
import pytest

from trialradar.aact.archive import (
    Archive,
    extract_table,
    list_archives,
    read_api_key,
)

API = "https://aact.ctti-clinicaltrials.org/api/v1"
SIGNED = "https://files.example.com/signed/archive.zip?sig=abc"
INTERVENTIONS = b"id|nct_id|name\n" + b"1|NCT00000001|drug A\n" * 400
STUDIES = b"nct_id|overall_status\n" + b"NCT00000002|COMPLETED\n" * 400


def _zip_bytes() -> tuple[bytes, dict[str, tuple[int, int]]]:
    buf = BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("studies.txt", STUDIES)
        zf.writestr("interventions.txt", INTERVENTIONS)
    data = buf.getvalue()
    spans: dict[str, tuple[int, int]] = {}
    with zipfile.ZipFile(BytesIO(data)) as zf:
        for i in zf.infolist():
            n = int.from_bytes(data[i.header_offset + 26 : i.header_offset + 28], "little")
            e = int.from_bytes(data[i.header_offset + 28 : i.header_offset + 30], "little")
            start = i.header_offset + 30 + n + e
            spans[i.filename] = (start, start + i.compress_size)
    return data, spans


class Server:
    def __init__(self, *, throttle: int = 0, fail_midstream: bool = False) -> None:
        self.data, self.spans = _zip_bytes()
        self.ranges: list[tuple[int, int]] = []
        self.throttle = throttle
        self.fail_midstream = fail_midstream
        self.auth_seen: list[str | None] = []
        self.signed_auth: list[str | None] = []
        self.listing_calls = 0

    def __call__(self, req: httpx.Request) -> httpx.Response:
        url = str(req.url)
        if url.startswith(API):
            self.auth_seen.append(req.headers.get("authorization"))
            assert req.headers["user-agent"] == "trialradar-research"
            if req.url.path.endswith("/snapshots/flat/monthly"):
                self.listing_calls += 1
                body = {"data": [{"id": 7, "created_at": "2024-03-01T05:00:00Z", "size": len(self.data)}]}
                return httpx.Response(200, json=body)
            if req.url.path.endswith("/download"):
                if self.throttle > 0:
                    self.throttle -= 1
                    return httpx.Response(429, headers={"Retry-After": "0"})
                return httpx.Response(302, headers={"Location": SIGNED})
        if url == SIGNED:
            self.signed_auth.append(req.headers.get("authorization"))
            m = re.fullmatch(r"bytes=(\d+)-(\d+)", req.headers["range"])
            assert m
            lo, hi = int(m[1]), min(int(m[2]), len(self.data) - 1)
            self.ranges.append((lo, hi + 1))
            chunk = self.data[lo : hi + 1]
            headers = {"Content-Range": f"bytes {lo}-{hi}/{len(self.data)}"}
            if self.fail_midstream and lo == self.spans["interventions.txt"][0]:
                def gen() -> Iterator[bytes]:
                    yield chunk[:10]
                    raise httpx.ReadError("boom")
                return httpx.Response(206, headers=headers, content=gen())
            return httpx.Response(206, headers=headers, content=chunk)
        return httpx.Response(404)


def _client(server: Server) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(server))


ARCHIVE = Archive(id=7, snap_date=date(2024, 3, 1), size=1)


def test_extract_table_returns_only_that_member(tmp_path: Path) -> None:
    server = Server()
    out = extract_table(ARCHIVE, "interventions", tmp_path, "k", client=_client(server), sleep=lambda s: None)
    assert out == tmp_path / "interventions.txt"
    assert out.read_bytes() == INTERVENTIONS
    lo, hi = server.spans["studies.txt"]
    for a, b in server.ranges:
        assert b <= lo or a >= hi, f"range {a}-{b} overlaps other member {lo}-{hi}"
    assert not list(tmp_path.glob("*.tmp"))
    assert server.auth_seen and all(a == "Bearer k" for a in server.auth_seen)
    assert all(a is None for a in server.signed_auth)


def test_signed_url_retries_on_429(tmp_path: Path) -> None:
    server = Server(throttle=2)
    sleeps: list[float] = []
    out = extract_table(ARCHIVE, "interventions", tmp_path, "k", client=_client(server), sleep=sleeps.append)
    assert out.read_bytes() == INTERVENTIONS
    assert sleeps == [5.0, 5.0]


def test_signed_url_gives_up_after_six(tmp_path: Path) -> None:
    server = Server(throttle=99)
    with pytest.raises(RuntimeError):
        extract_table(ARCHIVE, "interventions", tmp_path, "k", client=_client(server), sleep=lambda s: None)


def test_missing_table_raises(tmp_path: Path) -> None:
    with pytest.raises(KeyError):
        extract_table(ARCHIVE, "nope", tmp_path, "k", client=_client(Server()), sleep=lambda s: None)


def test_read_api_key(tmp_path: Path) -> None:
    p = tmp_path / ".creds"
    p.write_text("OTHER=x\nAACT_API_KEY=secret123\n")
    assert read_api_key(p) == "secret123"


def test_read_credentials_error_hides_content(tmp_path: Path) -> None:
    p = tmp_path / ".creds"
    p.write_text("hunter2-not-a-pair")
    with pytest.raises(ValueError) as ei:
        read_api_key(p)
    assert str(p) in str(ei.value)
    assert "hunter2" not in str(ei.value)


def test_partial_download_leaves_no_final_file(tmp_path: Path) -> None:
    with pytest.raises(httpx.ReadError):
        extract_table(ARCHIVE, "interventions", tmp_path, "k", client=_client(Server(fail_midstream=True)),
                      sleep=lambda s: None)
    assert not (tmp_path / "interventions.txt").exists()
    assert (tmp_path / "interventions.txt.tmp").exists()
    out = extract_table(ARCHIVE, "interventions", tmp_path, "k", client=_client(Server()), sleep=lambda s: None)
    assert out.read_bytes() == INTERVENTIONS
    assert not (tmp_path / "interventions.txt.tmp").exists()


def test_list_archives_seeds_from_file(tmp_path: Path) -> None:
    seed = tmp_path / "seed.json"
    seed.write_text(json.dumps({"data": [
        {"id": 9, "created_at": "2024-04-01T00:10:00Z", "size": 5},
        {"id": 8, "created_at": "2024-03-01T00:10:00Z", "size": 4},
    ]}))
    server = Server()
    got = list_archives(tmp_path / "cache", "k", client=_client(server), seed=seed)
    assert [a.id for a in got] == [8, 9]
    assert got[0] == Archive(id=8, snap_date=date(2024, 3, 1), size=4)
    assert (tmp_path / "cache" / "monthly_flat.json").exists()
    assert server.listing_calls == 0


def test_list_archives_fetches_when_no_seed(tmp_path: Path) -> None:
    server = Server()
    got = list_archives(tmp_path / "cache", "k", client=_client(server), seed=tmp_path / "missing.json")
    assert got == [Archive(id=7, snap_date=date(2024, 3, 1), size=len(server.data))]
    assert server.listing_calls == 1
