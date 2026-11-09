from __future__ import annotations

import json
from dataclasses import replace
from datetime import date, datetime
from pathlib import Path
from typing import Any

import polars as pl
import pytest
from conftest import REPO_ROOT

from trialradar.config import AreaConfig
from trialradar.diff import TRIAL_CHANGE_SCHEMA
from trialradar.explorer.extras import StudyExtras
from trialradar.export import export
from trialradar.normalize import normalize
from trialradar.store import RUN_LOG_SCHEMA
from trialradar.tables import SCHEMAS, Tables

DAY = date(2026, 3, 31)
SAMPLE = REPO_ROOT / "pipeline" / "tests" / "fixtures" / "studies" / "sample20.jsonl"
ALIASES = REPO_ROOT / "config" / "aliases"

ITEM_KEYS = {
    "nct_id",
    "title",
    "lead_sponsor",
    "field",
    "old_value",
    "new_value",
    "detected_date",
    "delta_days",
    "notable",
    "notable_reason",
    "source_url",
}
TRIAL_KEYS = {
    "nct_id",
    "title",
    "phases",
    "overall_status",
    "why_stopped",
    "start_date",
    "primary_completion_date",
    "completion_date",
    "enrollment",
    "enrollment_type",
    "lead_sponsor",
    "sponsor_class",
    "masking",
    "allocation",
    "last_update_post_date",
    "conditions",
    "interventions",
    "countries",
    "site_count",
    "primary_outcomes",
    "secondary_outcomes",
    "changes",
    "source_url",
    "brief_summary",
    "eligibility",
    "has_results",
}


def df(name: str, rows: list[dict[str, Any]]) -> pl.DataFrame:
    return pl.DataFrame(rows, schema=SCHEMAS[name])


def small_tables() -> Tables:
    trial = df(
        "trial",
        [
            {
                "nct_id": "NCT00000001",
                "title": "Trial One",
                "phases": ["PHASE2", "PHASE3"],
                "overall_status": "RECRUITING",
                "why_stopped": None,
                "start_date": date(2024, 1, 1),
                "start_date_precision": "month",
                "start_date_type": "ACTUAL",
                "primary_completion_date": None,
                "primary_completion_date_precision": None,
                "primary_completion_date_type": None,
                "completion_date": None,
                "completion_date_precision": None,
                "completion_date_type": None,
                "enrollment": 100,
                "enrollment_type": "ESTIMATED",
                "lead_sponsor": "Acme",
                "sponsor_class": "INDUSTRY",
                "masking": "DOUBLE",
                "allocation": "RANDOMIZED",
                "last_update_post_date": date(2026, 3, 1),
            },
            {"nct_id": "NCT00000002", "title": "Trial Two", "phases": []},
        ],
    )
    cond = df(
        "condition",
        [{"nct_id": "NCT00000001", "condition": "MS"}],
    )
    interv = df(
        "intervention",
        [
            {
                "nct_id": "NCT00000001",
                "type": "DRUG",
                "name": "Foo 5mg",
                "name_normalized": "foo",
            }
        ],
    )
    site = df(
        "site",
        [
            {"nct_id": "NCT00000001", "country": "Germany"},
            {"nct_id": "NCT00000001", "country": "Germany"},
            {"nct_id": "NCT00000001", "country": "France"},
            {"nct_id": "NCT00000001", "country": None},
        ],
    )
    outcome = df(
        "outcome",
        [
            {"nct_id": "NCT00000001", "kind": "primary", "measure": "P1", "time_frame": "1y"},
            {"nct_id": "NCT00000001", "kind": "secondary", "measure": "S1", "time_frame": None},
        ],
    )
    e = Tables.empty()
    return Tables(trial, cond, interv, e.sponsor, site, outcome)


def ch(
    nct: str,
    field: str,
    detected: date,
    old: str | None = '"a"',
    new: str | None = '"b"',
    **kw: Any,
) -> dict[str, Any]:
    row: dict[str, Any] = {
        "nct_id": nct,
        "field": field,
        "old_value": old,
        "new_value": new,
        "detected_date": detected,
        "registry_update_date": None,
        "delta_days": None,
        "notable": False,
        "notable_reason": None,
    }
    row.update(kw)
    return row


def changes_df(rows: list[dict[str, Any]]) -> pl.DataFrame:
    return pl.DataFrame(rows, schema=TRIAL_CHANGE_SCHEMA)


