"""End-to-end daily runs over simulated days with a fake client."""

from __future__ import annotations

import gzip
import json
from datetime import date
from pathlib import Path
from typing import Any

import polars as pl
import pytest

from trialradar import pipeline
from trialradar.config import AreaConfig
from trialradar.ctgov.client import CtGovError
from trialradar.pipeline import RunResult
from trialradar.snapshot import read_snapshot

from .conftest import (
    ADDED,
    COSMETIC,
    DATE_EDIT,
    OFF_TOPIC,
    REMOVED,
    STATUS_EDIT,
    Env,
    FakeClient,
    day1_studies,
    day2_studies,
    nct,
    relevant_ids,
    tree_bytes,
)

D1, D2, D3 = date(2026, 3, 1), date(2026, 3, 2), date(2026, 3, 3)
TS1, TS2, TS3 = "2026-03-01T06:00:00", "2026-03-02T06:00:00", "2026-03-03T06:00:00"
RUN_LOG = "history/run_log.parquet"


def store_tree(env: Env) -> dict[str, bytes]:
    """Store files that a failed run must leave byte-identical (run_log gets a row)."""
    return tree_bytes(env.store_root, exclude=(RUN_LOG,))


def two_days(env: Env, cfg: AreaConfig) -> None:
    assert env.run(FakeClient(TS1, day1_studies(cfg)), D1).status == "success"
    assert env.run(FakeClient(TS2, day2_studies(cfg)), D2).status == "success"


def drop_study(studies: list[dict[str, Any]], nct_id: str, path: tuple[str, ...]) -> None:
    for s in studies:
        if nct(s) == nct_id:
            node = s["protocolSection"]
            for key in path[:-1]:
                node = node[key]
            del node[path[-1]]
            return
    raise AssertionError(nct_id)


# ----- day 1 -----


def test_day1_baseline(env: Env, cfg: AreaConfig) -> None:
    assert not env.raw_dir.exists()  # an empty first-run raw dir is fine
    studies = day1_studies(cfg)
    result = env.run(FakeClient(TS1, studies), D1)

    assert result == RunResult("success", 0, [], [])
    ids = relevant_ids(cfg, studies)
    trial_files = sorted(p.stem for p in (env.site_dir / "trials").glob("*.json"))
    assert trial_files == ids and len(ids) >= 12
    meta = json.loads((env.site_dir / "meta.json").read_text())
    assert meta["data_timestamp"] == TS1
    assert meta["trial_count"] == len(ids)
    assert meta["generated_for"] == D1.isoformat()
    assert meta["last_success_at"] == "2026-03-01T07:18:00Z"

    # Off-topic studies are kept in the raw snapshot but never reach tables or site.
    raw = read_snapshot(env.raw_dir / "2026-03-01.jsonl.gz")
    assert [nct(s) for s in raw] == [nct(s) for s in studies]
    assert set(OFF_TOPIC) <= {nct(s) for s in raw}
    current = pl.read_parquet(env.store_root / "current" / "trial.parquet")
    assert sorted(current["nct_id"].to_list()) == ids
    assert not set(OFF_TOPIC) & set(trial_files)
    site_text = "".join(p.read_text() for p in env.site_dir.rglob("*.json"))
    assert not any(o in site_text for o in OFF_TOPIC)

    sidecar = json.loads((env.raw_dir / "2026-03-01.meta.json").read_text())
    assert sidecar["data_timestamp"] == TS1
    assert sidecar["fetched_at"] == "2026-03-01T07:18:00Z"
    assert not (env.raw_dir / ".incoming").exists() or not any(
        (env.raw_dir / ".incoming").iterdir()
    )

    log = env.store.run_log()
    assert log["status"].to_list() == ["success"]
    row = log.row(0, named=True)
    assert row["run_id"] == "run-1"
    assert row["data_timestamp"] == TS1
    assert row["rows_ingested"] == len(studies)
    assert row["changes_detected"] == 0
    assert json.loads(row["warnings"]) == []
    assert env.store.snapshots().height == len(ids)
    assert env.store.changes().height == 0


