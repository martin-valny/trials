"""``rebuild`` replays raw snapshots and must reproduce the incremental history."""

from __future__ import annotations

import json
from datetime import date, datetime
from pathlib import Path
from typing import Any

import polars as pl
import pytest

from trialradar import pipeline
from trialradar.config import AreaConfig
from trialradar.pipeline import RebuildError, rebuild
from trialradar.store import Store

from .conftest import (
    Env,
    FakeClient,
    day1_studies,
    day2_studies,
    nct,
    relevant_ids,
    tree_bytes,
    without_coords,
    without_intro_coords,
)
from .test_pipeline import D1, D2, D3, TS1, TS2, TS3, drop_study

D4 = date(2026, 3, 4)
TS4 = "2026-03-04T06:00:00"


def day3_studies(cfg: AreaConfig) -> list[dict[str, Any]]:
    studies = day2_studies(cfg)
    for s in studies:
        if nct(s) == "NCT90000005":
            s["protocolSection"]["designModule"]["enrollmentInfo"]["count"] = 150
    return studies


def rebuilt(env: Env, tmp_path: Path) -> tuple[Store, Path]:
    root, site = tmp_path / "rebuilt-data", tmp_path / "rebuilt-site"
    rebuild(env.cfg, root, env.raw_dir, site, env.aliases_dir)
    return Store(root), site


def assert_same_history(a: Store, b: Store) -> None:
    assert a.changes().equals(b.changes())
    assert a.snapshots().equals(b.snapshots())


def assert_same_site(a: Path, b: Path) -> None:
    # A rebuild lays the map out afresh (no previous coordinates, spec 6.4a), so
    # only the explorer coordinates may differ from the incremental site.
    skip = ("meta.json", "explorer.json", "intro.json")
    assert tree_bytes(a, exclude=skip) == tree_bytes(b, exclude=skip)
    assert without_coords(a) == without_coords(b)
    assert without_intro_coords(a) == without_intro_coords(b)


def test_rebuild_equals_incremental_after_a_failed_day(
    env: Env, cfg: AreaConfig, tmp_path: Path
) -> None:
    env.run(FakeClient(TS1, day1_studies(cfg)), D1)
    env.run(FakeClient(TS2, day2_studies(cfg)), D2)
    bad = day3_studies(cfg)
    drop_study(bad, "NCT90000006", ("identificationModule", "briefTitle"))
    assert env.run(FakeClient(TS3, bad), D3).status == "failed"
    assert env.run(FakeClient(TS4, day3_studies(cfg)), D4).status == "success"

    store, site = rebuilt(env, tmp_path)

    assert_same_history(store, env.store)
    assert env.store.changes().height == 5  # 4 on day 2, 1 enrollment change on day 4
    assert_same_site(site, env.site_dir)
    log = store.run_log()
    assert log["status"].to_list() == ["success"] * 3
    assert log["data_timestamp"].to_list() == [TS1, TS2, TS4]
    assert log["started_at"].to_list() == [datetime(2026, 3, d) for d in (1, 2, 4)]
    assert log["changes_detected"].to_list() == [0, 4, 1]
    n1, n2 = len(day1_studies(cfg)), len(day2_studies(cfg))
    assert log["rows_ingested"].to_list() == [n1, n2, n2]
    assert json.loads(log["warnings"][0]) == []
    meta = json.loads((site / "meta.json").read_text())
    assert meta["data_timestamp"] == TS4
    assert meta["generated_for"] == D4.isoformat()
    assert meta["last_success_at"] == "2026-03-04T00:00:00Z"