def runlog(rows: list[dict[str, Any]]) -> pl.DataFrame:
    full = [
        {
            "run_id": "r",
            "started_at": datetime(2026, 3, 30, 6, 0),
            "duration_s": 1.0,
            "status": "success",
            "data_timestamp": "ts",
            "rows_ingested": 1,
            "changes_detected": 0,
            "warnings": "[]",
            **r,
        }
        for r in rows
    ]
    return pl.DataFrame(full, schema=RUN_LOG_SCHEMA)


def load(p: Path) -> Any:
    return json.loads(p.read_text(encoding="utf-8"))


def run(
    out: Path,
    rows: list[dict[str, Any]],
    tables: Tables | None = None,
    log: pl.DataFrame | None = None,
    day: date = DAY,
    cfg: AreaConfig | None = None,
) -> None:
    assert cfg is not None
    export(
        tables or small_tables(),
        changes_df(rows),
        log if log is not None else runlog([{}]),
        cfg,
        day,
        out,
    )


@pytest.mark.parametrize("n", [1, 7, 30])
def test_window_boundaries(tmp_path: Path, cfg: AreaConfig, n: int) -> None:
    rows = [
        ch("NCT00000001", "included", date.fromordinal(DAY.toordinal() - (n - 1))),
        ch("NCT00000001", "excluded", date.fromordinal(DAY.toordinal() - n)),
        ch("NCT00000001", "future", date.fromordinal(DAY.toordinal() + 1)),
    ]
    run(tmp_path, rows, cfg=cfg)
    doc = load(tmp_path / "changes" / f"{n}d.json")
    assert doc["window_days"] == n
    assert doc["generated_for"] == "2026-03-31"
    assert [c["field"] for c in doc["changes"]] == ["included"]


def test_empty_window_and_baseline(tmp_path: Path, cfg: AreaConfig) -> None:
    export(Tables.empty(), changes_df([]), runlog([]), cfg, DAY, tmp_path)
    for n in (1, 7, 30):
        assert load(tmp_path / "changes" / f"{n}d.json")["changes"] == []
    assert load(tmp_path / "meta.json")["trial_count"] == 0
    assert list((tmp_path / "trials").iterdir()) == []


def test_ordering_and_item_shape(tmp_path: Path, cfg: AreaConfig) -> None:
    d1, d0 = DAY, date(2026, 3, 30)
    rows = [
        ch("NCT00000002", "b", d0),
        ch("NCT00000002", "a", d1),
        ch("NCT00000001", "z", d1),
        ch("NCT00000001", "y", d1),
        ch("NCT00000001", "x", d0),
    ]
    run(tmp_path, rows, cfg=cfg)
    doc = load(tmp_path / "changes" / "7d.json")
    got = [(c["detected_date"], c["nct_id"], c["field"]) for c in doc["changes"]]
    assert got == [
        ("2026-03-31", "NCT00000001", "y"),
        ("2026-03-31", "NCT00000001", "z"),
        ("2026-03-31", "NCT00000002", "a"),
        ("2026-03-30", "NCT00000001", "x"),
        ("2026-03-30", "NCT00000002", "b"),
    ]
    first = doc["changes"][0]
    assert set(first) == ITEM_KEYS
    assert first["title"] == "Trial One"
    assert first["lead_sponsor"] == "Acme"
    assert first["source_url"] == "https://clinicaltrials.gov/study/NCT00000001"
    assert [c["nct_id"] for c in load(tmp_path / "changes" / "1d.json")["changes"]] == [
        "NCT00000001",
        "NCT00000001",
        "NCT00000002",
    ]


def test_decoded_values_and_nulls(tmp_path: Path, cfg: AreaConfig) -> None:
    rows = [
        ch("NCT00000001", "added", DAY, old=None, new='{"a":[1,2]}'),
        ch(
            "NCT00000001",
            "why_stopped",
            DAY,
            old="null",
            new='"x"',
            delta_days=12,
            notable=True,
            notable_reason="status_change",
        ),
        ch("NCT00000001", "enrollment", DAY, old="5", new=None),
    ]
    run(tmp_path, rows, cfg=cfg)
    by = {c["field"]: c for c in load(tmp_path / "changes" / "1d.json")["changes"]}
    assert by["added"]["old_value"] is None and by["added"]["new_value"] == {"a": [1, 2]}
    assert by["why_stopped"]["old_value"] is None and by["why_stopped"]["new_value"] == "x"
    assert by["why_stopped"]["delta_days"] == 12 and by["why_stopped"]["notable"] is True
    assert by["why_stopped"]["notable_reason"] == "status_change"
    assert by["enrollment"]["old_value"] == 5 and by["enrollment"]["new_value"] is None
    assert by["added"]["delta_days"] is None


