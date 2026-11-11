"""Read and validate the Pipeline figure's hand-kept config.

``config/pipeline/{rows,unrowed,background}.csv``, ``config/sponsors/parents.csv`` and
``config/stop_reasons.csv``. A bad row raises ``ValueError("<file>:<line>: <problem>")``; a
missing file raises ``FileNotFoundError``. The stage turns both into one R19 warning.
"""

from __future__ import annotations

import csv
import re
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, cast, get_args

from trialradar.mechanisms.io import split_cell

SponsorKind = Literal["industry", "academic", "government", "other"]

REASON_GROUPS: tuple[str, ...] = (
    "Business or strategy",
    "Slow enrolment",
    "Safety",
    "Efficacy or futility",
    "Funding",
    "COVID-19",
    "Sponsor or investigator decision",
    "Other",
    "Not given",
)

ROW_COLUMNS = (
    "row_id",
    "label",
    "sub",
    "family",
    "family_order",
    "row_order",
    "classes",
    "drugs",
    "gene",
    "blurb",
    "related",
)
_ROW_ID = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
_TRAILING_PUNCT = " \t\r\n.,;:"


@dataclass(frozen=True)
class Family:
    id: str
    label: str
    order: int


@dataclass(frozen=True)
class FigureRow:
    id: str
    label: str
    sub: str
    family: str  # Family.id
    order: int
    classes: tuple[str, ...]
    drugs: tuple[str, ...]
    gene: str | None
    blurb: str
    related: tuple[str, ...]


@dataclass(frozen=True)
class Parent:
    parent: str
    kind: SponsorKind


@dataclass(frozen=True)
class ReasonRule:
    pattern: re.Pattern[str]
    group: str


@dataclass(frozen=True)
class FigureConfig:
    families: tuple[Family, ...]
    rows: tuple[FigureRow, ...]
    unrowed: Mapping[str, str]
    background: frozenset[str]
    parents: Mapping[str, Parent]  # key = norm_sponsor(raw)
    reasons: tuple[ReasonRule, ...]


def slugify(label: str) -> str:
    """Lowercase, runs of non-alphanumerics become one ``-``, trimmed."""
    return re.sub(r"[^a-z0-9]+", "-", label.casefold()).strip("-")


def norm_sponsor(raw: str) -> str:
    """Casefold, collapse whitespace, strip trailing punctuation."""
    return " ".join(raw.casefold().split()).rstrip(_TRAILING_PUNCT)


