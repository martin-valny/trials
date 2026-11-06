"""drugs.csv / overrides.csv reading and writing."""

from __future__ import annotations

import csv
from pathlib import Path

import pytest

from trialradar.mechanisms.io import (
    DRUG_COLUMNS,
    DrugMapping,
    read_mappings,
    read_target_labels,
    write_drugs,
)

FTY = DrugMapping(
    drug="fingolimod",
    status="mapped",
    chembl_id="CHEMBL314854",
    modality="small molecule",
    mechanism_class=("S1P receptor modulator",),
    mechanism=(
        "Sphingosine 1-phosphate receptor agonist",
        "Sphingosine 1-phosphate receptor binding agent",
    ),
    action_type=("AGONIST", "BINDING AGENT"),
    targets=("S1PR1", "S1PR2", "S1PR3", "S1PR4", "S1PR5"),
)
UNKNOWN = DrugMapping(
    drug="mystery",
    status="unmapped",
    chembl_id=None,
    modality=None,
    mechanism_class=(),
    mechanism=(),
    action_type=(),
    targets=(),
)


def _write_overrides(path: Path, rows: list[dict[str, str]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=DRUG_COLUMNS)
        w.writeheader()
        w.writerows(rows)


def test_round_trip_splits_multi_valued_cells(tmp_path: Path) -> None:
    write_drugs(tmp_path / "drugs.csv", [UNKNOWN, FTY])
    text = (tmp_path / "drugs.csv").read_text(encoding="utf-8")
    assert text.splitlines()[0] == ",".join(DRUG_COLUMNS)
    assert "S1PR1;S1PR2;S1PR3;S1PR4;S1PR5" in text
    assert read_mappings(tmp_path) == {"fingolimod": FTY, "mystery": UNKNOWN}


def test_write_sorts_by_drug(tmp_path: Path) -> None:
    write_drugs(tmp_path / "drugs.csv", [UNKNOWN, FTY])
    lines = (tmp_path / "drugs.csv").read_text(encoding="utf-8").splitlines()
    assert [ln.split(",")[0] for ln in lines[1:]] == ["fingolimod", "mystery"]


def test_override_replaces_the_row_entirely(tmp_path: Path) -> None:
    write_drugs(tmp_path / "drugs.csv", [FTY, UNKNOWN])
    _write_overrides(
        tmp_path / "overrides.csv",
        [
            {
                "drug": "mystery",
                "status": "manual",
                "chembl_id": "",
                "modality": "antibody",
                "mechanism_class": "anti-CD20",
                "mechanism": "",
                "action_type": "",
                "targets": "MS4A1",
            },
            {"drug": "vitamin d", "status": "not_a_drug", **dict.fromkeys(DRUG_COLUMNS[2:], "")},
        ],
    )
    got = read_mappings(tmp_path)
    assert got["mystery"] == DrugMapping(
        drug="mystery",
        status="manual",
        chembl_id=None,
        modality="antibody",
        mechanism_class=("anti-CD20",),
        mechanism=(),
        action_type=(),
        targets=("MS4A1",),
    )
    assert got["vitamin d"].status == "not_a_drug"
    assert got["fingolimod"] == FTY


def test_header_only_or_missing_overrides_is_fine(tmp_path: Path) -> None:
    write_drugs(tmp_path / "drugs.csv", [FTY])
    assert read_mappings(tmp_path) == {"fingolimod": FTY}
    _write_overrides(tmp_path / "overrides.csv", [])
    assert read_mappings(tmp_path) == {"fingolimod": FTY}


def test_bad_status_raises(tmp_path: Path) -> None:
    write_drugs(tmp_path / "drugs.csv", [FTY])
    _write_overrides(
        tmp_path / "overrides.csv",
        [{"drug": "x", "status": "maybe", **dict.fromkeys(DRUG_COLUMNS[2:], "")}],
    )
    with pytest.raises(ValueError, match="status"):
        read_mappings(tmp_path)


def test_missing_columns_raise(tmp_path: Path) -> None:
    (tmp_path / "drugs.csv").write_text("drug,status\nfingolimod,mapped\n", encoding="utf-8")
    with pytest.raises(ValueError, match="column"):
        read_mappings(tmp_path)


@pytest.mark.parametrize(
    "row",
    [
        "fingolimod,mapped",  # short row: DictReader yields None cells
        "fingolimod,mapped,CHEMBL1,small molecule,a,b,c,d,extra",  # long row
        ",mapped,,,,,,",  # no drug
    ],
)
def test_malformed_rows_raise_value_error(tmp_path: Path, row: str) -> None:
    (tmp_path / "drugs.csv").write_text(
        ",".join(DRUG_COLUMNS) + "\n" + row + "\n", encoding="utf-8"
    )
    with pytest.raises(ValueError, match="line 2"):
        read_mappings(tmp_path)


def test_missing_drugs_csv_raises_oserror(tmp_path: Path) -> None:
    with pytest.raises(OSError):
        read_mappings(tmp_path / "nope")


def test_read_target_labels(tmp_path: Path) -> None:
    p = tmp_path / "target_labels.csv"
    p.write_text("key,label\nMS4A1,CD20\nS1PR1;S1PR5,S1P receptor\n", encoding="utf-8")
    assert read_target_labels(p) == {"MS4A1": "CD20", "S1PR1;S1PR5": "S1P receptor"}
    p.write_text("gene,name\nA,B\n", encoding="utf-8")
    with pytest.raises(ValueError, match="column"):
        read_target_labels(p)


def test_csv_error_becomes_value_error(tmp_path: Path) -> None:
    huge = "x" * (csv.field_size_limit() + 10)  # trips the csv module's field-size check
    (tmp_path / "drugs.csv").write_text(
        ",".join(DRUG_COLUMNS) + f"\nfingolimod,mapped,{huge},,,,,\n", encoding="utf-8"
    )
    with pytest.raises(ValueError, match="drugs.csv"):
        read_mappings(tmp_path)


def test_bom_is_tolerated(tmp_path: Path) -> None:
    write_drugs(tmp_path / "drugs.csv", [FTY])
    text = (tmp_path / "drugs.csv").read_text(encoding="utf-8")
    (tmp_path / "drugs.csv").write_text("﻿" + text, encoding="utf-8")
    assert read_mappings(tmp_path) == {"fingolimod": FTY}


def test_drug_keys_are_casefolded_so_overrides_match(tmp_path: Path) -> None:
    vit = DrugMapping("vitamin d", "unmapped", None, None, (), (), (), ())
    write_drugs(tmp_path / "drugs.csv", [FTY, vit])
    _write_overrides(
        tmp_path / "overrides.csv",
        [{"drug": "Vitamin D", "status": "not_a_drug", **dict.fromkeys(DRUG_COLUMNS[2:], "")}],
    )
    got = read_mappings(tmp_path)
    assert list(got) == ["fingolimod", "vitamin d"]
    assert got["vitamin d"].status == "not_a_drug"


def test_duplicate_drug_rows_raise(tmp_path: Path) -> None:
    write_drugs(tmp_path / "drugs.csv", [FTY])
    _write_overrides(
        tmp_path / "overrides.csv",
        [
            {"drug": "x", "status": "not_a_drug", **dict.fromkeys(DRUG_COLUMNS[2:], "")},
            {"drug": "X", "status": "not_a_drug", **dict.fromkeys(DRUG_COLUMNS[2:], "")},
        ],
    )
    with pytest.raises(ValueError, match="duplicate"):
        read_mappings(tmp_path)