def test_malformed_json_raises(tmp_path: Path, cfg: AreaConfig) -> None:
    with pytest.raises(ValueError, match=r"NCT00000001.*enrollment"):
        run(tmp_path, [ch("NCT00000001", "enrollment", DAY, old="{oops")], cfg=cfg)


def test_removed_trial_has_null_title(tmp_path: Path, cfg: AreaConfig) -> None:
    run(tmp_path, [ch("NCT99999999", "_tracked", DAY, old='"x"', new=None)], cfg=cfg)
    item = load(tmp_path / "changes" / "1d.json")["changes"][0]
    assert item["title"] is None and item["lead_sponsor"] is None
    assert not (tmp_path / "trials" / "NCT99999999.json").exists()


def test_trial_file(tmp_path: Path, cfg: AreaConfig) -> None:
    rows = [ch("NCT00000001", "old", date(2025, 1, 1)), ch("NCT00000001", "new", DAY)]
    run(tmp_path, rows, cfg=cfg)
    t = load(tmp_path / "trials" / "NCT00000001.json")
    assert set(t) == TRIAL_KEYS
    assert t["phases"] == ["PHASE2", "PHASE3"]
    assert t["start_date"] == {"date": "2024-01-01", "precision": "month", "type": "ACTUAL"}
    assert t["completion_date"] is None
    assert t["last_update_post_date"] == "2026-03-01"
    assert t["conditions"] == ["MS"]
    assert t["interventions"] == [{"type": "DRUG", "name": "foo"}]
    assert t["countries"] == ["France", "Germany"]
    assert t["site_count"] == 4
    assert t["primary_outcomes"] == [{"measure": "P1", "time_frame": "1y"}]
    assert t["secondary_outcomes"] == [{"measure": "S1", "time_frame": None}]
    assert [c["field"] for c in t["changes"]] == ["new", "old"]
    assert t["source_url"] == "https://clinicaltrials.gov/study/NCT00000001"
    t2 = load(tmp_path / "trials" / "NCT00000002.json")
    assert t2["changes"] == [] and t2["countries"] == [] and t2["site_count"] == 0
    assert t2["conditions"] == [] and t2["start_date"] is None


def test_stale_trial_removed_unrelated_kept(tmp_path: Path, cfg: AreaConfig) -> None:
    trials = tmp_path / "trials"
    trials.mkdir()
    (trials / "NCT12345678.json").write_text("{}")
    (trials / "notes.json").write_text("{}")
    (trials / "NCT1.txt").write_text("x")
    run(tmp_path, [], cfg=cfg)
    assert not (trials / "NCT12345678.json").exists()
    assert (trials / "notes.json").exists() and (trials / "NCT1.txt").exists()
    assert (trials / "NCT00000001.json").exists()
    assert not list(tmp_path.rglob("*.tmp"))


def test_meta_latest_success(tmp_path: Path, cfg: AreaConfig) -> None:
    log = runlog(
        [
            {"started_at": datetime(2026, 3, 29, 6), "data_timestamp": "old", "warnings": '["w0"]'},
            {
                "started_at": datetime(2026, 3, 30, 6, 30),
                "data_timestamp": "new",
                "warnings": '["w1","w2"]',
            },
            {"started_at": datetime(2026, 3, 31, 6), "status": "failed", "data_timestamp": "f"},
            {"started_at": datetime(2026, 3, 31, 7), "status": "skipped", "data_timestamp": "s"},
        ]
    )
    run(tmp_path, [], log=log, cfg=cfg)
    meta = load(tmp_path / "meta.json")
    assert meta == {
        "area": cfg.name,
        "conditions": [c.label for c in cfg.conditions],
        "generated_for": "2026-03-31",
        "trial_count": 2,
        "last_success_at": "2026-03-30T06:30:00Z",
        "tracking_since": "2026-03-29",
        "data_timestamp": "new",
        "warnings": ["w1", "w2"],
    }


def test_meta_tie_takes_last_and_no_success(tmp_path: Path, cfg: AreaConfig) -> None:
    same = datetime(2026, 3, 30, 6)
    log = runlog(
        [{"started_at": same, "data_timestamp": "a"}, {"started_at": same, "data_timestamp": "b"}]
    )
    run(tmp_path, [], log=log, cfg=cfg)
    assert load(tmp_path / "meta.json")["data_timestamp"] == "b"
    run(tmp_path, [], log=runlog([{"status": "failed"}]), cfg=cfg)
    meta = load(tmp_path / "meta.json")
    assert (meta["last_success_at"], meta["data_timestamp"], meta["warnings"]) == (None, None, [])
    assert meta["tracking_since"] is None


