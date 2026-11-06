"""Read the drug to mechanism mapping CSVs."""

from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, cast

Status = Literal["mapped", "unmapped", "not_a_drug", "manual"]
STATUSES = ("mapped", "unmapped", "not_a_drug", "manual")
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


def _multi(cell: str) -> tuple[str, ...]:
    return tuple(p.strip() for p in cell.split(";") if p.strip())


def _read(path: Path) -> list[DrugMapping]:
    with path.open(newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        missing = [c for c in DRUG_COLUMNS if c not in (reader.fieldnames or [])]
        if missing:
            raise ValueError(f"{path.name}: missing columns {missing}")
        rows = []
        for row in reader:
            status = row["status"].strip()
            if status not in STATUSES:
                raise ValueError(f"{path.name}: bad status {status!r} for {row['drug']!r}")
            rows.append(
                DrugMapping(
                    drug=row["drug"],
                    status=cast(Status, status),
                    chembl_id=row["chembl_id"].strip() or None,
                    modality=row["modality"].strip() or None,
                    mechanism_class=_multi(row["mechanism_class"]),
                    mechanism=_multi(row["mechanism"]),
                    action_type=_multi(row["action_type"]),
                    targets=_multi(row["targets"]),
                )
            )
        return rows


def read_mappings(dir: Path) -> dict[str, DrugMapping]:
    out = {m.drug: m for m in _read(dir / "drugs.csv")}
    overrides = dir / "overrides.csv"
    if overrides.exists():
        out.update({m.drug: m for m in _read(overrides)})
    return out