# ----- day 2 -----


def test_same_timestamp_is_skipped_and_site_unchanged(env: Env, cfg: AreaConfig) -> None:
    env.run(FakeClient(TS1, day1_studies(cfg)), D1)
    site_before = tree_bytes(env.site_dir)
    client = FakeClient(TS1, day2_studies(cfg))

    result = env.run(client, D2)

    assert result == RunResult("skipped", 0, [], [])
    assert client.fetches == 0
    assert tree_bytes(env.site_dir) == site_before
    assert not (env.raw_dir / "2026-03-02.jsonl.gz").exists()
    log = env.store.run_log()
    assert log["status"].to_list() == ["success", "skipped"]
    assert log["data_timestamp"].to_list() == [TS1, TS1]


def test_day2_edits_produce_expected_change_rows(env: Env, cfg: AreaConfig) -> None:
    env.run(FakeClient(TS1, day1_studies(cfg)), D1)
    result = env.run(FakeClient(TS2, day2_studies(cfg)), D2)

    assert result.status == "success"
    assert result.changes == 4
    changes = env.store.changes()
    got = {
        (r["nct_id"], r["field"]): (r["notable"], r["notable_reason"], r["delta_days"])
        for r in changes.iter_rows(named=True)
    }
    assert got == {
        (STATUS_EDIT, "overall_status"): (True, "status_change", None),
        (DATE_EDIT, "primary_completion_date"): (True, "date_slip_ge_90d", 120),
        (REMOVED, "_tracked"): (False, None, None),
        (ADDED, "_tracked"): (False, None, None),
    }
    assert COSMETIC not in changes["nct_id"].to_list()
    assert changes["detected_date"].unique().to_list() == [D2]

    feed = json.loads((env.site_dir / "changes" / "1d.json").read_text())
    assert {(c["nct_id"], c["field"]) for c in feed["changes"]} == set(got)
    assert {c["nct_id"] for c in feed["changes"] if c["notable"]} == {STATUS_EDIT, DATE_EDIT}
    assert not (env.site_dir / "trials" / f"{REMOVED}.json").exists()
    assert (env.site_dir / "trials" / f"{ADDED}.json").exists()
    meta = json.loads((env.site_dir / "meta.json").read_text())
    assert meta["data_timestamp"] == TS2
    assert env.store.run_log()["changes_detected"].to_list() == [0, 4]


def test_force_rerun_is_idempotent(env: Env, cfg: AreaConfig) -> None:
    two_days(env, cfg)
    changes, snaps = env.store.changes(), env.store.snapshots()
    site = tree_bytes(env.site_dir, exclude=("meta.json",))

    result = env.run(FakeClient(TS2, day2_studies(cfg)), D2, force=True)

    assert result.status == "success"
    assert result.changes == 4
    assert env.store.changes().equals(changes)
    assert env.store.snapshots().equals(snaps)
    assert snaps.filter(pl.col("snapshot_date") == D2).height == len(
        relevant_ids(cfg, day2_studies(cfg))
    )
    assert not env.store.snapshots().select("nct_id", "snapshot_date").is_duplicated().any()
    assert tree_bytes(env.site_dir, exclude=("meta.json",)) == site
    assert env.store.run_log()["status"].to_list() == ["success"] * 3


def test_same_day_rerun_with_new_timestamp_replaces_that_day(env: Env, cfg: AreaConfig) -> None:
    two_days(env, cfg)
    result = env.run(FakeClient("2026-03-02T12:00:00", day2_studies(cfg)), D2)
    assert result.changes == 4
    assert env.store.changes().height == 4


