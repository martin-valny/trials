"""Recording and replay of whole runs: model I/O, tool results, and the final record.

One JSONL per run: a `meta` line, `model` lines (written by RecordingModel), `tool` lines in call
order, `clock` lines (every reading the loop took, relative to the first), and a closing `result`
line holding the RunRecord. CI replays them offline, feeding the clock readings back so a run that
hit its time limit replays the same way (R41).
"""

import json
import time
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

from diligence.config import AgentConfig
from diligence.loop import DispatchFn, RunRequest, StepSink, run_agent
from diligence.model import (
    ModelClient,
    RecordingModel,
    ReplayMismatch,
    ReplayModel,
    prompt_hash,
    read_lines,
)
from diligence.tools.registry_of_tools import ToolContext, dispatch
from diligence.types import RunRecord, ToolResult

_RERECORD = "re-record the evaluation"


def append_line(path: Path, line: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a") as f:
        f.write(json.dumps(line) + "\n")


class RecordingTools:
    """Dispatcher wrapper that appends each tool call as a `kind: tool` line."""

    def __init__(self, inner: DispatchFn, path: Path) -> None:
        self._inner, self._path = inner, path

    def __call__(self, name: str, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        result = self._inner(name, args, ctx)
        append_line(
            self._path,
            {"kind": "tool", "name": name, "args": args, "result": result.model_dump()},
        )
        return result


class ReplayTools:
    """Returns recorded tool results in call order; a different call is a replay mismatch."""

    def __init__(self, path: Path) -> None:
        self._calls = [x for x in read_lines(path) if x.get("kind") == "tool"]
        self._next = 0

    def __call__(self, name: str, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        if self._next >= len(self._calls):
            raise ReplayMismatch(f"tool {name!r} called past the recording; {_RERECORD}")
        line = self._calls[self._next]
        if line["name"] != name or line["args"] != args:
            raise ReplayMismatch(
                f"tool call {self._next} differs: recorded {line['name']}({line['args']}), "
                f"got {name}({args}); {_RERECORD}"
            )
        self._next += 1
        return ToolResult.model_validate(line["result"])


class RecordingClock:
    """Clock wrapper that appends each reading (seconds since the first) as a `kind: clock` line."""

    def __init__(self, inner: Callable[[], float], path: Path) -> None:
        self._inner, self._path = inner, path
        self._t0: float | None = None

    def __call__(self) -> float:
        now = self._inner()
        if self._t0 is None:
            self._t0 = now
        t = now - self._t0
        append_line(self._path, {"kind": "clock", "t": t})
        return t


class ReplayClock:
    """Returns the recorded clock readings in order; one reading too many is a replay mismatch."""

    def __init__(self, path: Path) -> None:
        self._readings = [float(x["t"]) for x in read_lines(path) if x.get("kind") == "clock"]
        self._next = 0

    def __call__(self) -> float:
        if self._next >= len(self._readings):
            raise ReplayMismatch(
                f"clock read {self._next + 1} times, recorded {len(self._readings)}; {_RERECORD}"
            )
        t = self._readings[self._next]
        self._next += 1
        return t


def meta_of(path: Path) -> dict[str, Any]:
    first = read_lines(path)[0]
    if first.get("kind") != "meta":
        raise ValueError(f"{path.name}: first line is not meta")
    return first


def stored_record(path: Path) -> RunRecord:
    last = read_lines(path)[-1]
    if last.get("kind") != "result":
        raise ValueError(f"{path.name}: last line is not result")
    return RunRecord.model_validate(last["record"])


def comparable(rec: RunRecord) -> dict[str, Any]:
    """What replay must reproduce: everything but ids, timestamps, timings and prices."""
    d = rec.model_dump()
    for key in ("run_id", "started_at", "finished_at", "cost_usd"):
        d.pop(key)
    for step in d["steps"]:
        step.pop("ms")
    return d


def _offline_ctx() -> ToolContext:
    def refuse(request: httpx.Request) -> httpx.Response:
        raise AssertionError(f"replay must not use the network: {request.url}")

    return ToolContext(http=httpx.Client(transport=httpx.MockTransport(refuse)), base_url="")


def replay_run(path: Path, cfg: AgentConfig, sink: StepSink | None = None) -> RunRecord:
    """Re-run the agent from a recording (model, tools and clock readings replayed). No network."""
    meta = meta_of(path)
    return run_agent(
        RunRequest(target=meta["target"], disease=meta["disease"]),
        cfg=cfg,
        model=ReplayModel(path),
        ctx=_offline_ctx(),
        sink=sink or (lambda _s: None),
        clock=ReplayClock(path),
        run_id="replay",
        fingerprint=meta["fingerprint"],
        data_date=meta["data_date"],
        label=meta["label"],
        dispatch_fn=ReplayTools(path),
    )


def record_run(
    path: Path,
    *,
    req: RunRequest,
    cfg: AgentConfig,
    model: ModelClient,
    ctx: ToolContext,
    fingerprint: str,
    data_date: str,
    label: str | None,
    dispatch_fn: DispatchFn = dispatch,
    clock: Callable[[], float] | None = None,
    now: Callable[[], datetime] = lambda: datetime.now(UTC),
) -> RunRecord:
    """Run the agent for real (or with fakes) and write the full recording to `path`."""
    path.unlink(missing_ok=True)
    append_line(
        path,
        {
            "kind": "meta",
            "prompt_hash": prompt_hash(cfg),
            "agent_version": cfg.agent_version,
            "target": req.target,
            "disease": req.disease,
            "label": label,
            "fingerprint": fingerprint,
            "data_date": data_date,
            "recorded_at": now().strftime("%Y-%m-%dT%H:%M:%SZ"),
        },
    )
    rec = run_agent(
        req,
        cfg=cfg,
        model=RecordingModel(model, path),
        ctx=ctx,
        sink=lambda _s: None,
        fingerprint=fingerprint,
        data_date=data_date,
        label=label,
        now=now,
        dispatch_fn=RecordingTools(dispatch_fn, path),
        clock=RecordingClock(clock or time.monotonic, path),
    )
    append_line(path, {"kind": "result", "record": rec.model_dump()})
    return rec
