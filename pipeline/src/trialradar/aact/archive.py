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
DEFAULT_SEED = Path.home() / "Desktop/event-signal-backtest/data/raw/aact/monthly_flat.json"
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
    out = [
        Archive(int(r["id"]), date.fromisoformat(str(r["created_at"])[:10]), int(r["size_bytes"]))
        for r in rows
    ]
    return sorted(out, key=lambda a: a.snap_date)


class _client_ctx:
    """Context manager: use the given client, or open (and close) a private one."""

    def __init__(self, client: httpx.Client | None) -> None:
        self.owned = client is None
        self.client = client or httpx.Client(timeout=120)

    def __enter__(self) -> httpx.Client:
        return self.client

    def __exit__(self, *exc: object) -> None:
        if self.owned:
            self.client.close()


def _require_partial(r: httpx.Response) -> None:
    r.raise_for_status()
    if r.status_code != 206:
        raise OSError(f"server ignored Range request (HTTP {r.status_code}, expected 206)")


def _retry_after(r: httpx.Response) -> int:
    try:
        return max(0, int(r.headers.get("Retry-After", "")))
    except ValueError:
        return 300


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
            sleep(_retry_after(r) + RETRY_PAD)
            continue
        r.raise_for_status()
    raise RuntimeError(f"no download link for AACT snapshot {archive_id}")


URL_MAX_AGE = 270.0  # signed links expire after 300 s


class SignedUrls:
    """Per-archive cache of signed download URLs (the link endpoint is tightly rate-limited)."""

    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self.clock = clock
        self._urls: dict[int, tuple[str, float]] = {}

    def get(self, archive_id: int, mint: Callable[[], str]) -> str:
        hit = self._urls.get(archive_id)
        if hit is not None and self.clock() - hit[1] <= URL_MAX_AGE:
            return hit[0]
        return self.refresh(archive_id, mint)

    def refresh(self, archive_id: int, mint: Callable[[], str]) -> str:
        url = mint()
        self._urls[archive_id] = (url, self.clock())
        return url

    def clear(self) -> None:
        self._urls.clear()


DEFAULT_URLS = SignedUrls()


class _Signer:
    """Hands out a valid signed URL for one archive and re-signs on demand."""

    def __init__(
        self,
        client: httpx.Client,
        archive_id: int,
        api_key: str,
        sleep: Callable[[float], None],
        urls: SignedUrls,
    ) -> None:
        self.client, self.archive_id, self.urls = client, archive_id, urls
        self._mint = lambda: _signed_url(client, archive_id, api_key, sleep)

    def url(self) -> str:
        return self.urls.get(self.archive_id, self._mint)

    def refresh(self) -> str:
        return self.urls.refresh(self.archive_id, self._mint)

    def get(self, rng: str) -> httpx.Response:
        """Ranged GET; on 403 (expired signature) re-sign and retry once."""
        r = self.client.get(self.url(), headers={"Range": rng})
        if r.status_code == 403:
            r = self.client.get(self.refresh(), headers={"Range": rng})
        return r


class _RangeFile(io.RawIOBase):
    """Read-only seekable view of a remote file via Range requests. Unbuffered on purpose."""

    def __init__(self, signer: _Signer) -> None:
        self.signer, self.pos = signer, 0
        r = signer.get("bytes=0-0")
        _require_partial(r)
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
        r = self.signer.get(f"bytes={self.pos}-{end}")
        _require_partial(r)
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
    urls: SignedUrls | None = None,
) -> Path:
    """Write `dest/<table>.txt` (pipe-delimited AACT text), fetching only that zip member."""
    dest.mkdir(parents=True, exist_ok=True)
    final = dest / f"{table}.txt"
    tmp = dest / f"{table}.txt.tmp"
    with _client_ctx(client) as c:
        signer = _Signer(c, archive.id, api_key, sleep, urls if urls is not None else DEFAULT_URLS)
        zf = zipfile.ZipFile(_RangeFile(signer))
        suffix = f"{table}.txt"
        info = next((i for i in zf.infolist() if i.filename.rsplit("/", 1)[-1] == suffix), None)
        if info is None:
            raise KeyError(f"table {table!r} not found in AACT archive {archive.id}")
        if info.compress_type not in (zipfile.ZIP_DEFLATED, zipfile.ZIP_STORED):
            raise ValueError(
                f"unsupported zip compression {info.compress_type} for {info.filename}"
            )
        hdr = signer.get(f"bytes={info.header_offset}-{info.header_offset + LOCAL_HEADER_LEN - 1}")
        _require_partial(hdr)
        n = int.from_bytes(hdr.content[26:28], "little")
        e = int.from_bytes(hdr.content[28:30], "little")
        start = info.header_offset + LOCAL_HEADER_LEN + n + e
        dec = zlib.decompressobj(-15) if info.compress_type == zipfile.ZIP_DEFLATED else None
        remaining = info.compress_size
        crc = written = 0
        with tmp.open("wb") as f:
            offset, resigned = start, False
            while remaining:
                rng = f"bytes={offset}-{start + info.compress_size - 1}"
                with c.stream("GET", signer.url(), headers={"Range": rng}) as r:
                    if r.status_code == 403 and not resigned:
                        resigned = True  # expired signature: re-sign, resume at this offset
                        signer.refresh()
                        continue
                    _require_partial(r)
                    got = 0
                    for chunk in r.iter_bytes(1 << 20):
                        chunk = chunk[:remaining]
                        remaining -= len(chunk)
                        got += len(chunk)
                        data = dec.decompress(chunk) if dec else chunk
                        crc = zlib.crc32(data, crc)
                        written += len(data)
                        f.write(data)
                    offset += got
                if got == 0:
                    break
            if remaining:
                raise OSError(f"short read of {info.filename}: {remaining} bytes missing")
            if dec:
                data = dec.flush()
                crc = zlib.crc32(data, crc)
                written += len(data)
                f.write(data)
            if crc != info.CRC or written != info.file_size:
                raise OSError(
                    f"integrity check failed for {info.filename} in AACT archive {archive.id}"
                )
    tmp.replace(final)
    return final
