from __future__ import annotations

from datetime import date
from pathlib import Path

import polars as pl

from trialradar.risk.history_v2 import HISTORY_FEATURES, history_features, load_monthly


def _monthly(snaps: list[tuple[str, str, str, str, str, str]]) -> pl.DataFrame:
    """(snapshot, nct, pcd, status, enrollment, enrollment_type)."""
    return pl.DataFrame(
        {
            "nct_id": [s[1] for s in snaps],
            "snapshot_date": [date.fromisoformat(s[0]) for s in snaps],
            "primary_completion_date": [s[2] for s in snaps],
            "overall_status": [s[3] for s in snaps],
            "enrollment": [s[4] for s in snaps],
            "enrollment_type": [s[5] for s in snaps],
        }
    )


def _rows(*items: tuple[str, str]) -> pl.DataFrame:
    return pl.DataFrame(
        {"nct_id": [i[0] for i in items], "as_of": [date.fromisoformat(i[1]) for i in items]}
    )


def _one(monthly: pl.DataFrame, as_of: str = "2024-12-31", nct: str = "NCT1") -> dict[str, float]:
    out = history_features(monthly, _rows((nct, as_of)))
    assert out.columns == ["nct_id", "as_of", *HISTORY_FEATURES]
    return out.row(0, named=True)


def test_slip_counted_once_per_change() -> None:
    m = _monthly(
        [
            ("2024-01-31", "NCT1", "2024-06-30", "Recruiting", "100", "Anticipated"),
            ("2024-02-29", "NCT1", "2024-06-30", "RECRUITING", "100", "ESTIMATED"),
            ("2024-03-31", "NCT1", "2024-09-30", "Recruiting", "100", "Anticipated"),
            ("2024-04-30", "NCT1", "2024-09-30", "Recruiting", "100", "Anticipated"),
        ]
    )
    r = _one(m)
    assert r["pcd_slips_12m"] == 1
    assert 2.9 < r["pcd_slip_months_12m"] < 3.1
    assert r["enrollment_cuts_12m"] == 0
    assert r["status_regressions_12m"] == 0


def test_window_excludes_future_snapshots() -> None:
    m = _monthly(
        [
            ("2024-01-31", "NCT1", "2024-06-30", "Recruiting", "100", "Anticipated"),
            ("2024-06-30", "NCT1", "2024-12-31", "Recruiting", "100", "Anticipated"),
        ]
    )
    assert _one(m, "2024-03-31")["pcd_slips_12m"] == 0
    assert _one(m, "2024-06-30")["pcd_slips_12m"] == 1
    # slip older than the window no longer counts
    assert _one(m, "2025-06-30")["pcd_slips_12m"] == 0


def test_cut_threshold_20pct() -> None:
    def run(new: str) -> float:
        m = _monthly(
            [
                ("2024-01-31", "NCT1", "2025-01-31", "Recruiting", "100", "Anticipated"),
                ("2024-02-29", "NCT1", "2025-01-31", "Recruiting", new, "ESTIMATED"),
            ]
        )
        return _one(m)["enrollment_cuts_12m"]

    assert run("81") == 0
    assert run("80") == 1
    assert run("50") == 1


def test_actual_enrollment_not_a_cut() -> None:
    m = _monthly(
        [
            ("2024-01-31", "NCT1", "2025-01-31", "Recruiting", "100", "Anticipated"),
            ("2024-02-29", "NCT1", "2025-01-31", "Completed", "40", "Actual"),
        ]
    )
    assert _one(m)["enrollment_cuts_12m"] == 0


def test_status_regression_direction() -> None:
    m = _monthly(
        [
            ("2024-01-31", "NCT1", "2025-01-31", "Recruiting", "10", "Anticipated"),
            ("2024-02-29", "NCT1", "2025-01-31", "Not yet recruiting", "10", "Anticipated"),
            ("2024-03-31", "NCT1", "2025-01-31", "RECRUITING", "10", "Anticipated"),
            ("2024-04-30", "NCT1", "2025-01-31", "Active, not recruiting", "10", "Anticipated"),
            ("2024-05-31", "NCT1", "2025-01-31", "ACTIVE_NOT_RECRUITING", "10", "Anticipated"),
        ]
    )
    assert _one(m)["status_regressions_12m"] == 1


def test_gap_month_compares_neighbours() -> None:
    m = _monthly(
        [
            ("2024-01-31", "NCT1", "2024-06-30", "Recruiting", "100", "Anticipated"),
            ("2024-04-30", "NCT1", "2024-08-31", "Recruiting", "70", "Anticipated"),
        ]
    )
    r = _one(m)
    assert r["pcd_slips_12m"] == 1
    assert r["enrollment_cuts_12m"] == 1


def test_no_history_gives_zeros_and_order_kept() -> None:
    m = _monthly([("2024-01-31", "NCT1", "2024-06-30", "Recruiting", "1", "Anticipated")])
    out = history_features(m, _rows(("NCT9", "2024-12-31"), ("NCT1", "2024-12-31")))
    assert out["nct_id"].to_list() == ["NCT9", "NCT1"]
    assert out.row(0)[2:] == (0, 0.0, 0, 0)
    assert out.select(HISTORY_FEATURES).null_count().sum_horizontal().item() == 0


def test_load_monthly_reads_snapshot_from_filename(tmp_path: Path) -> None:
    d = tmp_path / "studies_monthly"
    d.mkdir()
    pl.DataFrame(
        {
            "nct_id": ["NCT1"],
            "last_update_posted_date": ["2024-01-02"],
            "primary_completion_date": ["2024-06-30"],
            "overall_status": ["Recruiting"],
            "enrollment": ["5"],
            "enrollment_type": ["Anticipated"],
        }
    ).write_parquet(d / "2024-01-31.parquet")
    out = load_monthly(tmp_path)
    assert out["snapshot_date"].to_list() == [date(2024, 1, 31)]
    assert load_monthly(tmp_path / "nope").height == 0
