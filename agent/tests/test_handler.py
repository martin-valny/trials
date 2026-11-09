"""Lambda handler: routing, validation, quotas, execute path (moto DynamoDB, fakes)."""

import json
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from typing import Any

import boto3
import httpx
import pytest
from botocore.stub import Stubber
from make_synthetic_recording import BASE, SITE, scripted_model

from diligence import handler
from diligence.config import AgentConfig
from diligence.handler import Deps, ip_hash, lambda_handler, make_lambda_invoker
from diligence.model import ModelClient
from diligence.store import NewRun, Store, cache_key
from diligence.tools.http import client
from diligence.tools.site import row_fingerprint
from diligence.types import RunRecord

NOW = datetime(2026, 11, 9, 12, 0, 0, tzinfo=UTC)
ORIGIN = "https://martin-valny.github.io"
SALT = "test-salt"
IP = "203.0.113.7"


class Site:
    """Serves the site fixtures and counts requests."""

    def __init__(self) -> None:
        self.hits: list[str] = []
        self.fail = False

    def __call__(self, request: httpx.Request) -> httpx.Response:
        rel = str(request.url).removeprefix(BASE)
        self.hits.append(rel)
        path = SITE / rel
        if self.fail or not path.is_file():
            return httpx.Response(503 if self.fail else 404)
        return httpx.Response(200, json=json.loads(path.read_text()))


