"""Lambda entry point (function URL, payload v2): routes, validation, quotas, async execute.

CORS headers are configured on the function URL in template.yaml; the handler emits none and
only rejects a foreign `origin`. Everything outside the handler's own logic (store, async
invoker, http client, model factory, clock) comes in through `Deps`, so tests run offline.
"""

import base64
import hashlib
import json
import os
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import boto3
import httpx

from diligence.config import AgentConfig, load_config
from diligence.loop import RunRequest, run_agent
from diligence.model import BedrockModel, ModelClient, ModelResponse
from diligence.store import STALE_AFTER_S, NewRun, Store, cache_key
from diligence.tools.http import ToolError, client, get_json
from diligence.tools.registry_of_tools import ToolContext
from diligence.tools.site import _find_row, _marks, row_fingerprint
from diligence.types import RunRecord, Step

SITE_CACHE_S = 600
MAX_REASON = 500
_STAMP = "%Y-%m-%dT%H:%M:%SZ"
_JSON = {"content-type": "application/json"}

Invoker = Callable[[dict[str, Any]], None]


def make_lambda_invoker(lam: Any | None = None) -> Invoker:
    """Async (Event) self-invoke of this function; the boto3 client is built on first use."""
    holder: list[Any] = [lam]

    def invoke(payload: dict[str, Any]) -> None:
        if holder[0] is None:
            holder[0] = boto3.client("lambda")
        holder[0].invoke(
            FunctionName=os.environ["AWS_LAMBDA_FUNCTION_NAME"],
            InvocationType="Event",
            Payload=json.dumps(payload).encode(),
        )

    return invoke


@dataclass
class Deps:
    cfg: AgentConfig
    store: Store
    invoke: Invoker
    http: httpx.Client
    model_factory: Callable[[str], ModelClient]
    now: Callable[[], datetime] = lambda: datetime.now(UTC)
    _site: dict[str, tuple[float, Any]] = field(default_factory=dict)


def default_deps() -> Deps:
    cfg = load_config()
    return Deps(
        cfg=cfg,
        store=Store(cfg),
        invoke=make_lambda_invoker(),
        http=client(),
        model_factory=lambda region: BedrockModel(region),
    )


_DEFAULT: list[Deps] = []


def ip_hash(salt: str, ip: str) -> str:
    return hashlib.sha256((salt + ip).encode()).hexdigest()


def _resp(status: int, body: Any = None) -> dict[str, Any]:
    if body is None:
        return {"statusCode": status, "body": ""}
    return {"statusCode": status, "headers": dict(_JSON), "body": json.dumps(body)}


def _record_json(record: RunRecord) -> Any:
    return record.model_dump(mode="json")


# -- site JSON (cached in process for ten minutes) -------------------------------------------------


def _site_json(deps: Deps, name: str, *, required: bool) -> Any:
    now = deps.now().timestamp()
    hit = deps._site.get(name)
    if hit and now - hit[0] < SITE_CACHE_S:
        return hit[1]
    try:
        data = get_json(deps.http, deps.cfg.site_base_url + name)
    except ToolError:
        if required:
            raise
        data = None
    if data is not None:
        deps._site[name] = (now, data)
    return data


# -- stale runs --------------------------------------------------------------------------------------


def _seen_as(deps: Deps, record: RunRecord) -> RunRecord:
    """A run still "running" long after it started is reported as failed (computed on read)."""
    if record.status != "running":
        return record
    try:
        started = datetime.strptime(record.started_at, _STAMP).replace(tzinfo=UTC)
    except ValueError:
        return record
    if (deps.now() - started).total_seconds() <= STALE_AFTER_S:
        return record
    error = Step(n=len(record.steps) + 1, kind="error", text="The run did not finish")
    return record.model_copy(
        update={
            "status": "failed",
            "finished_at": deps.now().strftime(_STAMP),
            "steps": [*record.steps, error],
        }
    )


# -- request parsing -------------------------------------------------------------------------------------


class _Bad(Exception):
    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.message, self.status = message, status