def test_trial_index(tmp_path: Path, cfg: AreaConfig) -> None:
    rows = [ch("NCT00000001", "old", date(2025, 1, 1)), ch("NCT00000001", "new", DAY)]
    run(tmp_path, rows, cfg=cfg)
    doc = load(tmp_path / "trials.json")
    assert doc["generated_for"] == "2026-03-31"
    assert [t["nct_id"] for t in doc["trials"]] == ["NCT00000001", "NCT00000002"]  # sorted
    first, second = doc["trials"]
    assert set(first) == {
        "nct_id",
        "title",
        "overall_status",
        "phases",
        "lead_sponsor",
        "start_date",
        "primary_completion_date",
        "enrollment",
        "last_change",
    }
    assert first["last_change"] == "2026-03-31"
    assert first["start_date"] == {"date": "2024-01-01", "precision": "month", "type": "ACTUAL"}
    assert second["last_change"] is None and second["start_date"] is None


def test_trial_index_empty_baseline(tmp_path: Path, cfg: AreaConfig) -> None:
    export(Tables.empty(), changes_df([]), runlog([]), cfg, DAY, tmp_path)
    assert load(tmp_path / "trials.json")["trials"] == []


def test_file_format(tmp_path: Path, cfg: AreaConfig) -> None:
    run(tmp_path, [], cfg=cfg)
    raw = (tmp_path / "meta.json").read_text(encoding="utf-8")
    assert raw.endswith("}\n") and ": " not in raw and ", " not in raw
    keys = list(json.loads(raw))
    assert keys == sorted(keys)


def test_sample20(tmp_path: Path, cfg: AreaConfig) -> None:
    studies = [json.loads(ln) for ln in SAMPLE.read_text().splitlines() if ln.strip()]
    tables = normalize(studies, ALIASES)
    export(tables, changes_df([]), runlog([]), cfg, DAY, tmp_path)
    files = sorted((tmp_path / "trials").glob("NCT*.json"))
    assert len(files) == 20
    for f in files:
        doc = load(f)
        assert set(doc) == TRIAL_KEYS
        assert doc["nct_id"] == f.stem


def test_write_json_failure_leaves_no_tmp(
    tmp_path: Path, cfg: AreaConfig, monkeypatch: pytest.MonkeyPatch
) -> None:
    def boom(*a: Any, **k: Any) -> None:
        raise OSError("disk")

    monkeypatch.setattr("trialradar.export.os.replace", boom)
    with pytest.raises(OSError):
        run(tmp_path, [], cfg=cfg)
    assert not list(tmp_path.rglob("*.tmp"))


@pytest.mark.parametrize("bad", ["../evil", "NCT12/3", "NCT1\n", "nct1"])
def test_invalid_nct_id_rejected(tmp_path: Path, cfg: AreaConfig, bad: str) -> None:
    tables = small_tables()
    tables = replace(tables, trial=tables.trial.with_columns(nct_id=pl.lit(bad)))
    out = tmp_path / "out"
    with pytest.raises(ValueError, match="NCT"):
        run(out, [], tables=tables, cfg=cfg)
    assert not (tmp_path / "evil.json").exists()
    assert not list(tmp_path.rglob("*evil*"))
    assert not (out / "trials").exists() or not list((out / "trials").iterdir())


@pytest.mark.parametrize("raw", ['{"a": 1}', '"str"', "[1, 2]", "5"])
def test_meta_warnings_must_be_list_of_strings(tmp_path: Path, cfg: AreaConfig, raw: str) -> None:
    with pytest.raises(ValueError, match="warnings"):
        run(tmp_path, [], log=runlog([{"warnings": raw}]), cfg=cfg)


def test_stale_sweep_skips_directories(tmp_path: Path, cfg: AreaConfig) -> None:
    trials = tmp_path / "trials"
    (trials / "NCT1.json").mkdir(parents=True)
    run(tmp_path, [], cfg=cfg)
    assert (trials / "NCT1.json").is_dir()


def _extras(nct: str) -> StudyExtras:
    return StudyExtras(
        nct_id=nct,
        brief_summary="A short summary.",
        sex="FEMALE",
        min_age_years=18.0,
        max_age_years=None,
        has_results=True,
        experimental_drugs=("foo",),
        mesh_terms=(),
        condition_labels=(),
    )


