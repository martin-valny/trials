"""Store: runs, key pointers, quotas, flags (moto DynamoDB)."""

import json
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from typing import Any

from diligence.config import AgentConfig
from diligence.store import NewRun, Store, cache_key
from diligence.types import RunRecord, Step

NOW = datetime(2026, 11, 9, 12, 0, 0, tzinfo=UTC)


def make_store(cfg: AgentConfig, ddb: Any) -> Store:
    return Store(cfg, resource=ddb, now=lambda: NOW)


def new_run(fp: str = "fp1") -> NewRun:
    return NewRun(target="cd20", disease="MS", fingerprint=fp, started_at="2026-11-09T12:00:00Z")


def key_for(cfg: AgentConfig, fp: str = "fp1") -> str:
    return cache_key("cd20", "MS", fp, cfg.agent_version)


def done_record(run_id: str, fp: str = "fp1", status: str = "done") -> RunRecord:
    return RunRecord.model_validate(
        {
            "run_id": run_id,
            "target": "cd20",
            "disease": "MS",
            "fingerprint": fp,
            "agent_version": "0.1.0",
            "status": status,
            "started_at": "2026-11-09T12:00:00Z",
            "finished_at": "2026-11-09T12:01:00Z",
        }
    )


def test_cache_key_depends_on_every_part() -> None:
    base = cache_key("a", "b", "c", "d")
    assert (
        len(
            {
                base,
                cache_key("x", "b", "c", "d"),
                cache_key("a", "x", "c", "d"),
                cache_key("a", "b", "x", "d"),
                cache_key("a", "b", "c", "x"),
            }
        )
        == 5
    )


def test_create_get_and_finish_roundtrip(cfg: AgentConfig, ddb: Any) -> None:
    store = make_store(cfg, ddb)
    key = key_for(cfg)
    run_id, created = store.create_run(key, new_run())
    assert created
    rec = store.get_run(run_id)
    assert rec is not None and rec.status == "running" and rec.fingerprint == "fp1"
    assert store.get_cached(key) is None  # not done yet
    store.append_step(run_id, Step(n=1, kind="tool", text="one", tool="site_target"))
    store.append_step(run_id, Step(n=2, kind="tool", text="two"))
    rec = store.get_run(run_id)
    assert rec is not None and [s.n for s in rec.steps] == [1, 2]
    store.finish(run_id, done_record(run_id))
    cached = store.get_cached(key)
    assert cached is not None and cached.run_id == run_id and cached.status == "done"
    latest = store.latest_for("cd20", "MS")
    assert latest is not None and latest.run_id == run_id


def test_failed_run_is_not_cached_or_latest(cfg: AgentConfig, ddb: Any) -> None:
    store = make_store(cfg, ddb)
    key = key_for(cfg)
    run_id, _ = store.create_run(key, new_run())
    store.finish(run_id, done_record(run_id, status="failed"))
    assert store.get_cached(key) is None
    assert store.latest_for("cd20", "MS") is None
    rec = store.get_run(run_id)
    assert rec is not None and rec.status == "failed"


def test_concurrent_start_returns_same_run(cfg: AgentConfig, ddb: Any) -> None:
    store = make_store(cfg, ddb)
    key = key_for(cfg)
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _i: store.create_run(key, new_run()), range(8)))
    assert len({rid for rid, _ in results}) == 1
    assert sum(1 for _, created in results if created) == 1
    # Losers leave no orphan run items behind.
    items = ddb.Table(cfg.tables.runs).scan()["Items"]  # type: ignore[attr-defined]
    assert sum(1 for i in items if i["pk"].startswith("run#")) == 1


def test_create_while_running_returns_existing(cfg: AgentConfig, ddb: Any) -> None:
    store = make_store(cfg, ddb)
    key = key_for(cfg)
    first, _ = store.create_run(key, new_run())
    again, created = store.create_run(key, new_run(), replace_finished=True)
    assert again == first and not created
    assert store.running_for(key) == first


def test_force_replaces_finished_pointer_once(cfg: AgentConfig, ddb: Any) -> None:
    store = make_store(cfg, ddb)
    key = key_for(cfg)
    first, _ = store.create_run(key, new_run())
    store.finish(first, done_record(first))
    assert store.running_for(key) is None
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(
            pool.map(lambda _i: store.create_run(key, new_run(), replace_finished=True), range(6))
        )
    assert sum(1 for _, c in results if c) == 1
    new_id = next(rid for rid, c in results if c)
    assert new_id != first and {rid for rid, _ in results} == {new_id}
    # Without replace_finished a done pointer is returned as is.
    again, created = store.create_run(key, new_run())
    assert again == new_id and not created


def test_failed_pointer_is_replaced_without_force(cfg: AgentConfig, ddb: Any) -> None:
    store = make_store(cfg, ddb)
    key = key_for(cfg)
    first, _ = store.create_run(key, new_run())
    store.finish(first, done_record(first, status="failed"))
    second, created = store.create_run(key, new_run())
    assert created and second != first


def test_stale_running_pointer_is_replaceable(cfg: AgentConfig, ddb: Any) -> None:
    early = Store(cfg, resource=ddb, now=lambda: datetime(2026, 11, 9, 11, 0, 0, tzinfo=UTC))
    key = key_for(cfg)
    first, _ = early.create_run(key, new_run())
    store = make_store(cfg, ddb)  # an hour later: the first run never finished
    assert store.running_for(key) is None
    second, created = store.create_run(key, new_run())
    assert created and second != first


def test_quota_per_ip_and_global(cfg: AgentConfig, ddb: Any) -> None:
    store = make_store(cfg, ddb)
    day = "2026-11-09"
    assert [store.take_quota("ip-a", day) for _ in range(3)] == ["ok"] * 3
    assert store.take_quota("ip-a", day) == "ip"
    assert store.take_quota("ip-b", day) == "ok"
    assert store.take_quota("ip-a", "2026-11-10") == "ok"  # new day


def test_global_quota_rolls_back_ip_counter(cfg: AgentConfig, ddb: Any) -> None:
    small = cfg.model_copy(
        update={"daily": cfg.daily.model_copy(update={"global_runs_per_day": 2})}
    )
    store = Store(small, resource=ddb, now=lambda: NOW)
    day = "2026-11-09"
    assert store.take_quota("a", day) == "ok" and store.take_quota("b", day) == "ok"
    assert store.take_quota("c", day) == "global"
    store.refund_quota("a", day)
    assert store.take_quota("c", day) == "ok"  # global slot and c's ip counter were free


def test_quota_items_expire(cfg: AgentConfig, ddb: Any) -> None:
    store = make_store(cfg, ddb)
    store.take_quota("ip-a", "2026-11-09")
    items = ddb.Table(cfg.tables.limits).scan()["Items"]  # type: ignore[attr-defined]
    assert {i["pk"] for i in items} == {"ip#ip-a#2026-11-09", "global#2026-11-09"}
    assert all(int(i["ttl"]) > int(NOW.timestamp()) for i in items)


def test_add_flag_stores_only_the_listed_fields(cfg: AgentConfig, ddb: Any) -> None:
    store = make_store(cfg, ddb)
    store.add_flag("run1", "s3", "looks wrong")
    items: list[dict[str, Any]] = ddb.Table(cfg.tables.flags).scan()["Items"]  # type: ignore[attr-defined]
    assert len(items) == 1
    assert set(items[0]) == {"pk", "run_id", "sentence_id", "reason", "created_at"}
    assert items[0]["created_at"] == "2026-11-09T12:00:00Z"
    json.dumps(items[0], default=str)