def _json_body(event: dict[str, Any]) -> dict[str, Any]:
    raw = event.get("body")
    if not raw:
        raise _Bad("body required")
    if event.get("isBase64Encoded"):
        raw = base64.b64decode(raw).decode()
    try:
        data = json.loads(raw)
    except ValueError as exc:
        raise _Bad("body is not valid JSON") from exc
    if not isinstance(data, dict):
        raise _Bad("body must be a JSON object")
    return data


# -- routes -----------------------------------------------------------------------------------------------


def _post_run(event: dict[str, Any], deps: Deps) -> dict[str, Any]:
    body = _json_body(event)
    target, disease, force = body.get("target"), body.get("disease"), body.get("force", False)
    if not isinstance(target, str) or not isinstance(disease, str) or not isinstance(force, bool):
        raise _Bad("target and disease must be strings; force must be a boolean")
    try:
        pipeline = _site_json(deps, "pipeline.json", required=True)
        risk = _site_json(deps, "risk.json", required=False)
    except ToolError:
        return _resp(502, {"error": "site data unavailable"})
    row = _find_row(pipeline, target)
    if row is None:
        raise _Bad("unknown target")
    if disease != "all" and not _marks(row, disease):
        raise _Bad("no trials for this target in that disease")
    fingerprint = row_fingerprint(pipeline, risk, target, disease)
    key = cache_key(target, disease, fingerprint, deps.cfg.agent_version)
    store = deps.store
    if not force:
        cached = store.get_cached(key)
        if cached:
            return _resp(200, {"replay": _record_json(cached), "stale": False})
        latest = store.latest_for(target, disease)
        if latest:
            return _resp(200, {"replay": _record_json(latest), "stale": True})
    if (existing := store.running_for(key)) is not None:
        return _resp(202, {"run_id": existing})
    salt = os.environ.get("IP_SALT")
    if not salt:
        return _resp(500, {"error": "misconfigured"})
    day = deps.now().strftime("%Y-%m-%d")
    hashed = ip_hash(salt, str(event["requestContext"]["http"].get("sourceIp", "")))
    quota = store.take_quota(hashed, day)
    if quota != "ok":
        latest = store.latest_for(target, disease)
        return _resp(
            429,
            {"latest": _record_json(latest) if latest else None, "reason": "daily limit reached"},
        )
    new = NewRun(target, disease, fingerprint, deps.now().strftime(_STAMP))
    run_id, created = store.create_run(key, new, replace_finished=True)
    if not created:
        store.refund_quota(hashed, day)
        return _resp(202, {"run_id": run_id})
    try:
        deps.invoke({"action": "execute", "run_id": run_id})
    except Exception as exc:  # noqa: BLE001 - never leave the run "running" with nobody on it
        _fail(deps, run_id, f"could not start: {type(exc).__name__}")
        return _resp(500, {"error": "could not start run"})
    return _resp(202, {"run_id": run_id})


def _get_run(run_id: str, deps: Deps) -> dict[str, Any]:
    record = deps.store.get_run(run_id)
    if record is None:
        return _resp(404, {"error": "run not found"})
    return _resp(200, _record_json(_seen_as(deps, record)))


def _post_flag(event: dict[str, Any], deps: Deps) -> dict[str, Any]:
    body = _json_body(event)
    run_id, sentence_id, reason = body.get("run_id"), body.get("sentence_id"), body.get("reason")
    if not all(isinstance(v, str) for v in (run_id, sentence_id, reason)):
        raise _Bad("run_id, sentence_id and reason must be strings")
    assert isinstance(run_id, str) and isinstance(sentence_id, str) and isinstance(reason, str)
    if len(reason) > MAX_REASON:
        raise _Bad(f"reason is longer than {MAX_REASON} characters")
    if deps.store.get_run(run_id) is None:
        return _resp(404, {"error": "run not found"})
    deps.store.add_flag(run_id, sentence_id, reason)
    return _resp(204)


# -- execute ---------------------------------------------------------------------------------------------------


