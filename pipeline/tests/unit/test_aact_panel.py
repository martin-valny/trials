from __future__ import annotations

from datetime import date
from pathlib import Path

import polars as pl
import pytest

from trialradar.aact.archive import Archive
from trialradar.aact.panel import (
    TABLES,
    fold_archive,
    in_scope_ids,
    monthly_studies,
    panel_scope_ids,
    pick_quarterly,
)


def _arch(i: int, d: str) -> Archive:
    return Archive(i, date.fromisoformat(d), 1)


def test_pick_quarterly_nearest_and_skips_gaps(caplog: pytest.LogCaptureFixture) -> None:
    archs = [
        _arch(1, "2018-12-02"),
        _arch(2, "2019-02-20"),  # 9 days before Mar 1
        _arch(3, "2019-03-15"),  # 14 days after: farther, loses to 2
        _arch(4, "2019-07-15"),  # 44 days from Jun 1 / 48 from Sep 1: gap, skipped
        _arch(8, "2022-08-31"),  # 1 day from Sep 1: wins over 2022-09-29 (28 days)
        _arch(9, "2023-03-30"),  # 29 days from Mar 1: within 31, picked
        _arch(5, "2022-09-29"),
        _arch(6, "2026-01-05"),
        _arch(7, "2026-01-28"),
    ]
    with caplog.at_level("WARNING"):
        picked = pick_quarterly(archs)
    assert [a.id for a in picked] == [1, 2, 8, 9, 7]
    assert "2019-06-01" in caplog.text  # skipped quarter reported


def test_pick_quarterly_dedupes() -> None:
    picked = pick_quarterly([_arch(1, "2019-03-01")])
    assert [a.id for a in picked] == [1]


def _studies(rows: list[tuple[str, str, str]]) -> pl.DataFrame:
    return pl.DataFrame(rows, schema=["nct_id", "study_type", "phase"], orient="row")


def test_in_scope_ids_requires_drug_and_phase() -> None:
    studies = _studies(
        [
            ("NCT00000001", "Interventional", "Phase 1/Phase 2"),
            ("NCT00000002", "INTERVENTIONAL", "PHASE1, PHASE2"),
            ("NCT00000003", "Interventional", "Early Phase 1"),
            ("NCT00000004", "Interventional", "Phase 3"),  # device only
            ("NCT00000005", "Observational", "Phase 2"),
            ("NCT00000006", "Interventional", "N/A"),
            ("NCT00000007", "Interventional", "EARLY_PHASE1"),
        ]
    )
    interventions = pl.DataFrame(
        {
            "nct_id": [f"NCT0000000{i}" for i in (1, 2, 3, 4, 5, 6, 7)],
            "intervention_type": ["Drug", "BIOLOGICAL", "Drug", "Device", "Drug", "Drug", "Drug"],
        }
    )
    assert in_scope_ids(studies, interventions) == {"NCT00000001", "NCT00000002"}


def _write_raw(raw: Path, studies_header: str = "") -> None:
    raw.mkdir(parents=True, exist_ok=True)
    (raw / "studies.txt").write_text(
        "nct_id|study_type|overall_status|phase|enrollment|source_class|extra\n"
        "NCT00000001|Interventional|Completed|Phase 2|10|INDUSTRY|x\n"
        "NCT00000002|Interventional|Completed|Phase 2|20|INDUSTRY|x\n"
        "BADID|Interventional|Completed|Phase 2|20|INDUSTRY|x\n"
    )
    (raw / "interventions.txt").write_text(
        "id|nct_id|intervention_type|name\n"
        '1|NCT00000001|Drug|"a|b ""quoted"""\n'
        "2|NCT00000002|Device|dev\n"
        "3|BADID|Drug|zzz\n"
    )
    for t in TABLES:
        if t not in ("studies", "interventions"):
            cols = ["nct_id", *[c for c in TABLES[t] if c != "nct_id"]]
            (raw / f"{t}.txt").write_text(
                "|".join(cols) + "\n" + "|".join(["NCT00000001"] + ["v"] * (len(cols) - 1)) + "\n"
            )


