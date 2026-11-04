from __future__ import annotations

import json
from typing import Any

import polars as pl
from conftest import DELETE, REPO_ROOT, make_study

from trialradar.config import AreaConfig
from trialradar.normalize import normalize
from trialradar.quality import KNOWN_STATUSES, QualityReport, check
from trialradar.tables import Tables

ALIASES = REPO_ROOT / "config" / "aliases"
SAMPLE = REPO_ROOT / "pipeline" / "tests" / "fixtures" / "studies" / "sample20.jsonl"


def run(
    studies: list[dict[str, Any]],
    cfg: AreaConfig,
    prev: int | None = None,
    tables: Tables | None = None,
) -> QualityReport:
    return check(studies, tables or normalize(studies, ALIASES), prev, cfg)


def prefixed(msgs: list[str], prefix: str) -> list[str]:
    return [m for m in msgs if m.startswith(prefix + " ")]


def test_known_statuses_has_14() -> None:
    assert len(KNOWN_STATUSES) == 14
    assert "RECRUITING" in KNOWN_STATUSES


def test_clean_run_ok(cfg: AreaConfig) -> None:
    r = run([make_study("NCT00000001"), make_study("NCT00000002")], cfg, prev=2)
    assert r.ok
    assert r.errors == []
    assert r.warnings == []


def test_sample20_clean(cfg: AreaConfig) -> None:
    studies = [json.loads(line) for line in SAMPLE.read_text().splitlines() if line.strip()]
    assert len(studies) == 20
    r = run(studies, cfg, prev=None)
    assert r.errors == []
    assert r.ok
    assert r.warnings == []


def test_schema_error_counts_per_path(cfg: AreaConfig) -> None:
    studies = [
        make_study("NCT00000001", **{"identificationModule.briefTitle": DELETE}),
        make_study("NCT00000002", **{"identificationModule.briefTitle": DELETE}),
        make_study("NCT00000003"),
    ]
    r = check(studies, normalize([studies[2]], ALIASES), None, cfg)
    errs = prefixed(r.errors, "schema:")
    assert len(errs) == 1
    assert "briefTitle" in errs[0]
    assert "2" in errs[0]
    assert "NCT00000001" in errs[0] and "NCT00000002" in errs[0]
    assert not r.ok


def test_schema_missing_nct_and_status(cfg: AreaConfig) -> None:
    studies = [
        make_study("NCT00000001", **{"statusModule.overallStatus": DELETE}),
        {"protocolSection": {}},
    ]
    r = check(studies, normalize([], ALIASES), None, cfg)
    errs = prefixed(r.errors, "schema:")
    assert any("overallStatus" in e for e in errs)
    assert any("nctId" in e for e in errs)


def test_schema_ok(cfg: AreaConfig) -> None:
    assert prefixed(run([make_study()], cfg).errors, "schema:") == []


def test_null_rate_error_and_empty_string(cfg: AreaConfig) -> None:
    studies = [make_study("NCT00000001"), make_study("NCT00000002")]
    t = normalize(studies, ALIASES)
    bad = Tables(
        trial=t.trial.with_columns(
            pl.when(pl.col("nct_id") == "NCT00000002")
            .then(pl.lit(""))
            .otherwise(pl.col("title"))
            .alias("title")
        ),
        condition=t.condition,
        intervention=t.intervention,
        sponsor=t.sponsor,
        site=t.site,
        outcome=t.outcome,
    )
    r = check(studies, bad, None, cfg)
    errs = prefixed(r.errors, "null_rate:")
    assert len(errs) == 1
    assert "title" in errs[0] and "NCT00000002" in errs[0]


def test_null_rate_within_threshold(cfg: AreaConfig) -> None:
    studies = [make_study("NCT00000001"), make_study("NCT00000002")]
    t = normalize(studies, ALIASES)
    nulled = Tables(
        trial=t.trial.with_columns(
            pl.when(pl.col("nct_id") == "NCT00000002")
            .then(None)
            .otherwise(pl.col("overall_status"))
            .alias("overall_status")
        ),
        condition=t.condition,
        intervention=t.intervention,
        sponsor=t.sponsor,
        site=t.site,
        outcome=t.outcome,
    )
    lenient = cfg.model_copy(
        update={"thresholds": cfg.thresholds.model_copy(update={"max_null_rate": 0.5})}
    )
    assert prefixed(check(studies, nulled, None, lenient).errors, "null_rate:") == []
    assert prefixed(check(studies, nulled, None, cfg).errors, "null_rate:") != []