def test_rebuild_after_force_rerun_and_export_failure(
    env: Env, cfg: AreaConfig, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env.run(FakeClient(TS1, day1_studies(cfg)), D1)
    with monkeypatch.context() as m:
        m.setattr(pipeline, "export", lambda *a, **k: (_ for _ in ()).throw(OSError("x")))
        assert env.run(FakeClient(TS2, day2_studies(cfg)), D2).status == "failed"
    env.run(FakeClient(TS2, day2_studies(cfg)), D2)
    env.run(FakeClient(TS2, day2_studies(cfg)), D2, force=True)

    store, site = rebuilt(env, tmp_path)

    assert_same_history(store, env.store)
    assert_same_site(site, env.site_dir)


def test_rebuild_honours_an_accepted_drop(env: Env, cfg: AreaConfig, tmp_path: Path) -> None:
    env.run(FakeClient(TS1, day1_studies(cfg)), D1)
    studies = day1_studies(cfg)
    keep = relevant_ids(cfg, studies)[:6]
    small = [s for s in studies if nct(s) in keep]
    removed = len(relevant_ids(cfg, studies)) - len(keep)
    assert env.run(FakeClient(TS2, small), D2).status == "failed"
    assert env.run(FakeClient(TS2, small), D2, accept_drop=True).status == "success"

    store, site = rebuilt(env, tmp_path)

    assert_same_history(store, env.store)
    assert store.changes().height == removed
    assert_same_site(site, env.site_dir)


def test_rebuild_in_place_reproduces_the_store(env: Env, cfg: AreaConfig) -> None:
    env.run(FakeClient(TS1, day1_studies(cfg)), D1)
    env.run(FakeClient(TS2, day2_studies(cfg)), D2)
    changes, snaps = env.store.changes(), env.store.snapshots()
    (env.store_root / "current" / "trial.parquet").write_bytes(b"corrupt")
    (env.store_root / ".git").mkdir()
    (env.store_root / ".git" / "HEAD").write_text("ref: refs/heads/data\n")

    rebuild(env.cfg, env.store_root, env.raw_dir, env.site_dir, env.aliases_dir)

    assert env.store.changes().equals(changes)
    assert env.store.snapshots().equals(snaps)
    assert env.store.state_before(date(2026, 3, 3)) is not None
    assert env.store.run_log()["status"].to_list() == ["success", "success"]
    # Only store-owned entries are wiped: an enclosing git checkout survives.
    assert (env.store_root / ".git" / "HEAD").exists()


@pytest.mark.parametrize("raw", ["missing", "empty"])
def test_rebuild_refuses_without_snapshots_and_keeps_the_store(
    env: Env, cfg: AreaConfig, tmp_path: Path, raw: str
) -> None:
    env.run(FakeClient(TS1, day1_studies(cfg)), D1)
    raw_dir = tmp_path / "nothing"
    if raw == "empty":
        raw_dir.mkdir()
    before = tree_bytes(env.store_root)
    site_before = tree_bytes(env.site_dir)

    with pytest.raises(RebuildError, match="no raw snapshots"):
        rebuild(env.cfg, env.store_root, raw_dir, env.site_dir, env.aliases_dir)

    assert tree_bytes(env.store_root) == before
    assert tree_bytes(env.site_dir) == site_before


def test_rebuild_refuses_an_incomplete_raw_set_unless_forced(env: Env, cfg: AreaConfig) -> None:
    env.run(FakeClient(TS1, day1_studies(cfg)), D1)
    env.run(FakeClient(TS2, day2_studies(cfg)), D2)
    (env.raw_dir / "2026-03-01.jsonl.gz").unlink()  # only day 2 downloaded
    before = tree_bytes(env.store_root)

    with pytest.raises(RebuildError, match="would drop the earlier days"):
        rebuild(env.cfg, env.store_root, env.raw_dir, env.site_dir, env.aliases_dir)
    assert tree_bytes(env.store_root) == before

    rebuild(env.cfg, env.store_root, env.raw_dir, env.site_dir, env.aliases_dir, force=True)
    assert Store(env.store_root).run_log()["data_timestamp"].to_list() == [TS2]


def test_rebuild_with_no_replayable_day_keeps_the_store(env: Env, cfg: AreaConfig) -> None:
    env.run(FakeClient(TS1, day1_studies(cfg)), D1)
    before = tree_bytes(env.store_root)
    (env.raw_dir / "2026-03-01.jsonl.gz").write_bytes(b"not gzip")

    with pytest.raises(RebuildError, match="could be replayed"):
        rebuild(env.cfg, env.store_root, env.raw_dir, env.site_dir, env.aliases_dir, force=True)

    assert tree_bytes(env.store_root) == before
    assert not [p for p in env.store_root.parent.iterdir() if p.name.startswith(".rebuild-")]


def test_rebuild_keeps_the_gate_warnings_of_an_accepted_drop(
    env: Env, cfg: AreaConfig, tmp_path: Path
) -> None:
    env.run(FakeClient(TS1, day1_studies(cfg)), D1)
    studies = day1_studies(cfg)
    keep = relevant_ids(cfg, studies)[:6]
    small = [s for s in studies if nct(s) in keep]
    env.run(FakeClient(TS2, small), D2, accept_drop=True)

    store, site = rebuilt(env, tmp_path)

    incremental = json.loads(env.store.run_log()["warnings"][-1])
    assert any(w.startswith("row_drop_error:") for w in incremental)
    assert json.loads(store.run_log()["warnings"][-1]) == incremental
    assert json.loads((site / "meta.json").read_text())["warnings"] == incremental


def test_rebuild_skips_unreadable_and_failing_days(
    env: Env, cfg: AreaConfig, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    env.run(FakeClient(TS1, day1_studies(cfg)), D1)
    env.run(FakeClient(TS2, day2_studies(cfg)), D2)
    expected = env.store.changes()
    (env.raw_dir / "2026-03-03.jsonl.gz").write_bytes(b"not gzip")
    bad = day2_studies(cfg)
    drop_study(bad, "NCT90000006", ("statusModule", "overallStatus"))
    from trialradar.snapshot import write_snapshot

    write_snapshot(env.raw_dir, D4, bad)  # bypassed the gate somehow; no sidecar
    capsys.readouterr()

    store, _ = rebuilt(env, tmp_path)

    assert store.changes().equals(expected)
    lines = [json.loads(ln) for ln in capsys.readouterr().err.splitlines() if ln]
    skips = [ln for ln in lines if ln["stage"] == "rebuild_skip"]
    assert [s["day"] for s in skips] == ["2026-03-03", "2026-03-04"]
    assert any("schema:" in w for w in skips[1]["warnings"])
    assert store.run_log()["data_timestamp"].to_list() == [TS1, TS2]


def test_rebuild_without_sidecar_uses_empty_timestamp(
    env: Env, cfg: AreaConfig, tmp_path: Path
) -> None:
    env.run(FakeClient(TS1, day1_studies(cfg)), D1)
    (env.raw_dir / "2026-03-01.meta.json").unlink()

    store, site = rebuilt(env, tmp_path)

    assert store.run_log()["data_timestamp"].to_list() == [""]
    assert store.snapshots().equals(env.store.snapshots())
    assert json.loads((site / "meta.json").read_text())["data_timestamp"] == ""


def test_failed_snapshots_are_not_replayed(env: Env, cfg: AreaConfig, tmp_path: Path) -> None:
    env.run(FakeClient(TS1, day1_studies(cfg)), D1)
    bad = day2_studies(cfg)
    drop_study(bad, "NCT90000006", ("identificationModule", "briefTitle"))
    env.run(FakeClient(TS2, bad), D2)
    assert (env.raw_dir / "2026-03-02.failed.jsonl.gz").exists()

    store, _ = rebuilt(env, tmp_path)

    assert store.snapshots()["snapshot_date"].unique().to_list() == [D1]
    expected = len(relevant_ids(cfg, day1_studies(cfg)))
    assert store.snapshots().filter(pl.col("snapshot_date") == D1).height == expected


def test_rebuild_builds_the_explorer_for_the_last_day_only(
    env: Env, cfg: AreaConfig, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    env.run(FakeClient(TS1, day1_studies(cfg)), D1)
    env.run(FakeClient(TS2, day2_studies(cfg)), D2)
    capsys.readouterr()

    store, site = rebuilt(env, tmp_path)

    lines = [json.loads(ln) for ln in capsys.readouterr().err.splitlines() if ln]
    explorer = [ln for ln in lines if ln["stage"] == "explorer"]
    assert [ln["day"] for ln in explorer] == [D2.isoformat()]
    doc = json.loads((site / "explorer.json").read_text(encoding="utf-8"))
    assert doc["generated_for"] == D2.isoformat()
    ids = relevant_ids(cfg, day2_studies(cfg))
    assert sorted(store.load_explorer_coords()) == ids
    assert [t["nct_id"] for t in doc["trials"]] == ids


def test_rebuild_survives_an_explorer_failure(
    env: Env, cfg: AreaConfig, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """R19: the rebuild still swaps in the store and exports the site, without a map
    (a stale explorer.json is removed) and without saved coordinates; the last day's
    run_log row carries the warning."""
    env.run(FakeClient(TS1, day1_studies(cfg)), D1)
    env.run(FakeClient(TS2, day2_studies(cfg)), D2)
    root, site = tmp_path / "rebuilt-data", tmp_path / "rebuilt-site"
    site.mkdir()
    (site / "explorer.json").write_text("{}", encoding="utf-8")

    def boom(*args: Any, **kwargs: Any) -> None:
        raise RuntimeError("umap exploded")

    monkeypatch.setattr(pipeline, "build_explorer", boom)
    rebuild(env.cfg, root, env.raw_dir, site, env.aliases_dir)

    assert not (site / "explorer.json").exists()
    assert (site / "trials.json").exists()
    store = Store(root)
    assert store.load_explorer_coords() == {}
    last = json.loads(store.run_log().row(-1, named=True)["warnings"])
    assert "explorer: RuntimeError: umap exploded" in last
    meta = json.loads((site / "meta.json").read_text(encoding="utf-8"))
    assert "explorer: RuntimeError: umap exploded" in meta["warnings"]


def test_rebuild_writes_risk_json(env: Env, cfg: AreaConfig, tmp_path: Path) -> None:
    env.run(FakeClient(TS1, day1_studies(cfg)), D1)
    env.run(FakeClient(TS2, day2_studies(cfg)), D2)
    _, site = rebuilt(env, tmp_path)
    doc = json.loads((site / "risk.json").read_text(encoding="utf-8"))
    assert doc["generated_for"] == D2.isoformat()
    assert doc["model"]["version"] == "stop-risk-fixture"