def test_alias_edit_between_days_emits_no_changes(env: Env, cfg: AreaConfig) -> None:
    studies = day1_studies(cfg)
    env.run(FakeClient(TS1, studies), D1)
    (env.aliases_dir / "sponsor.csv").write_text(
        "raw,normalized\nExample Pharma,Example Pharmaceuticals Inc\n", encoding="utf-8"
    )
    (env.aliases_dir / "intervention.csv").write_text(
        "raw,normalized\nExample Drug,exampledrugmab\n", encoding="utf-8"
    )

    result = env.run(FakeClient(TS2, studies), D2)

    assert result == RunResult("success", 0, [], [])
    assert env.store.changes().height == 0
    doc = json.loads((env.site_dir / "trials" / "NCT90000001.json").read_text())
    assert doc["lead_sponsor"] == "Example Pharmaceuticals Inc"


# ----- failures: bad data never replaces good data -----


@pytest.mark.parametrize(
    "path",
    [
        ("identificationModule", "briefTitle"),
        ("identificationModule", "nctId"),
    ],
    ids=["missing-briefTitle", "missing-nctId"],
)
def test_malformed_day3_fails_and_leaves_store_and_site_untouched(
    env: Env, cfg: AreaConfig, path: tuple[str, ...]
) -> None:
    two_days(env, cfg)
    store_before, site_before = store_tree(env), tree_bytes(env.site_dir)
    studies = day2_studies(cfg)
    drop_study(studies, "NCT90000005", path)

    result = env.run(FakeClient(TS3, studies), D3)

    assert result.status == "failed"
    assert result.changes == 0
    assert any(e.startswith("schema:") and path[-1] in e for e in result.errors)
    assert store_tree(env) == store_before
    assert tree_bytes(env.site_dir) == site_before
    assert not (env.raw_dir / "2026-03-03.jsonl.gz").exists()
    assert not (env.raw_dir / "2026-03-03.meta.json").exists()
    failed = env.raw_dir / "2026-03-03.failed.jsonl.gz"
    assert len(read_snapshot(failed)) == len(studies)
    assert (
        json.loads((env.raw_dir / "2026-03-03.failed.meta.json").read_text())["data_timestamp"]
        == TS3
    )
    log = env.store.run_log()
    assert log["status"].to_list() == ["success", "success", "failed"]
    last = log.row(-1, named=True)
    assert last["data_timestamp"] == TS3
    assert any("schema:" in w for w in json.loads(last["warnings"]))
    assert env.store.last_success_timestamp() == TS2


def test_normalize_exception_is_a_data_failure(env: Env, cfg: AreaConfig) -> None:
    two_days(env, cfg)
    store_before, site_before = store_tree(env), tree_bytes(env.site_dir)
    studies = day2_studies(cfg)
    for s in studies:
        if nct(s) == "NCT90000005":
            s["protocolSection"]["statusModule"]["startDateStruct"]["date"] = "2024-13"

    result = env.run(FakeClient(TS3, studies), D3)

    assert result.status == "failed"
    assert any("invalid ClinicalTrials.gov date" in e for e in result.errors)
    assert store_tree(env) == store_before
    assert tree_bytes(env.site_dir) == site_before
    assert (env.raw_dir / "2026-03-03.failed.jsonl.gz").exists()
    assert not (env.raw_dir / "2026-03-03.jsonl.gz").exists()


def test_failed_rerun_of_a_good_day_keeps_its_good_snapshot(env: Env, cfg: AreaConfig) -> None:
    two_days(env, cfg)
    good = (env.raw_dir / "2026-03-02.jsonl.gz").read_bytes()
    studies = day2_studies(cfg)
    drop_study(studies, "NCT90000005", ("identificationModule", "briefTitle"))

    assert env.run(FakeClient("2026-03-02T12:00:00", studies), D2).status == "failed"

    assert (env.raw_dir / "2026-03-02.jsonl.gz").read_bytes() == good
    assert (env.raw_dir / "2026-03-02.failed.jsonl.gz").exists()


