"""Pull one table out of an AACT monthly flat-file zip without downloading the whole archive.

The archive is read through HTTP range requests: the zip central directory locates the
member, then only that member's compressed bytes are streamed and inflated. Credentials are
a Bearer API key and are never logged or included in error messages.
"""

from __future__ import annotations

import io
import json
import shutil
import time
import zipfile
import zlib
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

import httpx

AACT_API = "https://aact.ctti-clinicaltrials.org/api/v1"
USER_AGENT = "trialradar-research"
DEFAULT_SEED = Path("/Users/martin.valny/Desktop/event-signal-backtest/data/raw/aact/monthly_flat.json")
LISTING_NAME = "monthly_flat.json"
MAX_TRIES = 6
RETRY_PAD = 5.0
LOCAL_HEADER_LEN = 30


@dataclass(frozen=True)
class Archive:
    id: int
    snap_date: date
    size: int


def read_api_key(path: Path) -> str:
    """Return AACT_API_KEY from whitespace-separated KEY=value tokens in `path`."""
    try:
        text = path.read_text()
    except OSError as exc:
        raise ValueError(f"cannot read AACT credentials file {path}") from exc
    pairs = dict(tok.split("=", 1) for tok in text.split() if "=" in tok)
    key = pairs.get("AACT_API_KEY", "")
    if not key:
        raise ValueError(f"AACT credentials file {path} has no AACT_API_KEY=<value> entry")
    return key


def _auth_headers(api_key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {api_key}", "User-Agent": USER_AGENT}


def list_archives(
    cache: Path,
    api_key: str,
    *,
    client: httpx.Client | None = None,
    seed: Path = DEFAULT_SEED,
) -> list[Archive]:
    """Monthly flat-file archives, oldest first. The listing is cached as cache/monthly_flat.json."""
    cache.mkdir(parents=True, exist_ok=True)
    path = cache / LISTING_NAME
    if not path.exists():
        if seed.exists():
            shutil.copyfile(seed, path)
        else:
            with _client_ctx(client) as c:
                r = c.get(
                    f"{AACT_API}/snapshots/flat/monthly",
                    params={"from": "2018-12-01", "to": "2026-01-31"},
                    headers=_auth_headers(api_key),
                )
                r.raise_for_status()
                path.write_text(r.text)
    rows: list[dict[str, Any]] = json.loads(path.read_text())["data"]
    out = [Archive(int(r["id"]), date.fromisoformat(str(r["created_at"])[:10]), int(r["size"])) for r in rows]
    return sorted(out, key=lambda a: a.snap_date)


class _ClientCtx:
    def __init__(self, client: httpx.Client | None) -> None:
        self.owned = client is None
        self.client = client or httpx.Client(timeout=120)

    def __enter__(self) -> httpx.Client:
        return self.client

    def __exit__(self, *exc: object) -> None:
        if self.owned:
            self.client.close()


def _client_ctx(client: httpx.Client | None) -> _ClientCtx:
    return _ClientCtx(client)


def _signed_url(
    client: httpx.Client, archive_id: int, api_key: str, sleep: Callable[[float], None]
) -> str:
    for _ in range(MAX_TRIES):
        r = client.get(
            f"{AACT_API}/snapshots/flat/{archive_id}/download",
            headers=_auth_headers(api_key),
            follow_redirects=False,
        )
        if r.status_code == 302:
            return r.headers["Location"]
        if r.status_code == 429:
            sleep(int(r.headers.get("Retry-After", 300)) + RETRY_PAD)
            continue
        r.raise_for_status()
    raise RuntimeError(f"no download link for AACT snapshot {archive_id}")


class _RangeFile(io.RawIOBase):
    """Read-only seekable view of a remote file via Range requests. Unbuffered on purpose."""

    def __init__(self, client: httpx.Client, url: str) -> None:
        self.client, self.url, self.pos = client, url, 0
        r = client.get(url, headers={"Range": "bytes=0-0"})
        r.raise_for_status()
        self.size = int(r.headers["Content-Range"].split("/")[1])

    def seekable(self) -> bool:
        return True

    def readable(self) -> bool:
        return True

    def tell(self) -> int:
        return self.pos

    def seek(self, offset: int, whence: int = 0) -> int:
        base = (0, self.pos, self.size)[whence]
        self.pos = base + offset
        return self.pos

    def readinto(self, b: Any) -> int:
        if self.pos >= self.size:
            return 0
        end = min(self.size, self.pos + len(b)) - 1
        r = self.client.get(self.url, headers={"Range": f"bytes={self.pos}-{end}"})
        r.raise_for_status()
        b[: len(r.content)] = r.content
        self.pos += len(r.content)
        return len(r.content)


def extract_table(
    archive: Archive,
    table: str,
    dest: Path,
    api_key: str,
    *,
    client: httpx.Client | None = None,
    sleep: Callable[[float], None] = time.sleep,
) -> Path:
    """Write `dest/<table>.txt` (pipe-delimited AACT text), fetching only that zip member."""
    dest.mkdir(parents=True, exist_ok=True)
    final = dest / f"{table}.txt"
    tmp = dest / f"{table}.txt.tmp"
    with _client_ctx(client) as c:
        url = _signed_url(c, archive.id, api_key, sleep)
        zf = zipfile.ZipFile(_RangeFile(c, url))
        suffix = f"{table}.txt"
        info = next((i for i in zf.infolist() if i.filename.endswith(suffix)), None)
        if info is None:
            raise KeyError(f"table {table!r} not found in AACT archive {archive.id}")
        if info.compress_type not in (zipfile.ZIP_DEFLATED, zipfile.ZIP_STORED):
            raise ValueError(f"unsupported zip compression {info.compress_type} for {info.filename}")
        hdr = c.get(
            url, headers={"Range": f"bytes={info.header_offset}-{info.header_offset + LOCAL_HEADER_LEN - 1}"}
        )
        hdr.raise_for_status()
        n = int.from_bytes(hdr.content[26:28], "little")
        e = int.from_bytes(hdr.content[28:30], "little")
        start = info.header_offset + LOCAL_HEADER_LEN + n + e
        dec = zlib.decompressobj(-15) if info.compress_type == zipfile.ZIP_DEFLATED else None
        remaining = info.compress_size
        with tmp.open("wb") as f:
            if remaining:
                with c.stream("GET", url, headers={"Range": f"bytes={start}-{start + remaining - 1}"}) as r:
                    r.raise_for_status()
                    for chunk in r.iter_bytes(1 << 20):
                        chunk = chunk[:remaining]
                        remaining -= len(chunk)
                        f.write(dec.decompress(chunk) if dec else chunk)
            if remaining:
                raise OSError(f"short read of {info.filename}: {remaining} bytes missing")
            if dec:
                f.write(dec.flush())
    tmp.replace(final)
    return final
