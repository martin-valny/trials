"""Read and write the drug mapping CSVs in ``config/mechanisms``."""

from __future__ import annotations

import csv
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, get_args

Status = Literal["mapped", "unmapped", "not_a_drug", "manual"]
STATUSES: frozenset[str] = frozenset(get_args(Status))

DRUG_COLUMNS = [
    "drug",
    "status",
    "chembl_id",
    "modality",
    "mechanism_class",
    "mechanism",
    "action_type",
    "targets",
]
_MULTI = ("mechanism_class", "mechanism", "action_type", "targets")
SEP = ";"


@dataclass(frozen=True)
class DrugMapping:
    drug: str
    status: Status
    chembl_id: str | None
    modality: str | None
    mechanism_class: tuple[str, ...]
    mechanism: tuple[str, ...]
    action_type: tuple[str, ...]
    targets: tuple[str, ...]


def _join(values: tuple[str, ...]) -> str:
    return SEP.join(values)


def _split(cell: str | None) -> tuple[str, ...]:
    return tuple(p for v in (cell or "").split(SEP) if (p := v.strip()))


def _row(m: DrugMapping) -> dict[str, str]:
    return {
        "drug": m.drug,
        "status": m.status,
        "chembl_id": m.chembl_id or "",
        "modality": m.modality or "",
        **{k: _join(getattr(m, k)) for k in _MULTI},
    }


def write_drugs(path: Path, rows: Iterable[DrugMapping]) -> None:
    """Write ``rows`` sorted by drug; multi-valued cells are ``;``-joined."""
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=DRUG_COLUMNS, lineterminator="\n")
        w.writeheader()
        for m in sorted(rows, key=lambda r: r.drug):
            w.writerow(_row(m))


def _parse(path: Path, line: int, raw: dict[str | None, Any]) -> DrugMapping:
    if None in raw:
        raise ValueError(f"{path.name} line {line}: more cells than columns")
    if any(raw.get(c) is None for c in DRUG_COLUMNS):
        raise ValueError(f"{path.name} line {line}: fewer cells than columns")
    drug = (raw.get("drug") or "").strip()
    if not drug:
        raise ValueError(f"{path.name} line {line}: empty drug")
    status = (raw.get("status") or "").strip()
    if status not in STATUSES:
        raise ValueError(f"{path.name} line {line}: bad status {status!r}")
    return DrugMapping(
        drug=drug,
        status=status,  # type: ignore[arg-type]  # checked against STATUSES above
        chembl_id=(raw.get("chembl_id") or "").strip() or None,
        modality=(raw.get("modality") or "").strip() or None,
        mechanism_class=_split(raw.get("mechanism_class")),
        mechanism=_split(raw.get("mechanism")),
        action_type=_split(raw.get("action_type")),
        targets=_split(raw.get("targets")),
    )


def _read(path: Path) -> dict[str, DrugMapping]:
    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        missing = [c for c in DRUG_COLUMNS if c not in (reader.fieldnames or [])]
        if missing:
            raise ValueError(f"{path.name}: missing column(s) {', '.join(missing)}")
        out: dict[str, DrugMapping] = {}
        for i, raw in enumerate(reader, start=2):
            m = _parse(path, i, raw)
            out[m.drug] = m
        return out


def read_mappings(dir: Path) -> dict[str, DrugMapping]:
    """``drugs.csv`` with ``overrides.csv`` (optional) replacing whole rows, keyed by drug.

    Raises ``OSError`` if ``drugs.csv`` is missing and ``ValueError`` on missing columns
    or a bad status.
    """
    mappings = _read(dir / "drugs.csv")
    overrides = dir / "overrides.csv"
    if overrides.is_file():
        mappings.update(_read(overrides))
    return dict(sorted(mappings.items()))


def read_target_labels(path: Path) -> dict[str, str]:
    """``key,label`` rows; the key is a ChEMBL target id, a gene symbol or ``;``-joined genes."""
    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        if not {"key", "label"} <= set(reader.fieldnames or []):
            raise ValueError(f"{path.name}: needs columns key,label")
        return {
            k: v
            for raw in reader
            if (k := (raw.get("key") or "").strip()) and (v := (raw.get("label") or "").strip())
        }