def test_large_row_drop_fails_unless_accepted(env: Env, cfg: AreaConfig) -> None:
    two_days(env, cfg)
    store_before, site_before = store_tree(env), tree_bytes(env.site_dir)
    studies = day2_studies(cfg)
    keep = relevant_ids(cfg, studies)[:8]
    small = [s for s in studies if nct(s) in keep or nct(s) in OFF_TOPIC]

    failed = env.run(FakeClient(TS3, small), D3)

    assert failed.status == "failed"
    assert [e for e in failed.errors if e.startswith("row_drop_error:")]
    assert store_tree(env) == store_before
    assert tree_bytes(env.site_dir) == site_before
    assert (env.raw_dir / "2026-03-03.failed.jsonl.gz").exists()

    accepted = env.run(FakeClient(TS3, small), D3, accept_drop=True)

    assert accepted.status == "success"
    assert accepted.errors == []
    assert any(w.startswith("row_drop_error:") for w in accepted.warnings)
    assert accepted.changes == len(relevant_ids(cfg, studies)) - 8
    assert (env.raw_dir / "2026-03-03.jsonl.gz").exists()
    meta = json.loads((env.site_dir / "meta.json").read_text())
    assert any(w.startswith("row_drop_error:") for w in meta["warnings"])
    sidecar = json.loads((env.raw_dir / "2026-03-03.meta.json").read_text())
    assert sidecar["accept_drop"] is True


def test_accept_drop_demotes_nothing_else(env: Env, cfg: AreaConfig) -> None:
    two_days(env, cfg)
    studies = day2_studies(cfg)
    drop_study(studies, "NCT90000005", ("identificationModule", "briefTitle"))
    result = env.run(FakeClient(TS3, studies), D3, accept_drop=True)
    assert result.status == "failed"


def test_export_failure_fails_and_is_not_skipped_on_rerun(
    env: Env, cfg: AreaConfig, monkeypatch: pytest.MonkeyPatch
) -> None:
    env.run(FakeClient(TS1, day1_studies(cfg)), D1)

    def boom(*args: Any, **kwargs: Any) -> None:
        raise OSError("disk full")

    monkeypatch.setattr(pipeline, "export", boom)
    result = env.run(FakeClient(TS2, day2_studies(cfg)), D2)

    assert result.status == "failed"
    assert any("disk full" in e for e in result.errors)
    log = env.store.run_log()
    assert log["status"].to_list() == ["success", "failed"]
    assert env.store.last_success_timestamp() == TS1
    # The data was fine: the snapshot is kept, not quarantined.
    assert (env.raw_dir / "2026-03-02.jsonl.gz").exists()
    assert not (env.raw_dir / "2026-03-02.failed.jsonl.gz").exists()

    monkeypatch.undo()
    rerun = env.run(FakeClient(TS2, day2_studies(cfg)), D2)

    assert rerun.status == "success"
    assert rerun.changes == 4
    assert env.store.changes().height == 4
    assert json.loads((env.site_dir / "meta.json").read_text())["data_timestamp"] == TS2


@pytest.mark.parametrize("stage", ["data_timestamp", "iter_studies"])
def test_network_failure_writes_nothing_but_a_failed_row(
    env: Env, cfg: AreaConfig, stage: str
) -> None:
    env.run(FakeClient(TS1, day1_studies(cfg)), D1)
    store_before, site_before = store_tree(env), tree_bytes(env.site_dir)
    raw_before = tree_bytes(env.raw_dir)
    client = FakeClient(TS2, day2_studies(cfg), fail_on=stage, exc=CtGovError("HTTP 503"))

    result = env.run(client, D2)

    assert result.status == "failed"
    assert result.errors == ["CtGovError: HTTP 503"]
    assert store_tree(env) == store_before
    assert tree_bytes(env.site_dir) == site_before
    assert tree_bytes(env.raw_dir) == raw_before
    last = env.store.run_log().row(-1, named=True)
    assert last["status"] == "failed"
    assert last["data_timestamp"] == (None if stage == "data_timestamp" else TS2)


