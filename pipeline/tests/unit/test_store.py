from __future__ import annotations

import json
import os
import shutil
from datetime import date, datetime
from pathlib import Path
from typing import Any

import polars as pl
import pytest
from conftest import REPO_ROOT

from trialradar import store as store_mod
from trialradar.diff import TRIAL_CHANGE_SCHEMA
from trialradar.normalize import normalize
from trialradar.store import RUN_LOG_SCHEMA, SNAPSHOT_SCHEMA, Store, StoreError, _read_state_dir
from trialradar.tables import SCHEMAS, Tables

ALIASES = REPO_ROOT / "config" / "aliases"
SAMPLE = REPO_ROOT / "pipeline" / "tests" / "fixtures" / "studies" / "sample20.jsonl"
D1, D2, D3, D4, D5, D6 = (date(2026, 1, d) for d in range(1, 7))


@pytest.fixture(scope="module")
def sample_tables() -> Tables:
    studies = [json.loads(ln) for ln in SAMPLE.read_text().splitlines() if ln.strip()]
    return normalize(studies, ALIASES)


def tables_with(n: int) -> Tables:
    e = Tables.empty()
    trial = pl.DataFrame({"nct_id": [f"NCT{i:08d}" for i in range(n)]}, schema={"nct_id": pl.Utf8})
    trial = trial.join(pl.DataFrame(schema=SCHEMAS["trial"]), on="nct_id", how="left")
    return Tables(
        trial.select(list(SCHEMAS["trial"])),
        e.condition,
        e.intervention,
        e.sponsor,
        e.site,
        e.outcome,
    )


def assert_tables_equal(a: Tables, b: Tables) -> None:
    for name in SCHEMAS:
        fa, fb = getattr(a, name), getattr(b, name)
        assert fa.schema == fb.schema, name
        assert fa.equals(fb), name


def change(nct: str, field: str, day: date) -> dict[str, Any]:
    return {
        "nct_id": nct,
        "field": field,
        "old_value": "a",
        "new_value": "b",
        "detected_date": day,
        "registry_update_date": None,
        "delta_days": None,
        "notable": False,
        "notable_reason": None,
    }


def changes_df(*rows: dict[str, Any]) -> pl.DataFrame:
    return pl.DataFrame(list(rows), schema=TRIAL_CHANGE_SCHEMA)


def snaps_df(*rows: tuple[str, date, str]) -> pl.DataFrame:
    return pl.DataFrame(
        [{"nct_id": n, "snapshot_date": d, "tracked_hash": h} for n, d, h in rows],
        schema=SNAPSHOT_SCHEMA,
    )


def run_row(started: datetime, status: str, ts: str | None) -> dict[str, Any]:
    return {
        "run_id": f"r-{started.isoformat()}",
        "started_at": started,
        "duration_s": 1.5,
        "status": status,
        "data_timestamp": ts,
        "rows_ingested": 3,
        "changes_detected": 1,
        "warnings": "[]",
    }


def test_empty_root(tmp_path: Path) -> None:
    s = Store(tmp_path / "data")
    assert s.state_before(D1) is None
    assert s.changes().schema == TRIAL_CHANGE_SCHEMA and s.changes().height == 0
    assert s.snapshots().schema == SNAPSHOT_SCHEMA and s.snapshots().height == 0
    assert s.run_log().schema == RUN_LOG_SCHEMA and s.run_log().height == 0
    assert s.last_success_timestamp() is None


def test_roundtrip_sample20(tmp_path: Path, sample_tables: Tables) -> None:
    s = Store(tmp_path)
    s.save_state(sample_tables, D1, "2026-01-01T00:00:00")
    got = s.state_before(D2)
    assert got is not None
    tables, day = got
    assert day == D1
    assert_tables_equal(tables, sample_tables)
    assert tables.trial.schema["phases"] == pl.List(pl.Utf8)
    state = json.loads((tmp_path / "current" / "state.json").read_text())
    assert state == {"state_date": "2026-01-01", "data_timestamp": "2026-01-01T00:00:00"}


def test_roundtrip_empty(tmp_path: Path) -> None:
    s = Store(tmp_path)
    s.save_state(Tables.empty(), D1, "t")
    got = s.state_before(D2)
    assert got is not None
    assert_tables_equal(got[0], Tables.empty())


def test_state_before_requires_strictly_earlier(tmp_path: Path) -> None:
    s = Store(tmp_path)
    s.save_state(tables_with(1), D1, "t1")
    assert s.state_before(D1) is None
    got = s.state_before(D2)
    assert got is not None and got[1] == D1


