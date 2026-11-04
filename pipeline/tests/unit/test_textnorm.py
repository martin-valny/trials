from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest

from trialradar.textnorm import apply_alias, load_aliases, norm_key, norm_text, parse_ct_date


def test_norm_text_collapses_and_nfkc() -> None:
    assert norm_text("  Expanded Disability   Status ") == "Expanded Disability Status"
    assert norm_text("a b c") == "a b c"
    assert norm_text("ＡＢ") == "AB"  # fullwidth -> NFKC


def test_norm_text_none_and_empty() -> None:
    assert norm_text(None) is None
    assert norm_text("") is None
    assert norm_text("    ") is None


def test_norm_key_casefolds() -> None:
    assert norm_key("  Straße  X ") == "strasse x"


def test_parse_ct_date_month_and_day() -> None:
    assert parse_ct_date("2023-05") == (date(2023, 5, 1), "month")
    assert parse_ct_date("2023-05-14") == (date(2023, 5, 14), "day")
    assert parse_ct_date(None) == (None, None)


@pytest.mark.parametrize("bad", ["", "2023", "05/14/2023", "2023-13", "2023-02-30", "x"])
def test_parse_ct_date_rejects_garbage(bad: str) -> None:
    with pytest.raises(ValueError):
        parse_ct_date(bad)


def test_alias_case_insensitive(tmp_path: Path) -> None:
    p = tmp_path / "a.csv"
    p.write_text("raw,normalized\nRoche  Ltd,Roche\nHoffmann-La Roche,Roche\n")
    aliases = load_aliases(p)
    assert apply_alias("ROCHE  ltd ", aliases) == "Roche"
    assert apply_alias("hoffmann-la roche", aliases) == "Roche"
    assert apply_alias("  Other   Co ", aliases) == "Other Co"


def test_load_aliases_header_only_and_missing(tmp_path: Path) -> None:
    p = tmp_path / "h.csv"
    p.write_text("raw,normalized\n")
    assert load_aliases(p) == {}
    assert load_aliases(tmp_path / "missing.csv") == {}


def test_load_aliases_with_bom(tmp_path: Path) -> None:
    p = tmp_path / "bom.csv"
    p.write_bytes("raw,normalized\nRoche  Ltd,Roche\n".encode("utf-8-sig"))
    assert apply_alias("roche ltd", load_aliases(p)) == "Roche"


@pytest.mark.parametrize("s", ["2023-05\n", "2023-05-01\n"])
def test_parse_ct_date_rejects_trailing_newline(s: str) -> None:
    with pytest.raises(ValueError):
        parse_ct_date(s)