def test_corrupt_store_fails_without_quarantining(env: Env, cfg: AreaConfig) -> None:
    env.run(FakeClient(TS1, day1_studies(cfg)), D1)
    (env.store_root / "current" / "trial.parquet").write_bytes(b"not parquet")
    site_before = tree_bytes(env.site_dir)

    result = env.run(FakeClient(TS2, day2_studies(cfg)), D2)

    assert result.status == "failed"
    assert any(e.startswith("StoreError:") for e in result.errors)
    assert tree_bytes(env.site_dir) == site_before
    assert not (env.raw_dir / "2026-03-02.failed.jsonl.gz").exists()
    assert not (env.raw_dir / "2026-03-02.jsonl.gz").exists()
    assert env.store.run_log()["status"].to_list() == ["success", "failed"]


def test_failure_recording_never_raises(env: Env, cfg: AreaConfig) -> None:
    env.run(FakeClient(TS1, day1_studies(cfg)), D1)
    (env.store_root / RUN_LOG).write_bytes(b"garbage")

    result = env.run(FakeClient(TS2, day2_studies(cfg)), D2)

    assert result.status == "failed"
    assert result.errors


# ----- logging -----


def test_each_stage_logs_one_json_line(
    env: Env, cfg: AreaConfig, capsys: pytest.CaptureFixture[str]
) -> None:
    env.run(FakeClient(TS1, day1_studies(cfg)), D1)
    lines = [json.loads(line) for line in capsys.readouterr().err.splitlines() if line]
    assert [ln["stage"] for ln in lines] == [
        "rewind_check",
        "data_timestamp",
        "fetch",
        "snapshot",
        "check_raw",
        "filter_relevant",
        "normalize",
        "state_before",
        "quality",
        "diff",
        "store",
        "export",
        "run_log",
    ]
    for ln in lines:
        assert {"stage", "duration_s", "rows", "warnings"} <= set(ln)
        assert isinstance(ln["duration_s"], float)
        assert isinstance(ln["warnings"], list)
    by_stage = {ln["stage"]: ln for ln in lines}
    studies = day1_studies(cfg)
    assert by_stage["fetch"]["rows"] == len(studies)
    assert by_stage["filter_relevant"]["rows"] == len(relevant_ids(cfg, studies))


def test_failed_stage_logs_its_error(
    env: Env, cfg: AreaConfig, capsys: pytest.CaptureFixture[str]
) -> None:
    client = FakeClient(TS1, day1_studies(cfg), fail_on="iter_studies", exc=CtGovError("x"))
    env.run(client, D1)
    lines = [json.loads(line) for line in capsys.readouterr().err.splitlines() if line]
    assert [ln["stage"] for ln in lines] == ["rewind_check", "data_timestamp", "fetch", "run_log"]
    assert lines[2]["error"] == "CtGovError: x"
    assert lines[3]["status"] == "failed"
    assert lines[3]["warnings"] == ["CtGovError: x"]


def test_snapshot_is_gzip_jsonl(env: Env, cfg: AreaConfig) -> None:
    env.run(FakeClient(TS1, day1_studies(cfg)), D1)
    with gzip.open(env.raw_dir / "2026-03-01.jsonl.gz", "rt") as f:
        assert len(f.read().splitlines()) == len(day1_studies(cfg))


