"""Read and validate ``config/approaches/{kinds.csv,nondrug_rules.csv}``."""

from __future__ import annotations

import csv
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

from trialradar.mechanisms.io import split_cell

APPROACHES: tuple[str, ...] = (
    "targeted",
    "cell",
    "plasma",
    "tolerisation",
    "diffuse",
    "nondrug",
    "unclassified",
)
APPROACH_LABELS: dict[str, str] = {
    "targeted": "Targeted drugs",
    "cell": "Cell & transplant",
    "plasma": "Antibody & plasma",
    "tolerisation": "Tolerisation",
    "diffuse": "Broad immunomodulators",
    "nondrug": "Non-drug care",
    "unclassified": "Unclassified",
}

NOT_YET_SORTED = "Not yet sorted"
NOT_A_TREATMENT = "Not a treatment"
UNCLASSIFIED_GROUPS: frozenset[str] = frozenset({NOT_YET_SORTED, NOT_A_TREATMENT})

TYPE_PREFIX = "type:"
NOT_A_TREATMENT_KIND = "not_a_treatment"
# ClinicalTrials.gov intervention types that need a fallback kind.
FALLBACK_TYPES: tuple[str, ...] = (
    "BEHAVIORAL",
    "DEVICE",
    "PROCEDURE",
    "RADIATION",
    "DIETARY_SUPPLEMENT",
    "DIAGNOSTIC_TEST",
    "OTHER",
    "GENETIC",
    "COMBINATION_PRODUCT",
    "DRUG",
    "BIOLOGICAL",
)
REQUIRED_KINDS: frozenset[str] = frozenset(
    {f"{TYPE_PREFIX}{t}" for t in FALLBACK_TYPES} | {NOT_A_TREATMENT_KIND}
)

KIND_COLUMNS = ("kind", "approach", "group", "label", "rationale", "source_url")
RULE_COLUMNS = ("pattern", "types", "kind")


@dataclass(frozen=True)
class Kind:
    key: str
    approach: str
    group: str
    label: str
    rationale: str
    source_url: str


@dataclass(frozen=True)
class Rule:
    pattern: str  # casefolded whole-word phrase
    types: frozenset[str]  # empty: any intervention type
    kind: str


@dataclass(frozen=True)
class ApproachConfig:
    kinds: dict[str, Kind]
    rules: tuple[Rule, ...]


def _rows(path: Path, columns: tuple[str, ...]) -> list[tuple[int, dict[str, str]]]:
    """``(line, row)`` pairs with every cell stripped; ``ValueError`` names the file."""
    if not path.is_file():
        raise ValueError(f"{path.name}: file not found in {path.parent}")
    try:
        with path.open(newline="", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            missing = [c for c in columns if c not in (reader.fieldnames or [])]
            if missing:
                raise ValueError(f"{path.name}: missing column(s) {', '.join(missing)}")
            out: list[tuple[int, dict[str, str]]] = []
            for raw in reader:
                if None in raw:
                    raise ValueError(f"{path.name} line {reader.line_num}: more cells than columns")
                if any(raw.get(c) is None for c in columns):
                    raise ValueError(
                        f"{path.name} line {reader.line_num}: fewer cells than columns"
                    )
                out.append((reader.line_num, {c: (raw[c] or "").strip() for c in columns}))
            return out
    except csv.Error as exc:
        raise ValueError(f"{path.name}: {exc}") from exc
    except OSError as exc:
        raise ValueError(f"{path.name}: {exc}") from exc


def _kind(name: str, line: int, row: dict[str, str]) -> Kind:
    where = f"{name} line {line}"
    key = row["kind"]
    for col in ("kind", "approach", "group", "label"):
        if not row[col]:
            raise ValueError(f"{where}: empty {col}")
    approach = row["approach"]
    if approach not in APPROACHES:
        raise ValueError(f"{where}: {key}: unknown approach {approach!r}")
    if approach == "targeted":
        raise ValueError(f"{where}: {key}: a kind cannot be in 'targeted' (molecular classes are)")
    if approach == "unclassified" and row["group"] not in UNCLASSIFIED_GROUPS:
        raise ValueError(
            f"{where}: {key}: unclassified group must be {NOT_YET_SORTED!r} or "
            f"{NOT_A_TREATMENT!r}, not {row['group']!r}"
        )
    if key.startswith(TYPE_PREFIX) and approach not in ("nondrug", "unclassified"):
        raise ValueError(f"{where}: {key}: a type fallback must be nondrug or unclassified")
    needs_source = not key.startswith(TYPE_PREFIX) and key != NOT_A_TREATMENT_KIND
    if needs_source and not row["source_url"]:
        raise ValueError(f"{where}: {key}: source_url is required")
    return Kind(
        key=key,
        approach=approach,
        group=row["group"],
        label=row["label"],
        rationale=row["rationale"],
        source_url=row["source_url"],
    )


def _read_kinds(path: Path) -> dict[str, Kind]:
    kinds: dict[str, Kind] = {}
    for line, row in _rows(path, KIND_COLUMNS):
        k = _kind(path.name, line, row)
        if k.key in kinds:
            raise ValueError(f"{path.name} line {line}: duplicate kind {k.key!r}")
        kinds[k.key] = k
    missing = sorted(REQUIRED_KINDS - kinds.keys())
    if missing:
        raise ValueError(f"{path.name}: missing required kind(s) {', '.join(missing)}")
    return kinds


def _read_rules(path: Path, kinds: dict[str, Kind]) -> tuple[Rule, ...]:
    rules: list[Rule] = []
    for line, row in _rows(path, RULE_COLUMNS):
        where = f"{path.name} line {line}"
        pattern = " ".join(row["pattern"].casefold().split())
        if not pattern:
            raise ValueError(f"{where}: empty pattern")
        if row["kind"] not in kinds:
            raise ValueError(f"{where}: unknown kind {row['kind']!r} (not in kinds.csv)")
        types = frozenset(t.upper() for t in split_cell(row["types"]))
        rules.append(Rule(pattern=pattern, types=types, kind=row["kind"]))
    return tuple(rules)


def read_approaches(dir: Path) -> ApproachConfig:
    """``kinds.csv`` and ``nondrug_rules.csv`` from ``dir``.

    Raises ``ValueError`` (naming the file) when a file is missing or unreadable, a column
    is missing, a kind is duplicated or lacks a required cell, an approach is not one of
    :data:`APPROACHES`, a required fallback kind is absent, or a rule names an unknown kind.
    """
    kinds = _read_kinds(dir / "kinds.csv")
    rules = _read_rules(dir / "nondrug_rules.csv", kinds)
    return ApproachConfig(kinds=kinds, rules=rules)


def check_collisions(cfg: ApproachConfig, molecular_classes: Iterable[str]) -> None:
    """``ValueError`` if a kind key is also used as a molecular class (a row with targets)."""
    clash = sorted(set(molecular_classes) & cfg.kinds.keys())
    if clash:
        raise ValueError(
            f"kinds.csv: kind key(s) {', '.join(clash)} also used as a molecular class"
        )