def _rows(path: Path, columns: tuple[str, ...]) -> list[tuple[int, dict[str, str]]]:
    """``(line, row)`` pairs with every cell stripped."""
    if not path.is_file():
        raise FileNotFoundError(f"{path.name}: file not found in {path.parent}")
    try:
        with path.open(newline="", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            missing = [c for c in columns if c not in (reader.fieldnames or [])]
            if missing:
                raise ValueError(f"{path.name}:1: missing column(s) {', '.join(missing)}")
            out: list[tuple[int, dict[str, str]]] = []
            for raw in reader:
                if None in raw:
                    raise ValueError(f"{path.name}:{reader.line_num}: more cells than columns")
                if any(raw.get(c) is None for c in columns):
                    raise ValueError(f"{path.name}:{reader.line_num}: fewer cells than columns")
                out.append((reader.line_num, {c: (raw[c] or "").strip() for c in columns}))
            return out
    except csv.Error as exc:
        raise ValueError(f"{path.name}:1: {exc}") from exc
    except OSError as exc:
        raise ValueError(f"{path.name}:1: {exc}") from exc


def _int(name: str, line: int, row: dict[str, str], col: str) -> int:
    try:
        return int(row[col])
    except ValueError:
        raise ValueError(f"{name}:{line}: {col} must be a whole number, got {row[col]!r}") from None


def _read_rows(path: Path) -> tuple[tuple[Family, ...], tuple[FigureRow, ...]]:
    name = path.name
    parsed: list[tuple[int, FigureRow, int]] = []  # (line, row, family_order)
    seen_ids: dict[str, int] = {}
    owner: dict[str, str] = {}  # class or drug -> row id
    family_orders: dict[str, int] = {}
    for line, r in _rows(path, ROW_COLUMNS):
        rid = r["row_id"]
        if not _ROW_ID.match(rid):
            raise ValueError(f"{name}:{line}: row_id {rid!r} is not a lowercase slug")
        if rid in seen_ids:
            raise ValueError(
                f"{name}:{line}: duplicate row_id {rid!r} (first on line {seen_ids[rid]})"
            )
        seen_ids[rid] = line
        for col in ("label", "family", "blurb"):
            if not r[col]:
                raise ValueError(f"{name}:{line}: {rid}: empty {col}")
        forder = _int(name, line, r, "family_order")
        if family_orders.setdefault(r["family"], forder) != forder:
            raise ValueError(
                f"{name}:{line}: {rid}: family {r['family']!r} has two family_order values"
            )
        classes, drugs = split_cell(r["classes"]), split_cell(r["drugs"])
        if not classes and not drugs:
            raise ValueError(f"{name}:{line}: {rid}: needs a class or a drug")
        for kind, items in (("class", classes), ("drug", drugs)):
            for item in items:
                key = f"{kind}:{item}"
                if key in owner:
                    raise ValueError(
                        f"{name}:{line}: {kind} {item!r} is in two rows ({owner[key]}, {rid})"
                    )
                owner[key] = rid
        row = FigureRow(
            id=rid,
            label=r["label"],
            sub=r["sub"],
            family=slugify(r["family"]),
            order=_int(name, line, r, "row_order"),
            classes=classes,
            drugs=drugs,
            gene=r["gene"] or None,
            blurb=r["blurb"],
            related=split_cell(r["related"]),
        )
        parsed.append((line, row, forder))
    for line, row, _ in parsed:
        for rel in row.related:
            if rel not in seen_ids:
                raise ValueError(f"{name}:{line}: {row.id}: related {rel!r} is not a row_id")
    families = tuple(
        Family(id=slugify(label), label=label, order=order)
        for label, order in sorted(family_orders.items(), key=lambda kv: (kv[1], kv[0]))
    )
    rows = tuple(row for _, row, _ in sorted(parsed, key=lambda p: (p[2], p[1].order, p[0])))
    return families, rows


def _read_unrowed(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for line, r in _rows(path, ("class", "reason")):
        if not r["class"] or not r["reason"]:
            raise ValueError(f"{path.name}:{line}: class and reason are both required")
        if r["class"] in out:
            raise ValueError(f"{path.name}:{line}: duplicate class {r['class']!r}")
        out[r["class"]] = r["reason"]
    return out


def _read_background(path: Path) -> frozenset[str]:
    out: set[str] = set()
    for line, r in _rows(path, ("drug", "reason")):
        if not r["drug"] or not r["reason"]:
            raise ValueError(f"{path.name}:{line}: drug and reason are both required")
        out.add(r["drug"].casefold())
    return frozenset(out)


def _read_parents(path: Path) -> dict[str, Parent]:
    out: dict[str, Parent] = {}
    kinds = get_args(SponsorKind)
    for line, r in _rows(path, ("sponsor", "parent", "kind")):
        if not r["sponsor"] or not r["parent"]:
            raise ValueError(f"{path.name}:{line}: sponsor and parent are both required")
        if r["kind"] not in kinds:
            raise ValueError(
                f"{path.name}:{line}: kind {r['kind']!r} is not one of {', '.join(kinds)}"
            )
        key = norm_sponsor(r["sponsor"])
        if key in out:
            raise ValueError(f"{path.name}:{line}: duplicate sponsor {r['sponsor']!r}")
        out[key] = Parent(parent=r["parent"], kind=cast(SponsorKind, r["kind"]))
    return out


def _read_reasons(path: Path) -> tuple[ReasonRule, ...]:
    out: list[ReasonRule] = []
    allowed = tuple(g for g in REASON_GROUPS if g != "Not given")
    for line, r in _rows(path, ("pattern", "group")):
        if r["group"] not in allowed:
            raise ValueError(
                f"{path.name}:{line}: group {r['group']!r} is not one of {', '.join(allowed)}"
            )
        try:
            pattern = re.compile(r["pattern"], re.IGNORECASE)
        except re.error as exc:
            raise ValueError(f"{path.name}:{line}: bad regex {r['pattern']!r}: {exc}") from exc
        out.append(ReasonRule(pattern=pattern, group=r["group"]))
    return tuple(out)


def read_figure_config(pipeline_dir: Path, sponsors_dir: Path, stop_reasons: Path) -> FigureConfig:
    families, rows = _read_rows(pipeline_dir / "rows.csv")
    return FigureConfig(
        families=families,
        rows=rows,
        unrowed=_read_unrowed(pipeline_dir / "unrowed.csv"),
        background=_read_background(pipeline_dir / "background.csv"),
        parents=_read_parents(sponsors_dir / "parents.csv"),
        reasons=_read_reasons(stop_reasons),
    )