def test_next_day_rotation(tmp_path: Path) -> None:
    s = Store(tmp_path)
    s.save_state(tables_with(1), D1, "t1")
    s.save_state(tables_with(2), D2, "t2")
    got = s.state_before(D2)  # re-run same day diffs against yesterday
    assert got is not None and got[1] == D1 and got[0].trial.height == 1
    got = s.state_before(D3)
    assert got is not None and got[1] == D2 and got[0].trial.height == 2


def test_same_day_overwrite_keeps_previous(tmp_path: Path) -> None:
    s = Store(tmp_path)
    s.save_state(tables_with(1), D1, "t1")
    s.save_state(tables_with(2), D2, "t2")
    s.save_state(tables_with(5), D2, "t2b")
    got = s.state_before(D2)
    assert got is not None and got[1] == D1 and got[0].trial.height == 1
    got = s.state_before(D3)
    assert got is not None and got[0].trial.height == 5
    assert json.loads((tmp_path / "current" / "state.json").read_text())["data_timestamp"] == "t2b"


def test_refuse_rewind(tmp_path: Path) -> None:
    s = Store(tmp_path)
    s.save_state(tables_with(1), D2, "t")
    with pytest.raises(ValueError):
        s.save_state(tables_with(1), D1, "t")
    got = s.state_before(D3)
    assert got is not None and got[1] == D2


