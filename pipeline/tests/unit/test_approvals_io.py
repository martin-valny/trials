from __future__ import annotations

from pathlib import Path

import pytest

from trialradar.approvals.io import (
    COLUMNS,
    OVERRIDE_COLUMNS,
    Approval,
    ApprovalsError,
    read_approvals,
    read_overrides,
    write_approvals,
)

HEADER = ",".join(COLUMNS)
OVR_HEADER = ",".join(OVERRIDE_COLUMNS)


def _ap(row_id: str, disease: str, drug: str, **kw: object) -> Approval:
    base: dict[str, object] = {
        "row_id": row_id,
        "disease": disease,
        "drug": drug,
        "chembl_id": "",
        "sources": ("chembl",),
        "withdrawn": False,
        "regulator": "",
        "year": None,
        "url": "https://example.org/x",
    }
    return Approval(**{**base, **kw})  # type: ignore[arg-type]


def test_roundtrip(tmp_path: Path) -> None:
    items = [
        _ap("r2", "D1", "Zeta"),
        _ap("r1", "D2", "beta", sources=("hand", "chembl"), regulator="X", year=2022),
        _ap("r1", "D1", "Alpha", chembl_id="CHEMBL1", withdrawn=True),
        _ap("r1", "D1", "alpha2", sources=("fda_label", "chembl")),
    ]
    p = tmp_path / "approvals.csv"
    write_approvals(p, items)
    lines = p.read_text(encoding="utf-8").splitlines()
    assert lines[0] == HEADER
    assert [ln.split(",")[:3] for ln in lines[1:]] == [
        ["r1", "D1", "Alpha"],
        ["r1", "D1", "alpha2"],
        ["r1", "D2", "beta"],
        ["r2", "D1", "Zeta"],
    ]
    assert lines[1].split(",")[5] == "1"
    assert lines[2].split(",")[4] == "chembl;fda_label"
    assert lines[3].split(",")[4] == "chembl;hand"
    assert lines[3].split(",")[7] == "2022"
    assert lines[4].split(",")[5:8] == ["", "", ""]
    assert "\r" not in p.read_text(encoding="utf-8")
    back = read_approvals(p)
    expected = [
        _ap("r1", "D1", "Alpha", chembl_id="CHEMBL1", withdrawn=True),
        _ap("r1", "D1", "alpha2", sources=("chembl", "fda_label")),
        _ap("r1", "D2", "beta", sources=("chembl", "hand"), regulator="X", year=2022),
        _ap("r2", "D1", "Zeta"),
    ]
    assert back == expected


def test_read_missing_raises(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        read_approvals(tmp_path / "nope.csv")


GOOD = "r1,D1,drugA,,chembl,,,,https://e.org"


@pytest.mark.parametrize(
    ("text", "line"),
    [
        ("row_id,disease,drug\n", 1),
        ("", 1),
        (f"{HEADER}\n{GOOD}\nr1,D1,drugB,,ema,,,,u\n", 3),
        (f"{HEADER}\nr1,D1,,,chembl,,,,u\n", 2),
        (f"{HEADER}\nr1,D1,drugB,,chembl,,,20x2,u\n", 2),
        (f"{HEADER}\nr1,D1,drugB,,chembl,yes,,,u\n", 2),
        (f"{HEADER}\n{GOOD}\nr1,D1,DRUGA,,hand,,,,u\n", 3),
        (f"{HEADER}\nr1,D1,drugB,,,,,,u\n", 2),
        (f"{HEADER}\nr1,D1,drugB\n", 2),
    ],
)
def test_read_rejects(tmp_path: Path, text: str, line: int) -> None:
    p = tmp_path / "approvals.csv"
    p.write_text(text, encoding="utf-8")
    with pytest.raises(ApprovalsError) as ei:
        read_approvals(p)
    assert str(ei.value).startswith(f"{p}:{line}:")


def _ovr(tmp_path: Path, *rows: str, header: str = OVR_HEADER) -> Path:
    p = tmp_path / "overrides.csv"
    p.write_text("\n".join([header, *rows]) + "\n", encoding="utf-8")
    return p


def test_overrides_read(tmp_path: Path) -> None:
    p = _ovr(
        tmp_path,
        "add,r1,D1,zilucoplan,FDA,2023,,https://e.org,verified",
        "exclude,r1,D1,foo,,,,,not approved",
        "add,r1,D1,bar,,,1,https://e.org,",
    )
    got = read_overrides(p)
    assert [o.action for o in got] == ["add", "exclude", "add"]
    assert got[0].year == 2023 and got[0].regulator == "FDA" and not got[0].withdrawn
    assert got[1].year is None and got[1].source_url == ""
    assert got[2].withdrawn is True


def test_overrides_add_requires_source_url(tmp_path: Path) -> None:
    p = _ovr(tmp_path, "add,r1,D1,drug,FDA,2023,,,")
    with pytest.raises(ApprovalsError) as ei:
        read_overrides(p)
    assert str(ei.value).startswith(f"{p}:2:")


def test_overrides_unknown_action(tmp_path: Path) -> None:
    p = _ovr(tmp_path, "remove,r1,D1,drug,,,,u,")
    with pytest.raises(ApprovalsError) as ei:
        read_overrides(p)
    assert str(ei.value).startswith(f"{p}:2:")


def test_overrides_bad_header_and_values(tmp_path: Path) -> None:
    with pytest.raises(ApprovalsError, match=r":1:"):
        read_overrides(_ovr(tmp_path, header="action,row_id"))
    for row in ("add,r1,D1,,,,,u,", "add,r1,D1,d,,x,,u,", "add,r1,D1,d,,,yes,u,"):
        with pytest.raises(ApprovalsError, match=r":2:"):
            read_overrides(_ovr(tmp_path, row))


def test_overrides_missing_file_is_empty(tmp_path: Path) -> None:
    assert read_overrides(tmp_path / "overrides.csv") == []