class Env:
    def __init__(self, cfg: AgentConfig, ddb: Any) -> None:
        self.cfg = cfg.model_copy(update={"site_base_url": BASE})
        self.store = Store(self.cfg, resource=ddb, now=lambda: self.now)
        self.now = NOW
        self.invoked: list[dict[str, Any]] = []
        self.site = Site()
        self.model: Any = scripted_model
        self.deps = Deps(
            cfg=self.cfg,
            store=self.store,
            invoke=self.invoked.append,
            http=client(transport=httpx.MockTransport(self.site), sleep=lambda _s: None),
            model_factory=lambda _region: self.model(),
            now=lambda: self.now,
        )

    def call(
        self,
        method: str,
        path: str,
        body: Any = None,
        *,
        ip: str = IP,
        headers: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        raw = body if isinstance(body, str) else json.dumps(body) if body is not None else None
        event = {
            "requestContext": {"http": {"method": method, "path": path, "sourceIp": ip}},
            "rawPath": path,
            "headers": headers or {},
            "body": raw,
            "isBase64Encoded": False,
        }
        return lambda_handler(event, None, self.deps)

    def post_run(self, body: Any = None, **kw: Any) -> dict[str, Any]:
        return self.call(
            "POST", "/runs", {"target": "cd20", "disease": "MS"} if body is None else body, **kw
        )

    def execute(self, run_id: str) -> None:
        lambda_handler({"action": "execute", "run_id": run_id}, None, self.deps)

    def fingerprint(self) -> str:
        pipeline = json.loads((SITE / "pipeline.json").read_text())
        risk = json.loads((SITE / "risk.json").read_text())
        return row_fingerprint(pipeline, risk, "cd20", "MS")

    def key(self, fp: str | None = None) -> str:
        return cache_key("cd20", "MS", fp or self.fingerprint(), self.cfg.agent_version)

    def seed_done(self, fp: str) -> str:
        run_id, _ = self.store.create_run(
            self.key(fp),
            NewRun("cd20", "MS", fp, "2026-11-01T00:00:00Z"),
        )
        rec = RunRecord(
            run_id=run_id,
            target="cd20",
            disease="MS",
            fingerprint=fp,
            agent_version="0.1.0",
            status="done",
            started_at="2026-11-01T00:00:00Z",
            finished_at="2026-11-01T00:01:00Z",
        )
        self.store.finish(run_id, rec)
        return run_id


def body_of(resp: dict[str, Any]) -> Any:
    return json.loads(resp["body"])


@pytest.fixture
def env(cfg: AgentConfig, ddb: Any, monkeypatch: pytest.MonkeyPatch) -> Env:
    monkeypatch.setenv("IP_SALT", SALT)
    return Env(cfg, ddb)


# -- POST /runs ---------------------------------------------------------------------------------


def test_start_run_invokes_execute_and_returns_202(env: Env) -> None:
    resp = env.post_run()
    assert resp["statusCode"] == 202
    run_id = body_of(resp)["run_id"]
    assert env.invoked == [{"action": "execute", "run_id": run_id}]
    rec = env.store.get_run(run_id)
    assert rec is not None and rec.status == "running" and rec.fingerprint == env.fingerprint()
    assert rec.started_at == "2026-11-09T12:00:00Z"


def test_concurrent_start_returns_same_run(env: Env) -> None:
    with ThreadPoolExecutor(max_workers=6) as pool:
        resps = list(pool.map(lambda _i: env.post_run(), range(6)))
    assert {r["statusCode"] for r in resps} == {202}
    assert len({body_of(r)["run_id"] for r in resps}) == 1
    assert len(env.invoked) == 1


def test_full_run_then_replay(env: Env) -> None:
    run_id = body_of(env.post_run())["run_id"]
    env.execute(run_id)
    got = body_of(env.call("GET", f"/runs/{run_id}"))
    assert got["status"] == "done" and got["memo"] is not None and got["data_date"] == "2026-11-04"
    resp = env.post_run(ip="198.51.100.9")
    assert resp["statusCode"] == 200
    out = body_of(resp)
    assert out["stale"] is False and out["replay"]["run_id"] == run_id
    assert len(env.invoked) == 1


def test_stale_replay_when_fingerprint_changed_takes_no_quota(env: Env) -> None:
    old = env.seed_done("old-fingerprint")
    resp = env.post_run()
    assert resp["statusCode"] == 200
    assert body_of(resp)["stale"] is True and body_of(resp)["replay"]["run_id"] == old
    assert env.invoked == []
    assert env.store.take_quota(ip_hash(SALT, IP), "2026-11-09") == "ok"  # untouched so far


def test_force_reruns_a_done_key_once(env: Env) -> None:
    first = env.seed_done(env.fingerprint())
    resp = env.post_run({"target": "cd20", "disease": "MS", "force": True})
    assert resp["statusCode"] == 202 and body_of(resp)["run_id"] != first
    again = env.post_run({"target": "cd20", "disease": "MS", "force": True}, ip="198.51.100.9")
    assert body_of(again)["run_id"] == body_of(resp)["run_id"]
    assert len(env.invoked) == 1


def test_force_while_running_takes_no_extra_quota(env: Env) -> None:
    run_id = body_of(env.post_run())["run_id"]
    for _ in range(5):
        r = env.post_run({"target": "cd20", "disease": "MS", "force": True})
        assert body_of(r)["run_id"] == run_id
    assert env.store.take_quota(ip_hash(SALT, IP), "2026-11-09") == "ok"  # only one slot used


def test_cap_returns_latest_recorded(env: Env) -> None:
    capped = env.cfg.model_copy(
        update={"daily": env.cfg.daily.model_copy(update={"global_runs_per_day": 1})}
    )
    env.store.cfg = capped
    env.deps.cfg = capped
    first = body_of(env.post_run(ip="198.51.100.1"))["run_id"]
    env.execute(first)
    # A forced rerun needs a new run, hence a quota slot; the global cap of 1 is spent.
    resp = env.post_run({"target": "cd20", "disease": "MS", "force": True}, ip="198.51.100.2")
    assert resp["statusCode"] == 429
    out = body_of(resp)
    assert out["reason"] == "daily limit reached" and out["latest"]["run_id"] == first
    assert out["latest"]["status"] == "done"


def test_cap_without_any_recorded_run_has_null_latest(env: Env) -> None:
    for _ in range(3):
        env.store.take_quota(ip_hash(SALT, IP), "2026-11-09")
    resp = env.post_run()
    assert resp["statusCode"] == 429
    assert body_of(resp) == {"latest": None, "reason": "daily limit reached"}


def test_per_ip_cap(env: Env) -> None:
    for _ in range(3):
        assert env.store.take_quota(ip_hash(SALT, IP), "2026-11-09") == "ok"
    assert env.post_run()["statusCode"] == 429
    assert env.post_run(ip="198.51.100.5")["statusCode"] == 202  # another visitor is fine
    assert len(env.invoked) == 1


def test_invalid_disease_400(env: Env) -> None:
    resp = env.post_run({"target": "cd20", "disease": "CIDP"})
    assert resp["statusCode"] == 400
    assert env.post_run({"target": "cd20", "disease": "nope"})["statusCode"] == 400
    assert env.post_run({"target": "cd20", "disease": "all"})["statusCode"] == 202


def test_unknown_target_and_bad_bodies_400(env: Env) -> None:
    assert env.post_run({"target": "zzz", "disease": "all"})["statusCode"] == 400
    assert env.post_run("{not json")["statusCode"] == 400
    assert env.post_run("[1]")["statusCode"] == 400
    assert env.post_run({"target": 3, "disease": "all"})["statusCode"] == 400
    assert env.post_run({"target": "cd20", "disease": "all", "force": "yes"})["statusCode"] == 400
    assert env.call("POST", "/runs", None)["statusCode"] == 400
    assert env.invoked == []


def test_missing_ip_salt_refuses_to_start_runs(env: Env, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("IP_SALT")
    resp = env.post_run()
    assert resp["statusCode"] == 500 and body_of(resp) == {"error": "misconfigured"}
    assert env.invoked == []


def test_site_unavailable_is_502(env: Env) -> None:
    env.site.fail = True
    assert env.post_run()["statusCode"] == 502


def test_site_json_cached_for_ten_minutes(env: Env) -> None:
    env.post_run({"target": "cd20", "disease": "all"})
    env.post_run({"target": "cd20", "disease": "MS"})
    assert env.site.hits.count("pipeline.json") == 1
    env.now = NOW + timedelta(minutes=11)
    env.post_run({"target": "cd20", "disease": "MS"})
    assert env.site.hits.count("pipeline.json") == 2


def test_self_invoke_failure_fails_the_run(env: Env) -> None:
    def boom(_payload: dict[str, Any]) -> None:
        raise RuntimeError("no")

    env.deps.invoke = boom
    resp = env.post_run()
    assert resp["statusCode"] == 500
    rec = env.store.get_cached(env.key())
    assert rec is None
    assert env.post_run()["statusCode"] == 500  # pointer was failed, so a retry creates anew


# -- CORS / routing -----------------------------------------------------------------------------


def test_cors_only_allowed_origin(env: Env) -> None:
    assert env.post_run(headers={"origin": "https://evil.example"})["statusCode"] == 403
    ok = env.post_run(headers={"origin": ORIGIN})
    assert ok["statusCode"] == 202
    assert not any(k.lower().startswith("access-control") for k in ok.get("headers", {}))


def test_options_is_204_without_body(env: Env) -> None:
    resp = env.call("OPTIONS", "/runs", headers={"origin": ORIGIN})
    assert resp["statusCode"] == 204 and resp.get("body", "") == ""


def test_unknown_route_404(env: Env) -> None:
    assert env.call("GET", "/nope")["statusCode"] == 404
    assert env.call("DELETE", "/runs")["statusCode"] == 404


# -- GET /runs/{id} -----------------------------------------------------------------------------


def test_get_run_404_and_running_steps(env: Env) -> None:
    assert env.call("GET", "/runs/missing")["statusCode"] == 404
    run_id = body_of(env.post_run())["run_id"]
    got = body_of(env.call("GET", f"/runs/{run_id}"))
    assert got["status"] == "running" and got["steps"] == []


def test_running_past_150s_reads_as_failed(env: Env) -> None:
    run_id = body_of(env.post_run())["run_id"]
    env.now = NOW + timedelta(seconds=151)
    got = body_of(env.call("GET", f"/runs/{run_id}"))
    assert got["status"] == "failed"
    assert got["steps"][-1]["kind"] == "error"
    assert got["steps"][-1]["text"] == "The run did not finish"
    env.now = NOW + timedelta(seconds=100)
    assert body_of(env.call("GET", f"/runs/{run_id}"))["status"] == "running"


# -- flags ----------------------------------------------------------------------------------------


def done_run(env: Env) -> str:
    run_id = body_of(env.post_run())["run_id"]
    env.execute(run_id)
    return str(run_id)


def flag(env: Env, run_id: str, sid: str = "s1", reason: str = "r", **kw: Any) -> dict[str, Any]:
    return env.call(
        "POST", "/flags", {"run_id": run_id, "sentence_id": sid, "reason": reason}, **kw
    )


def test_flag_length_limit(env: Env) -> None:
    run_id = done_run(env)
    assert flag(env, run_id, reason="x" * 500)["statusCode"] == 204
    assert flag(env, run_id, reason="x" * 501)["statusCode"] == 400


def test_flag_validation(env: Env) -> None:
    run_id = done_run(env)
    assert flag(env, "nope")["statusCode"] == 404
    assert (
        env.call("POST", "/flags", {"run_id": run_id, "sentence_id": 3, "reason": "r"})[
            "statusCode"
        ]
        == 400
    )
    assert (
        env.call("POST", "/flags", {"run_id": run_id, "sentence_id": "s", "reason": 3})[
            "statusCode"
        ]
        == 400
    )
    assert env.call("POST", "/flags", "{")["statusCode"] == 400


def test_flag_sentence_id_must_be_well_formed_and_in_the_run(env: Env) -> None:
    run_id = done_run(env)
    for bad in ("x1", "s", "s12345", "S1", "s1; drop", "../s1"):
        assert flag(env, run_id, bad)["statusCode"] == 400
    assert flag(env, run_id, "s99")["statusCode"] == 400  # well formed, not in this run
    assert flag(env, run_id, "s1")["statusCode"] == 204


def test_flag_quota_per_ip_and_global(env: Env, ddb: Any, cfg: AgentConfig) -> None:
    run_id = done_run(env)
    assert [flag(env, run_id)["statusCode"] for _ in range(20)] == [204] * 20
    assert flag(env, run_id)["statusCode"] == 429
    assert flag(env, run_id, ip="198.51.100.77")["statusCode"] == 204
    keys = {i["pk"] for i in ddb.Table(cfg.tables.limits).scan()["Items"]}
    assert f"ip#{ip_hash(SALT, IP)}#flags#2026-11-09" in keys and "global#flags#2026-11-09" in keys
    ddb.Table(cfg.tables.limits).put_item(
        Item={"pk": "global#flags#2026-11-09", "n": 500, "ttl": 9}
    )
    assert flag(env, run_id, ip="198.51.100.78")["statusCode"] == 429


def test_flags_refused_without_ip_salt(env: Env, monkeypatch: pytest.MonkeyPatch) -> None:
    run_id = done_run(env)
    monkeypatch.delenv("IP_SALT")
    assert flag(env, run_id)["statusCode"] == 500


# -- privacy ----------------------------------------------------------------------------------------


def test_ip_never_stored_raw(env: Env, ddb: Any, cfg: AgentConfig) -> None:
    run_id = body_of(env.post_run())["run_id"]
    env.execute(run_id)
    assert flag(env, run_id)["statusCode"] == 204
    seen = 0
    for name in (cfg.tables.runs, cfg.tables.limits, cfg.tables.flags):
        for item in ddb.Table(name).scan()["Items"]:
            seen += 1
            assert IP not in json.dumps(item, default=str)
    assert seen >= 6
    limits = {i["pk"] for i in ddb.Table(cfg.tables.limits).scan()["Items"]}
    assert f"ip#{ip_hash(SALT, IP)}#2026-11-09" in limits


def test_ip_hash_is_salted_sha256() -> None:
    import hashlib

    assert ip_hash("s", "1.2.3.4") == hashlib.sha256(b"s1.2.3.4").hexdigest()


# -- execute path -------------------------------------------------------------------------------------


def test_execute_streams_steps_and_finishes(env: Env, capsys: pytest.CaptureFixture[str]) -> None:
    run_id = body_of(env.post_run())["run_id"]
    env.execute(run_id)
    rec = env.store.get_run(run_id)
    assert rec is not None and rec.status == "done" and len(rec.steps) >= 3
    assert env.store.get_cached(env.key()) is not None
    latest = env.store.latest_for("cd20", "MS")
    assert latest is not None and latest.run_id == run_id


def test_step_logs_are_structured_json(env: Env, capsys: pytest.CaptureFixture[str]) -> None:
    run_id = body_of(env.post_run())["run_id"]
    capsys.readouterr()
    env.execute(run_id)
    lines = [json.loads(x) for x in capsys.readouterr().out.splitlines() if x.startswith("{")]
    steps = [x for x in lines if x.get("event") == "step"]
    rec = env.store.get_run(run_id)
    assert rec is not None and len(steps) == len(rec.steps)
    for i, line in enumerate(steps, start=1):
        assert line["run_id"] == run_id and line["n"] == i
        assert {"kind", "tool", "ms", "tokens_in", "tokens_out", "cost_usd"} <= set(line)
    assert [s["tool"] for s in steps if s["tool"]][:2] == ["site_target", "site_risk"]


def test_step_log_cost_is_running_total(env: Env, capsys: pytest.CaptureFixture[str]) -> None:
    prices = {
        k: v.model_copy(update={"input_per_mtok": 1.0, "output_per_mtok": 2.0})
        for k, v in env.cfg.prices.items()
    }
    env.cfg = env.cfg.model_copy(update={"prices": prices})
    env.deps.cfg = env.cfg
    env.store.cfg = env.cfg
    run_id = body_of(env.post_run())["run_id"]
    capsys.readouterr()
    env.execute(run_id)
    lines = [json.loads(x) for x in capsys.readouterr().out.splitlines() if x.startswith("{")]
    costs = [x["cost_usd"] for x in lines if x.get("event") == "step"]
    rec = env.store.get_run(run_id)
    assert rec is not None and rec.cost_usd > 0
    assert costs == sorted(costs) and costs[-1] == pytest.approx(rec.cost_usd)


def test_execute_exception_finishes_failed(env: Env) -> None:
    def broken() -> ModelClient:
        raise RuntimeError("bedrock down")

    env.model = broken
    run_id = body_of(env.post_run())["run_id"]
    env.execute(run_id)
    rec = env.store.get_run(run_id)
    assert rec is not None and rec.status == "failed"
    assert rec.steps[-1].kind == "error" and "RuntimeError" in rec.steps[-1].text
    assert env.store.running_for(env.key()) is None


def test_second_execute_does_not_call_the_model(env: Env) -> None:
    run_id = body_of(env.post_run())["run_id"]
    calls: list[int] = []
    inner = env.model
    env.model = lambda: calls.append(1) or inner()
    # Simulate an async retry delivered while the first execution is in flight.
    assert env.store.claim_execution(run_id)
    env.execute(run_id)
    assert calls == []
    rec = env.store.get_run(run_id)
    assert rec is not None and rec.status == "running"


def test_second_execute_after_finish_is_a_noop(env: Env) -> None:
    run_id = done_run(env)
    calls: list[int] = []
    env.model = lambda: calls.append(1) or scripted_model()
    env.execute(run_id)
    assert calls == []


def test_stale_run_is_not_executed(env: Env) -> None:
    run_id = body_of(env.post_run())["run_id"]
    calls: list[int] = []
    env.model = lambda: calls.append(1) or scripted_model()
    env.now = NOW + timedelta(seconds=151)
    env.execute(run_id)
    assert calls == []
    rec = env.store.get_run(run_id)
    assert rec is not None and rec.status == "failed"


def test_missing_price_logs_a_warning(env: Env, capsys: pytest.CaptureFixture[str]) -> None:
    env.cfg = env.cfg.model_copy(update={"prices": {}})
    env.deps.cfg = env.cfg
    run_id = body_of(env.post_run())["run_id"]
    capsys.readouterr()
    env.execute(run_id)
    out = [json.loads(x) for x in capsys.readouterr().out.splitlines() if x.startswith("{")]
    assert any(x.get("event") == "warning" and "no price" in x["text"] for x in out)


def test_execute_unknown_run_is_a_noop(env: Env) -> None:
    env.execute("missing")  # must not raise


# -- the real invoker ------------------------------------------------------------------------------------


def test_lambda_invoker_is_async_self_invoke(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AWS_LAMBDA_FUNCTION_NAME", "trial-radar-diligence")
    lam = boto3.client("lambda", region_name="eu-central-1")
    payload = {"action": "execute", "run_id": "abc"}
    with Stubber(lam) as stub:
        stub.add_response(
            "invoke",
            {"StatusCode": 202},
            {
                "FunctionName": "trial-radar-diligence",
                "InvocationType": "Event",
                "Payload": json.dumps(payload).encode(),
            },
        )
        make_lambda_invoker(lam)(payload)
        stub.assert_no_pending_responses()


def test_module_import_needs_no_aws() -> None:
    assert handler.lambda_handler is lambda_handler