class _CostTracker:
    """Wraps the model to keep a running cost total (steps carry tokens, not model ids)."""

    def __init__(self, inner: ModelClient, cfg: AgentConfig) -> None:
        self._inner, self._cfg = inner, cfg
        self.cost = 0.0

    def converse(self, **kw: Any) -> ModelResponse:
        resp = self._inner.converse(**kw)
        price = self._cfg.prices.get(kw["model"])
        if price:
            self.cost += (
                resp.tokens_in * price.input_per_mtok + resp.tokens_out * price.output_per_mtok
            ) / 1e6
        return resp


def _fail(deps: Deps, run_id: str, text: str) -> None:
    record = deps.store.get_run(run_id)
    if record is None or record.status != "running":
        return
    step = Step(n=len(record.steps) + 1, kind="error", text=text)
    failed = record.model_copy(
        update={
            "status": "failed",
            "finished_at": deps.now().strftime(_STAMP),
            "steps": [*record.steps, step],
        }
    )
    deps.store.finish(run_id, failed)


def _execute(run_id: str, deps: Deps) -> None:
    record = deps.store.get_run(run_id)
    if record is None or record.status != "running":
        return
    try:
        model = _CostTracker(deps.model_factory(deps.cfg.region), deps.cfg)

        def sink(step: Step) -> None:
            deps.store.append_step(run_id, step)
            print(
                json.dumps(
                    {
                        "event": "step",
                        "run_id": run_id,
                        "n": step.n,
                        "kind": step.kind,
                        "tool": step.tool,
                        "ms": step.ms,
                        "tokens_in": step.tokens_in,
                        "tokens_out": step.tokens_out,
                        "cost_usd": round(model.cost, 6),
                    }
                ),
                flush=True,
            )

        data_date = ""
        meta = _site_json(deps, "meta.json", required=False)
        if isinstance(meta, dict):
            data_date = str(meta.get("generated_for", ""))
        pipeline = _site_json(deps, "pipeline.json", required=False) or {}
        row = _find_row(pipeline, record.target)
        final = run_agent(
            RunRequest(record.target, record.disease),
            cfg=deps.cfg,
            model=model,
            ctx=ToolContext(http=deps.http, base_url=deps.cfg.site_base_url),
            sink=sink,
            clock=time.monotonic,
            run_id=run_id,
            fingerprint=record.fingerprint,
            data_date=data_date,
            label=row.get("label") if row else None,
            now=deps.now,
        )
        deps.store.finish(run_id, final)
    except Exception as exc:  # noqa: BLE001 - never leave a run "running" forever
        _fail(deps, run_id, f"run failed: {type(exc).__name__}")


# -- entry point -----------------------------------------------------------------------------------------------------


def _route(event: dict[str, Any], deps: Deps) -> dict[str, Any]:
    http = event["requestContext"]["http"]
    method, path = http["method"].upper(), http.get("path") or event.get("rawPath", "")
    headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
    origin = headers.get("origin")
    if origin is not None and origin != deps.cfg.allowed_origin:
        return _resp(403, {"error": "origin not allowed"})
    if method == "OPTIONS":
        return _resp(204)
    parts = [p for p in path.split("/") if p]
    if method == "POST" and parts == ["runs"]:
        return _post_run(event, deps)
    if method == "GET" and len(parts) == 2 and parts[0] == "runs":
        return _get_run(parts[1], deps)
    if method == "POST" and parts == ["flags"]:
        return _post_flag(event, deps)
    return _resp(404, {"error": "not found"})


def lambda_handler(event: dict[str, Any], context: Any, deps: Deps | None = None) -> dict[str, Any]:
    if deps is None:
        if not _DEFAULT:
            _DEFAULT.append(default_deps())
        deps = _DEFAULT[0]
    if event.get("action") == "execute" and isinstance(event.get("run_id"), str):
        _execute(event["run_id"], deps)
        return {"ok": True}
    try:
        return _route(event, deps)
    except _Bad as bad:
        return _resp(bad.status, {"error": bad.message})