def test_store_path_is_untouched_when_raw_dir_is_relative(
    tmp_path: Path, cfg: AreaConfig, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.chdir(tmp_path)
    env = Env(tmp_path, cfg)
    env.raw_dir = Path("raw")
    assert env.run(FakeClient(TS1, day1_studies(cfg)), D1).status == "success"
    assert (tmp_path / "raw" / "2026-03-01.jsonl.gz").exists()


# ----- promotion only after the store write; no rewinds (fix round 1) -----


def test_past_date_force_after_a_later_day_fails_before_fetching(
    env: Env, cfg: AreaConfig, tmp_path: Path
) -> None:
    from trialradar.pipeline import rebuild
    from trialradar.store import Store

    two_days(env, cfg)
    raw_before, store_before = tree_bytes(env.raw_dir), store_tree(env)
    site_before = tree_bytes(env.site_dir)
    client = FakeClient(TS3, day2_studies(cfg))

    result = env.run(client, D1, force=True)

    assert result.status == "failed"
    assert client.fetches == 0
    assert any("2026-03-02" in e and "2026-03-01" in e for e in result.errors)
    assert tree_bytes(env.raw_dir) == raw_before
    assert store_tree(env) == store_before
    assert tree_bytes(env.site_dir) == site_before
    assert env.store.run_log()["status"].to_list() == ["success", "success", "failed"]

    rebuild(cfg, tmp_path / "rb", env.raw_dir, tmp_path / "rb-site", env.aliases_dir)
    assert Store(tmp_path / "rb").changes().equals(env.store.changes())
    assert Store(tmp_path / "rb").snapshots().equals(env.store.snapshots())


def test_backfilling_a_network_failed_day_is_refused(env: Env, cfg: AreaConfig) -> None:
    env.run(FakeClient(TS1, day1_studies(cfg)), D1)
    down = FakeClient(TS2, day2_studies(cfg), fail_on="iter_studies", exc=CtGovError("HTTP 503"))
    assert env.run(down, D2).status == "failed"
    assert env.run(FakeClient(TS3, day2_studies(cfg)), D3).status == "success"
    raw_before = tree_bytes(env.raw_dir)

    backfill = FakeClient("2026-03-03T09:00:00", day2_studies(cfg))
    result = env.run(backfill, D2)

    assert result.status == "failed"
    assert backfill.fetches == 0
    assert tree_bytes(env.raw_dir) == raw_before
    assert not (env.raw_dir / "2026-03-02.jsonl.gz").exists()


def test_store_failure_on_same_day_rerun_keeps_the_good_snapshot(
    env: Env, cfg: AreaConfig, monkeypatch: pytest.MonkeyPatch
) -> None:
    from trialradar.store import Store

    two_days(env, cfg)
    good = {
        n: (env.raw_dir / n).read_bytes() for n in ("2026-03-02.jsonl.gz", "2026-03-02.meta.json")
    }
    newer = day2_studies(cfg)
    newer[0]["protocolSection"]["designModule"]["enrollmentInfo"]["count"] = 4321

    def boom(self: Store, *args: Any, **kwargs: Any) -> None:
        raise OSError("disk full")

    with monkeypatch.context() as m:
        m.setattr(Store, "save_state", boom)
        result = env.run(FakeClient("2026-03-02T12:00:00", newer), D2)

    assert result.status == "failed"
    for name, data in good.items():
        assert (env.raw_dir / name).read_bytes() == data
    assert not (env.raw_dir / "2026-03-02.failed.jsonl.gz").exists()
    staged = env.raw_dir / ".incoming" / "2026-03-02.jsonl.gz"
    assert read_snapshot(staged) == newer

    assert env.run(FakeClient(TS3, day2_studies(cfg)), D3).status == "success"
    incoming = env.raw_dir / ".incoming"
    assert not incoming.exists() or not any(incoming.iterdir())


def test_snapshot_is_promoted_before_its_sidecar(
    env: Env, cfg: AreaConfig, monkeypatch: pytest.MonkeyPatch
) -> None:
    import os

    moves: list[str] = []
    real = os.replace

    def spy(src: Any, dst: Any) -> None:
        if Path(dst).parent == env.raw_dir:
            moves.append(Path(dst).name)
        real(src, dst)

    monkeypatch.setattr(os, "replace", spy)
    assert env.run(FakeClient(TS1, day1_studies(cfg)), D1).status == "success"
    assert moves == ["2026-03-01.jsonl.gz", "2026-03-01.meta.json"]