def test_crash_while_writing_leaves_old_state(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    s = Store(tmp_path)
    s.save_state(tables_with(1), D1, "t1")
    s.save_state(tables_with(2), D2, "t2")
    calls = {"n": 0}
    real = store_mod._write_parquet

    def boom(df: pl.DataFrame, path: Path) -> None:
        calls["n"] += 1
        if calls["n"] == 3:
            raise RuntimeError("crash")
        real(df, path)

    monkeypatch.setattr(store_mod, "_write_parquet", boom)
    with pytest.raises(RuntimeError):
        s.save_state(tables_with(9), D3, "t3")
    monkeypatch.undo()
    got = s.state_before(D3)
    assert got is not None and got[1] == D2 and got[0].trial.height == 2
    got = s.state_before(D2)
    assert got is not None and got[1] == D1
    # a later save succeeds and cleans leftovers
    s.save_state(tables_with(3), D3, "t3")
    assert not [p for p in tmp_path.iterdir() if p.name.startswith(".")]


def test_crash_between_swaps_falls_back_to_previous(tmp_path: Path) -> None:
    s = Store(tmp_path)
    s.save_state(tables_with(1), D1, "t1")
    s.save_state(tables_with(2), D2, "t2")
    (tmp_path / "current").rename(tmp_path / "gone")  # current missing mid-swap
    got = s.state_before(D3)
    assert got is not None and got[1] == D1


def test_replace_day_idempotent(tmp_path: Path) -> None:
    s = Store(tmp_path)
    c1 = changes_df(change("NCT2", "title", D1), change("NCT1", "title", D1))
    sn1 = snaps_df(("NCT2", D1, "h"), ("NCT1", D1, "h"))
    s.replace_day(D1, c1, sn1)
    s.replace_day(D1, c1, sn1)
    assert s.changes().height == 2 and s.snapshots().height == 2
    s.replace_day(D2, changes_df(change("NCT1", "x", D2)), snaps_df(("NCT1", D2, "h2")))
    s.replace_day(D1, changes_df(change("NCT9", "y", D1)), snaps_df(("NCT9", D1, "h9")))
    ch = s.changes()
    assert ch["nct_id"].to_list() == ["NCT1", "NCT9"]  # sorted by nct_id, field, date
    assert s.snapshots()["snapshot_date"].to_list() == [D1, D2]
    assert s.changes().schema == TRIAL_CHANGE_SCHEMA


def test_replace_day_validates_schema(tmp_path: Path) -> None:
    s = Store(tmp_path)
    with pytest.raises(ValueError):
        s.replace_day(D1, pl.DataFrame({"nct_id": ["a"]}), snaps_df())
    with pytest.raises(ValueError):
        s.replace_day(D1, changes_df(), pl.DataFrame({"nct_id": ["a"]}))
    assert not (tmp_path / "history").exists()


def test_history_bytes_stable(tmp_path: Path) -> None:
    rows = [change("NCT2", "b", D1), change("NCT1", "a", D1)]
    a, b = Store(tmp_path / "a"), Store(tmp_path / "b")
    a.replace_day(D1, changes_df(*rows), snaps_df(("NCT2", D1, "h"), ("NCT1", D1, "h")))
    b.replace_day(D1, changes_df(*reversed(rows)), snaps_df(("NCT1", D1, "h"), ("NCT2", D1, "h")))
    for name in ("trial_change", "trial_snapshot"):
        p = f"history/{name}.parquet"
        assert (tmp_path / "a" / p).read_bytes() == (tmp_path / "b" / p).read_bytes()


def test_run_log_and_last_success(tmp_path: Path) -> None:
    s = Store(tmp_path)
    s.append_run(run_row(datetime(2026, 1, 1, 6), "success", "ts1"))
    s.append_run(run_row(datetime(2026, 1, 3, 6), "failed", None))
    s.append_run(run_row(datetime(2026, 1, 2, 6), "success", "ts2"))
    s.append_run(run_row(datetime(2026, 1, 4, 6), "skipped", "ts4"))
    assert s.run_log().schema == RUN_LOG_SCHEMA and s.run_log().height == 4
    assert s.last_success_timestamp() == "ts2"


def test_last_success_tie_uses_file_order(tmp_path: Path) -> None:
    s = Store(tmp_path)
    t = datetime(2026, 1, 1, 6)
    s.append_run(run_row(t, "success", "first"))
    s.append_run(run_row(t, "success", "second"))
    assert s.last_success_timestamp() == "second"


def test_last_success_none_when_only_failures(tmp_path: Path) -> None:
    s = Store(tmp_path)
    s.append_run(run_row(datetime(2026, 1, 1), "failed", None))
    assert s.last_success_timestamp() is None


def test_append_run_validation(tmp_path: Path) -> None:
    s = Store(tmp_path)
    row = run_row(datetime(2026, 1, 1), "success", "t")
    with pytest.raises(ValueError):
        s.append_run({k: v for k, v in row.items() if k != "status"})
    with pytest.raises(ValueError):
        s.append_run({**row, "extra": 1})
    with pytest.raises(ValueError):
        s.append_run({**row, "warnings": ["a"]})


def test_writes_use_temp_and_replace(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[str] = []
    real = store_mod.os.replace

    def spy(src: Any, dst: Any) -> None:
        seen.append(Path(dst).name)
        real(src, dst)

    monkeypatch.setattr(store_mod.os, "replace", spy)
    s = Store(tmp_path)
    s.append_run(run_row(datetime(2026, 1, 1), "success", "t"))
    s.save_state(tables_with(1), D1, "t")
    assert "run_log.parquet" in seen and "current" in seen
    assert not [p for p in tmp_path.rglob(".*") if p.is_file()]


def _same_day_crash(tmp_path: Path) -> Store:
    s = Store(tmp_path)
    s.save_state(tables_with(2), D2, "t2")
    s.save_state(tables_with(3), D3, "t3")
    os.replace(tmp_path / "current", tmp_path / ".state-old")
    return s


def _dirs(tmp_path: Path) -> list[str]:
    return sorted(p.name for p in tmp_path.iterdir() if p.name.startswith(".state-"))


def test_crashed_swap_state_before_uses_state_old(tmp_path: Path) -> None:
    s = _same_day_crash(tmp_path)
    got = s.state_before(D4)
    assert got is not None and got[1] == D3 and got[0].trial.height == 3
    got = s.state_before(D3)
    assert got is not None and got[1] == D2 and got[0].trial.height == 2


def test_crashed_swap_then_next_day_save(tmp_path: Path) -> None:
    s = _same_day_crash(tmp_path)
    s.save_state(tables_with(4), D4, "t4")
    assert _dirs(tmp_path) == []
    got = s.state_before(D4)
    assert got is not None and got[1] == D3 and got[0].trial.height == 3
    got = s.state_before(D5)
    assert got is not None and got[1] == D4 and got[0].trial.height == 4


def test_crashed_swap_then_same_day_retry(tmp_path: Path) -> None:
    s = _same_day_crash(tmp_path)
    s.save_state(tables_with(7), D3, "t3b")
    assert _dirs(tmp_path) == []
    got = s.state_before(D3)
    assert got is not None and got[1] == D2 and got[0].trial.height == 2
    got = s.state_before(D4)
    assert got is not None and got[1] == D3 and got[0].trial.height == 7


def test_crashed_swap_rewind_check_sees_healed_current(tmp_path: Path) -> None:
    s = _same_day_crash(tmp_path)
    with pytest.raises(ValueError):
        s.save_state(tables_with(1), D2, "t")
    got = s.state_before(D4)
    assert got is not None and got[1] == D3


@pytest.mark.parametrize("damage", ["parquet", "state_json"])
def test_corrupt_current_raises(tmp_path: Path, damage: str) -> None:
    s = Store(tmp_path)
    s.save_state(tables_with(1), D1, "t1")
    s.save_state(tables_with(2), D2, "t2")
    if damage == "parquet":
        (tmp_path / "current" / "site.parquet").unlink()
    else:
        (tmp_path / "current" / "state.json").write_text("garbage{")
    before = sorted(p.name for p in (tmp_path / "previous").iterdir())
    with pytest.raises(StoreError, match="rebuild"):
        s.state_before(D3)
    with pytest.raises(StoreError, match="rebuild"):
        s.save_state(tables_with(3), D3, "t3")
    assert sorted(p.name for p in (tmp_path / "previous").iterdir()) == before
    got = _read_state_dir(tmp_path / "previous")
    assert got is not None and got[1] == D1


def test_first_run(tmp_path: Path) -> None:
    s = Store(tmp_path / "fresh")
    assert s.state_before(D1) is None
    s.save_state(tables_with(1), D1, "t1")
    got = s.state_before(D2)
    assert got is not None and got[1] == D1


def _stale_old_leftover(tmp_path: Path) -> Store:
    """current = D3b, plus a superseded .state-old = D3a (same date, older content)."""
    s = Store(tmp_path)
    s.save_state(tables_with(2), D2, "t2")
    s.save_state(tables_with(4), D3, "t3b")  # same-day overwrite: current is D3b
    # rebuild the leftover: D3a content as .state-old next to the real current
    fake = Store(tmp_path / "fake")
    fake.save_state(tables_with(3), D3, "t3a")
    shutil.copytree(tmp_path / "fake" / "current", tmp_path / ".state-old")
    shutil.rmtree(tmp_path / "fake")
    return s


def test_stale_state_old_ignored_by_state_before(tmp_path: Path) -> None:
    s = _stale_old_leftover(tmp_path)
    got = s.state_before(D4)
    assert got is not None and got[1] == D3 and got[0].trial.height == 4
    got = s.state_before(D3)  # tie D3a/previous must not pick the stale copy
    assert got is not None and got[1] == D2 and got[0].trial.height == 2


def test_stale_state_old_removed_on_save(tmp_path: Path) -> None:
    s = _stale_old_leftover(tmp_path)
    s.save_state(tables_with(5), D4, "t4")
    assert _dirs(tmp_path) == []
    prev = _read_state_dir(tmp_path / "previous")
    assert prev is not None and prev[1] == D3 and prev[0].trial.height == 4


def test_crashed_rotation_recovers_from_previous(tmp_path: Path) -> None:
    s = _stale_old_leftover(tmp_path)
    s.save_state(tables_with(5), D4, "t4")
    # simulate crash in the D5 rotation: previous removed, current -> previous, nothing else
    shutil.rmtree(tmp_path / "previous")
    os.replace(tmp_path / "current", tmp_path / "previous")
    assert _dirs(tmp_path) == []
    got = s.state_before(D6)
    assert got is not None and got[1] == D4 and got[0].trial.height == 5
    s.save_state(tables_with(6), D6, "t6")
    prev = _read_state_dir(tmp_path / "previous")
    assert prev is None or prev[1] == D4


# ----- wipe and rewind guard -----


def test_wipe_removes_only_store_entries(tmp_path: Path) -> None:
    store = Store(tmp_path)
    for name in ("current", "previous", "history", ".state-old", ".state-new-abc", ".git"):
        (tmp_path / name).mkdir()
        (tmp_path / name / "f").write_text("x")
    (tmp_path / "README").write_text("keep")
    store.wipe()
    assert sorted(p.name for p in tmp_path.iterdir()) == [".git", "README"]
    Store(tmp_path / "missing").wipe()  # a missing root is fine


def test_require_no_rewind(tmp_path: Path) -> None:
    from trialradar.tables import Tables

    store = Store(tmp_path)
    store.require_no_rewind(date(2026, 1, 1))  # empty store: anything goes
    store.save_state(Tables.empty(), date(2026, 1, 2), "ts")
    store.require_no_rewind(date(2026, 1, 2))  # same day is a rerun
    store.require_no_rewind(date(2026, 1, 3))
    with pytest.raises(ValueError, match="refusing to rewind state from 2026-01-02 to 2026-01-01"):
        store.require_no_rewind(date(2026, 1, 1))
    with pytest.raises(ValueError, match="refusing to rewind"):
        store.save_state(Tables.empty(), date(2026, 1, 1), "ts")
