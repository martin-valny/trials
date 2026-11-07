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
SEP = ";"
# The closed set of modality values; a drug with several modalities lists them ``;``-joined.
MODALITIES: frozenset[str] = frozenset(
    {
        "small molecule",
        "antibody",
        "protein",
        "oligonucleotide",
        "cell therapy",
        "gene therapy",
        "other",
    }
)


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


def split_cell(cell: str | None) -> tuple[str, ...]:
    """A ``;``-joined cell as its stripped, non-empty parts."""
    return tuple(p for v in (cell or "").split(SEP) if (p := v.strip()))


_split = split_cell


_TEXT = ("mechanism", "action_type")  # display text: ';' becomes ','
_KEYS = ("mechanism_class", "targets")  # identifiers: ';' is an error


def _row(m: DrugMapping) -> dict[str, str]:
    """One CSV row. Multi-valued cells are ``;``-joined, so no single value may hold ``;``."""
    for k in _KEYS:
        bad = [v for v in getattr(m, k) if SEP in v]
        if bad:
            raise ValueError(f"{m.drug}: {k} value {bad[0]!r} contains {SEP!r}")
    return {
        "drug": m.drug,
        "status": m.status,
        "chembl_id": m.chembl_id or "",
        "modality": m.modality or "",
        **{k: _join(getattr(m, k)) for k in _KEYS},
        **{k: _join(tuple(v.replace(SEP, ",") for v in getattr(m, k))) for k in _TEXT},
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
    drug = (raw.get("drug") or "").strip().casefold()
    if not drug:
        raise ValueError(f"{path.name} line {line}: empty drug")
    status = (raw.get("status") or "").strip()
    if status not in STATUSES:
        raise ValueError(f"{path.name} line {line}: bad status {status!r}")
    modalities = _split(raw.get("modality"))
    bad = [m for m in modalities if m not in MODALITIES]
    if bad:
        raise ValueError(f"{path.name} line {line}: unknown modality {bad[0]!r}")
    return DrugMapping(
        drug=drug,
        status=status,  # type: ignore[arg-type]  # checked against STATUSES above
        chembl_id=(raw.get("chembl_id") or "").strip() or None,
        modality=SEP.join(modalities) or None,
        mechanism_class=_split(raw.get("mechanism_class")),
        mechanism=_split(raw.get("mechanism")),
        action_type=_split(raw.get("action_type")),
        targets=_split(raw.get("targets")),
    )


def _read(path: Path) -> dict[str, DrugMapping]:
    with path.open(newline="", encoding="utf-8-sig") as f:
        try:
            reader = csv.DictReader(f)
            missing = [c for c in DRUG_COLUMNS if c not in (reader.fieldnames or [])]
            if missing:
                raise ValueError(f"{path.name}: missing column(s) {', '.join(missing)}")
            out: dict[str, DrugMapping] = {}
            for raw in reader:
                line = reader.line_num
                m = _parse(path, line, raw)
                if m.drug in out:
                    raise ValueError(f"{path.name} line {line}: duplicate drug {m.drug!r}")
                out[m.drug] = m
            return out
        except csv.Error as exc:
            raise ValueError(f"{path.name}: {exc}") from exc


def read_drugs(path: Path) -> dict[str, DrugMapping]:
    """One mapping CSV (``drugs.csv`` or ``overrides.csv``) keyed by casefolded drug name."""
    return _read(path)


def read_mappings(dir: Path) -> dict[str, DrugMapping]:
    """``drugs.csv`` with ``overrides.csv`` (optional) replacing whole rows, keyed by the
    lower-cased (casefolded) drug name.

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
    with path.open(newline="", encoding="utf-8-sig") as f:
        try:
            reader = csv.DictReader(f)
            if not {"key", "label"} <= set(reader.fieldnames or []):
                raise ValueError(f"{path.name}: needs columns key,label")
            return {
                k: v
                for raw in reader
                if (k := (raw.get("key") or "").strip()) and (v := (raw.get("label") or "").strip())
            }
        except csv.Error as exc:
            raise ValueError(f"{path.name}: {exc}") from exc