def test_fold_archive_writes_scoped_rows_and_quoted_pipe(tmp_path: Path) -> None:
    raw, panel = tmp_path / "raw", tmp_path / "panel"
    _write_raw(raw)
    in_scope = fold_archive(raw, date(2021, 12, 1), panel, {"NCT00000002"})
    assert in_scope == {"NCT00000001"}
    st = pl.read_parquet(panel / "studies" / "2021-12-01.parquet")
    assert sorted(st["nct_id"]) == ["NCT00000001", "NCT00000002"]  # ids union keeps 2
    assert set(st["snapshot_date"]) == {date(2021, 12, 1)}
    iv = pl.read_parquet(panel / "interventions" / "2021-12-01.parquet")
    assert iv.filter(pl.col("nct_id") == "NCT00000001")["name"].to_list() == ['a|b "quoted"']


def test_fold_archive_rerun_replaces_not_appends(tmp_path: Path) -> None:
    raw, panel = tmp_path / "raw", tmp_path / "panel"
    for _ in range(2):
        _write_raw(raw)
        fold_archive(raw, date(2021, 12, 1), panel, None)
    assert len(list((panel / "studies").glob("*.parquet"))) == 1
    assert pl.read_parquet(panel / "studies" / "2021-12-01.parquet").height == 1


def test_fold_archive_missing_column_is_null(tmp_path: Path) -> None:
    raw, panel = tmp_path / "raw", tmp_path / "panel"
    _write_raw(raw)
    fold_archive(raw, date(2021, 12, 1), panel, None)
    st = pl.read_parquet(panel / "studies" / "2021-12-01.parquet")
    assert st.columns[:1] == ["nct_id"] and "extra" not in st.columns
    assert set(TABLES["studies"]) | {"snapshot_date"} == set(st.columns)
    assert st["start_date"].null_count() == st.height
    assert st["source_class"].to_list() == ["INDUSTRY"]


def test_fold_archive_deletes_raw_dir(tmp_path: Path) -> None:
    raw, panel = tmp_path / "raw", tmp_path / "panel"
    _write_raw(raw)
    fold_archive(raw, date(2021, 12, 1), panel, None)
    assert not raw.exists()


def test_monthly_studies_filters_ids(tmp_path: Path) -> None:
    src, panel = tmp_path / "src", tmp_path / "panel"
    src.mkdir()
    pl.DataFrame(
        {"nct_id": ["NCT00000001", "NCT00000009"], "phase": ["Phase 1", "Phase 2"]}
    ).write_parquet(src / "2019-01-01.parquet")
    monthly_studies(src, panel, {"NCT00000001"})
    out = pl.read_parquet(panel / "studies_monthly" / "2019-01-01.parquet")
    assert out["nct_id"].to_list() == ["NCT00000001"]


def test_picks_sep_2022_gap_within_31_days() -> None:
    assert [a.id for a in pick_quarterly([_arch(5, "2022-09-29")])] == [5]


def test_panel_scope_ids_recomputes_from_panel(tmp_path: Path) -> None:
    raw, panel = tmp_path / "raw", tmp_path / "panel"
    _write_raw(raw)
    own = fold_archive(raw, date(2021, 12, 1), panel, None)
    assert panel_scope_ids(panel, date(2021, 12, 1)) == own == {"NCT00000001"}


def test_fold_archive_missing_table_file_is_empty_with_warning(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    raw, panel = tmp_path / "raw", tmp_path / "panel"
    _write_raw(raw)
    (raw / "facilities.txt").unlink()
    with caplog.at_level("WARNING"):
        fold_archive(raw, date(2021, 12, 1), panel, None)
    assert "facilities" in caplog.text
    fac = pl.read_parquet(panel / "facilities" / "2021-12-01.parquet")
    assert fac.height == 0 and "snapshot_date" in fac.columns