def test_export_trial_doc_has_summary(tmp_path: Path, cfg: AreaConfig) -> None:
    export(
        small_tables(),
        changes_df([]),
        runlog([{}]),
        cfg,
        DAY,
        tmp_path,
        extras={"NCT00000001": _extras("NCT00000001")},
    )
    t1 = load(tmp_path / "trials" / "NCT00000001.json")
    assert set(t1) == TRIAL_KEYS
    assert t1["brief_summary"] == "A short summary."
    assert t1["eligibility"] == {"sex": "FEMALE", "min_age_years": 18.0, "max_age_years": None}
    assert t1["has_results"] is True
    t2 = load(tmp_path / "trials" / "NCT00000002.json")
    assert t2["brief_summary"] is None
    assert t2["eligibility"] == {"sex": None, "min_age_years": None, "max_age_years": None}
    assert t2["has_results"] is False


def test_export_without_extras_has_null_summary(tmp_path: Path, cfg: AreaConfig) -> None:
    run(tmp_path, [], cfg=cfg)
    t1 = load(tmp_path / "trials" / "NCT00000001.json")
    assert t1["brief_summary"] is None and t1["has_results"] is False


def test_explorer_json_written_only_when_given(tmp_path: Path, cfg: AreaConfig) -> None:
    run(tmp_path, [], cfg=cfg)
    assert not (tmp_path / "explorer.json").exists()
    doc = {"generated_for": DAY.isoformat(), "trials": [{"nct_id": "NCT00000001", "x": 0.5}]}
    export(small_tables(), changes_df([]), runlog([{}]), cfg, DAY, tmp_path, explorer=doc)
    text = (tmp_path / "explorer.json").read_text(encoding="utf-8")
    assert json.loads(text) == doc
    assert text.endswith("\n") and ", " not in text  # compact like the other files


def test_export_without_explorer_removes_a_stale_map(tmp_path: Path, cfg: AreaConfig) -> None:
    """explorer.json is present exactly when this export has a map, so a failed map
    build never leaves yesterday's map over today's trials."""
    doc = {"generated_for": DAY.isoformat(), "trials": []}
    export(small_tables(), changes_df([]), runlog([{}]), cfg, DAY, tmp_path, explorer=doc)
    assert (tmp_path / "explorer.json").exists()
    export(small_tables(), changes_df([]), runlog([{}]), cfg, DAY, tmp_path)
    assert not (tmp_path / "explorer.json").exists()


def test_mechanisms_json_written_and_removed(tmp_path: Path, cfg: AreaConfig) -> None:
    """mechanisms.json is present exactly when this export has a graph (and a map)."""
    doc = {"generated_for": DAY.isoformat(), "trials": []}
    graph = {"generated_for": DAY.isoformat(), "nodes": [], "edges": []}
    args = (small_tables(), changes_df([]), runlog([{}]), cfg, DAY, tmp_path)
    export(*args, explorer=doc, mechanisms=graph)
    assert json.loads((tmp_path / "mechanisms.json").read_text(encoding="utf-8")) == graph
    export(*args, explorer=doc)
    assert not (tmp_path / "mechanisms.json").exists()
    export(*args, explorer=doc, mechanisms=graph)
    export(*args, mechanisms=graph)  # no map: no graph either
    assert not (tmp_path / "mechanisms.json").exists()


def test_export_writes_and_removes_pipeline_json(tmp_path: Path, cfg: AreaConfig) -> None:
    """pipeline.json is present exactly when this export has a figure (and a map)."""
    doc = {"generated_for": DAY.isoformat(), "trials": []}
    fig = {"generated_for": DAY.isoformat(), "rows": []}
    args = (small_tables(), changes_df([]), runlog([{}]), cfg, DAY, tmp_path)
    export(*args, explorer=doc, pipeline=fig)
    assert json.loads((tmp_path / "pipeline.json").read_text(encoding="utf-8")) == fig
    export(*args, explorer=doc)
    assert not (tmp_path / "pipeline.json").exists()
    export(*args, explorer=doc, pipeline=fig)
    export(*args, pipeline=fig)  # no map: no figure either
    assert not (tmp_path / "pipeline.json").exists()


def test_export_writes_and_removes_risk_json(tmp_path: Path, cfg: AreaConfig) -> None:
    """risk.json is present exactly when this export carries a risk document."""
    doc = {"generated_for": DAY.isoformat(), "model": {}}
    args = (small_tables(), changes_df([]), runlog([{}]), cfg, DAY, tmp_path)
    export(*args, risk=doc)
    assert json.loads((tmp_path / "risk.json").read_text(encoding="utf-8")) == doc
    export(*args)
    assert not (tmp_path / "risk.json").exists()
