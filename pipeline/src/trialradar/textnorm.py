"""Text and date normalisation helpers."""

from __future__ import annotations

import csv
import re
import unicodedata
from datetime import date
from pathlib import Path

_WS = re.compile(r"\s+")
_MONTH = re.compile(r"(\d{4})-(\d{2})")
_DAY = re.compile(r"(\d{4})-(\d{2})-(\d{2})")


def norm_text(s: str | None) -> str | None:
    """NFKC, NBSP to space, strip and collapse whitespace; None for None/empty."""
    if s is None:
        return None
    out = _WS.sub(" ", unicodedata.normalize("NFKC", s).replace(" ", " ")).strip()
    return out or None


def norm_key(s: str) -> str:
    """Case-insensitive comparison key."""
    return (norm_text(s) or "").casefold()


def load_aliases(path: Path) -> dict[str, str]:
    """Load a ``raw,normalized`` CSV; a missing or header-only file yields ``{}``."""
    if not path.is_file():
        return {}
    aliases: dict[str, str] = {}
    with path.open(newline="", encoding="utf-8-sig") as fh:
        for row in csv.DictReader(fh):
            raw, normalized = row.get("raw"), norm_text(row.get("normalized"))
            if raw is None or normalized is None:
                continue
            key = norm_key(raw)
            if key:
                aliases[key] = normalized
    return aliases


def apply_alias(name: str, aliases: dict[str, str]) -> str:
    """Mapped value for ``name`` or its whitespace-normalised form."""
    return aliases.get(norm_key(name)) or norm_text(name) or ""


def parse_ct_date(s: str | None) -> tuple[date | None, str | None]:
    """Parse ``YYYY-MM`` or ``YYYY-MM-DD`` into ``(date, precision)``."""
    if s is None:
        return None, None
    try:
        if m := _MONTH.fullmatch(s):
            return date(int(m[1]), int(m[2]), 1), "month"
        if m := _DAY.fullmatch(s):
            return date(int(m[1]), int(m[2]), int(m[3])), "day"
    except ValueError as exc:
        raise ValueError(f"invalid ClinicalTrials.gov date: {s!r}") from exc
    raise ValueError(f"invalid ClinicalTrials.gov date: {s!r}")