def test_date_order_error_when_both_actual(cfg: AreaConfig) -> None:
    s = make_study(
        "NCT00000001",
        **{
            "statusModule.startDateStruct": {"date": "2024-06", "type": "ACTUAL"},
            "statusModule.completionDateStruct": {"date": "2023-01", "type": "ACTUAL"},
        },
    )
    r = run([s], cfg)
    errs = prefixed(r.errors, "date_order:")
    assert len(errs) == 1 and "NCT00000001" in errs[0]
    assert prefixed(r.warnings, "date_order_estimated:") == []


def test_date_order_ok_actual(cfg: AreaConfig) -> None:
    s = make_study(
        **{
            "statusModule.startDateStruct": {"date": "2023-01", "type": "ACTUAL"},
            "statusModule.completionDateStruct": {"date": "2024-06", "type": "ACTUAL"},
        },
    )
    r = run([s], cfg)
    assert prefixed(r.errors, "date_order:") == []
    assert prefixed(r.warnings, "date_order_estimated:") == []


def test_date_order_estimated_warning(cfg: AreaConfig) -> None:
    s = make_study(
        "NCT00000009",
        **{
            "statusModule.startDateStruct": {"date": "2024-06", "type": "ACTUAL"},
            "statusModule.completionDateStruct": {"date": "2023-01", "type": "ESTIMATED"},
        },
    )
    r = run([s], cfg)
    assert prefixed(r.errors, "date_order:") == []
    warns = prefixed(r.warnings, "date_order_estimated:")
    assert len(warns) == 1 and "NCT00000009" in warns[0]


def test_date_order_none_type_is_warning(cfg: AreaConfig) -> None:
    s = make_study(
        **{
            "statusModule.startDateStruct": {"date": "2024-06"},
            "statusModule.completionDateStruct": {"date": "2023-01"},
        },
    )
    r = run([s], cfg)
    assert prefixed(r.errors, "date_order:") == []
    assert len(prefixed(r.warnings, "date_order_estimated:")) == 1


def test_duplicate_error(cfg: AreaConfig) -> None:
    studies = [make_study("NCT00000001"), make_study("NCT00000001")]
    r = run(studies, cfg)
    errs = prefixed(r.errors, "duplicate:")
    assert len(errs) == 1 and "NCT00000001" in errs[0]


def test_no_duplicate(cfg: AreaConfig) -> None:
    r = run([make_study("NCT00000001"), make_study("NCT00000002")], cfg)
    assert prefixed(r.errors, "duplicate:") == []


def test_empty_error_skips_row_drop(cfg: AreaConfig) -> None:
    r = check([], Tables.empty(), 100, cfg)
    assert len(prefixed(r.errors, "empty:")) == 1
    assert prefixed(r.warnings, "row_drop:") == []
    assert not r.ok


def test_not_empty(cfg: AreaConfig) -> None:
    assert prefixed(run([make_study()], cfg).errors, "empty:") == []


def _many(n: int) -> list[dict[str, Any]]:
    return [make_study(f"NCT{i:08d}") for i in range(1, n + 1)]


def test_row_drop_first_run_none(cfg: AreaConfig) -> None:
    assert prefixed(run(_many(1), cfg, prev=None).warnings, "row_drop:") == []


def test_row_drop_exactly_threshold_not_warning(cfg: AreaConfig) -> None:
    assert prefixed(run(_many(90), cfg, prev=100).warnings, "row_drop:") == []


def test_row_drop_over_threshold_warns(cfg: AreaConfig) -> None:
    r = run(_many(899), cfg, prev=1000)
    assert len(prefixed(r.warnings, "row_drop:")) == 1
    assert r.ok  # warning only


def test_row_drop_prev_zero(cfg: AreaConfig) -> None:
    assert prefixed(run(_many(1), cfg, prev=0).warnings, "row_drop:") == []


def test_unknown_status_warning(cfg: AreaConfig) -> None:
    studies = [
        make_study("NCT00000001", **{"statusModule.overallStatus": "BOGUS"}),
        make_study("NCT00000002", **{"statusModule.overallStatus": "ODD"}),
        make_study("NCT00000003"),
    ]
    r = run(studies, cfg)
    warns = prefixed(r.warnings, "unknown_status:")
    assert len(warns) == 1
    assert "BOGUS" in warns[0] and "ODD" in warns[0]
    assert r.ok


def test_unknown_status_known_ok(cfg: AreaConfig) -> None:
    assert prefixed(run([make_study()], cfg).warnings, "unknown_status:") == []


def test_id_listing_is_capped(cfg: AreaConfig) -> None:
    studies = [
        make_study(f"NCT{i:08d}", **{"identificationModule.briefTitle": DELETE}) for i in range(8)
    ]
    r = check(studies, normalize([make_study("NCT99999999")], ALIASES), None, cfg)
    msg = prefixed(r.errors, "schema:")[0]
    assert "and 3 more" in msg
