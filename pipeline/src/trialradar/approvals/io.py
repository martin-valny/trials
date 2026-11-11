"""Read and write ``approvals.csv`` and ``overrides.csv`` in ``config/approvals``."""

from __future__ import annotations

import csv
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

COLUMNS = (
    "row_id",
    "disease",
    "drug",
    "chembl_id",
    "sources",
    "withdrawn",
    "regulator",
    "year",
    "url",
)
OVERRIDE_COLUMNS = (
    "action",
    "row_id",
    "disease",
    "drug",
    "regulator",
    "year",
    "withdrawn",
    "source_url",
    "note",
)
SOURCES = ("chembl", "fda_label", "hand")
SEP = ";"
ACTIONS = ("add", "exclude")


class ApprovalsError(ValueError):
    """A malformed approvals file; the message is ``<file>:<line>: <problem>`` (header = line 1)."""


@dataclass(frozen=True)
class Approval:
    row_id: str
    disease: str
    drug: str
    chembl_id: str
    sources: tuple[str, ...]
    withdrawn: bool
    regulator: str
    year: int | None
    url: str


@dataclass(frozen=True)
class Override:
    action: Literal["add", "exclude"]
    row_id: str
    disease: str
    drug: str
    regulator: str
    year: int | None
    withdrawn: bool
    source_url: str
    note: str


def _cell(raw: dict[str | None, Any], col: str) -> str:
    return (raw.get(col) or "").strip()


def _year(path: Path, line: int, text: str) -> int | None:
    if not text:
        return None
    try:
        return int(text)
    except ValueError:
        raise ApprovalsError(f"{path}:{line}: year {text!r} is not an integer") from None


def _withdrawn(path: Path, line: int, text: str) -> bool:
    if text not in ("", "1"):
        raise ApprovalsError(f"{path}:{line}: withdrawn must be blank or 1, not {text!r}")
    return text == "1"


def _rows(path: Path, columns: tuple[str, ...]) -> Iterable[tuple[int, dict[str | None, Any]]]:
    """Data rows with their file line (header = 1), after checking the header is exact."""
    with path.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        if tuple(reader.fieldnames or ()) != columns:
            raise ApprovalsError(f"{path}:1: header must be {','.join(columns)}")
        try:
            for raw in reader:
                line = reader.line_num  # the real file line: blank lines are skipped, not counted
                if None in raw or any(raw.get(c) is None for c in columns):
                    raise ApprovalsError(f"{path}:{line}: wrong number of cells")
                yield line, raw
        except csv.Error as exc:
            raise ApprovalsError(f"{path}:{reader.line_num}: {exc}") from exc


def _approval(path: Path, line: int, raw: dict[str | None, Any]) -> Approval:
    for col in ("row_id", "disease", "drug"):
        if not _cell(raw, col):
            raise ApprovalsError(f"{path}:{line}: empty {col}")
    sources = tuple(s.strip() for s in _cell(raw, "sources").split(SEP) if s.strip())
    if not sources:
        raise ApprovalsError(f"{path}:{line}: empty sources")
    bad = [s for s in sources if s not in SOURCES]
    if bad:
        raise ApprovalsError(f"{path}:{line}: unknown source {bad[0]!r}")
    return Approval(
        row_id=_cell(raw, "row_id"),
        disease=_cell(raw, "disease"),
        drug=_cell(raw, "drug"),
        chembl_id=_cell(raw, "chembl_id"),
        sources=sources,
        withdrawn=_withdrawn(path, line, _cell(raw, "withdrawn")),
        regulator=_cell(raw, "regulator"),
        year=_year(path, line, _cell(raw, "year")),
        url=_cell(raw, "url"),
    )


def read_approvals(path: Path) -> list[Approval]:
    """``approvals.csv`` as written by :func:`write_approvals`.

    Raises ``FileNotFoundError`` if missing and ``ApprovalsError`` on a bad header, a bad
    cell or a duplicate ``(row_id, disease, drug)`` (drug casefolded).
    """
    out: list[Approval] = []
    seen: set[tuple[str, str, str]] = set()
    for line, raw in _rows(path, COLUMNS):
        a = _approval(path, line, raw)
        key = (a.row_id, a.disease, a.drug.casefold())
        if key in seen:
            raise ApprovalsError(f"{path}:{line}: duplicate {a.row_id}/{a.disease}/{a.drug}")
        seen.add(key)
        out.append(a)
    return out


def write_approvals(path: Path, items: Iterable[Approval]) -> None:
    """Write ``items`` sorted by ``(row_id, disease, drug)``; ``sources`` in ``SOURCES`` order.

    Raises ``ValueError`` (before writing) on a source not in ``SOURCES``."""
    rows = sorted(items, key=lambda a: (a.row_id, a.disease, a.drug.casefold()))
    for a in rows:
        unknown = [s for s in a.sources if s not in SOURCES]
        if unknown:
            raise ValueError(f"{a.row_id}/{a.disease}/{a.drug}: unknown source {unknown[0]!r}")
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS, lineterminator="\n")
        w.writeheader()
        for a in rows:
            w.writerow(
                {
                    "row_id": a.row_id,
                    "disease": a.disease,
                    "drug": a.drug,
                    "chembl_id": a.chembl_id,
                    "sources": SEP.join(s for s in SOURCES if s in a.sources),
                    "withdrawn": "1" if a.withdrawn else "",
                    "regulator": a.regulator,
                    "year": "" if a.year is None else a.year,
                    "url": a.url,
                }
            )


def _override(path: Path, line: int, raw: dict[str | None, Any]) -> Override:
    action = _cell(raw, "action")
    if action not in ACTIONS:
        raise ApprovalsError(f"{path}:{line}: unknown action {action!r}")
    for col in ("row_id", "disease", "drug"):
        if not _cell(raw, col):
            raise ApprovalsError(f"{path}:{line}: empty {col}")
    source_url = _cell(raw, "source_url")
    if action == "add" and not source_url:
        raise ApprovalsError(f"{path}:{line}: add needs a source_url")
    return Override(
        action=action,  # type: ignore[arg-type]  # checked against ACTIONS above
        row_id=_cell(raw, "row_id"),
        disease=_cell(raw, "disease"),
        drug=_cell(raw, "drug"),
        regulator=_cell(raw, "regulator"),
        year=_year(path, line, _cell(raw, "year")),
        withdrawn=_withdrawn(path, line, _cell(raw, "withdrawn")),
        source_url=source_url,
        note=_cell(raw, "note"),
    )


def read_overrides(path: Path) -> list[Override]:
    """``overrides.csv`` in file order; a missing file is no overrides."""
    if not path.is_file():
        return []
    return [_override(path, line, raw) for line, raw in _rows(path, OVERRIDE_COLUMNS)]
