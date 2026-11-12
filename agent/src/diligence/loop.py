"""The agent loop: a planner model gathers evidence with tools, a writer model files the memo.

The planner ends gathering with `ready_to_write` (or plain text); only the writer call, with a
forced `submit_memo`, writes the memo. Tool output reaches the model only inside `toolResult`
content blocks (never the system prompt or plain user text). Limits end gathering with what it
has; the writer call (and one repair) then runs with its own bounded budget so the visitor still
gets a memo.
"""

import copy
import json
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from pydantic import ValidationError

from diligence.checker import (
    apply_verdicts,
    deterministic_check,
    model_check,
    scrub_summary_lines,
    settle_judgement,
)
from diligence.config import AgentConfig
from diligence.log import current_run, log_error
from diligence.model import CACHE_POINT, ModelClient, ModelResponse, ReplayMismatch, response_cost
from diligence.prompts import SYSTEM_PROMPT
from diligence.tools.registry_of_tools import PLANNER_TOOLS, WRITER_TOOLS, ToolContext, dispatch
from diligence.types import Memo, RunRecord, Step, StepKind, ToolResult, Verdict

StepSink = Callable[[Step], None]
DispatchFn = Callable[[str, dict[str, Any], ToolContext], ToolResult]

# The writer call's max_tokens: what is left of the output cap, at most WRITER_MAX_TOKENS and
# never below WRITER_MIN_TOKENS (so a run that spent its output budget still gets a memo).
WRITER_MAX_TOKENS = 4096
WRITER_MIN_TOKENS = 3000
MIN_PLANNER_TOKENS = 1024
_ID_KEYS = ("nct", "id", "pmid")
_READY = "Noted. Gathering is over; the memo is written next."


@dataclass(frozen=True)
class RunRequest:
    target: str
    disease: str


def _plural(n: int, word: str) -> str:
    return f"{n} {word}" if n == 1 else f"{n} {word}s"


def summary_line(result: ToolResult) -> str:
    """One human line describing what a tool returned."""
    if result.error:
        return f"Error: {result.error}"
    d = result.data
    note = d.get("note")
    match result.name:
        case "site_target":
            stopped = (d.get("counts_by_status") or {}).get("stopped", 0)
            return (
                f"{_plural(d.get('trials_total', 0), 'trial')} on this target ({stopped} stopped)"
            )
        case "site_risk":
            if "trials" not in d:
                if summary := d.get("summary"):
                    return (
                        f"Stop-risk summary: median {round(summary['median'] * 100)}% across "
                        f"{_plural(summary['n'], 'running trial')}"
                    )
                return str(note or "Stop-risk estimates unavailable")
            return f"Stop-risk estimates for {_plural(len(d['trials']), 'running trial')}"
        case "registry_search":
            terminated = sum(
                v for k, v in (d.get("counts_by_status") or {}).items() if k.upper() == "TERMINATED"
            )
            counted, total = d.get("counted", 0), d.get("total")
            if isinstance(total, int) and total > counted:
                return f"{total} registry trials, {counted} counted ({terminated} terminated)"
            return f"{counted} registry trials ({terminated} terminated)"
        case "chembl_drug":
            if "max_phase" not in d:
                return str(note or "Drug not found in ChEMBL")
            mechs = _plural(len(d.get("mechanisms") or []), "mechanism")
            return f"{d.get('name')}: max phase {d['max_phase']:g}, {mechs}"
        case "literature_search":
            line = _plural(len(d.get("abstracts") or []), "abstract")
            since = result.args.get("since_year")
            return f"{line} since {since}" if since else line
        case "fda_label":
            return "FDA label found" if d.get("set_id") else str(note or "No FDA label found")
    return "Done"


def _compact(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False)


def _aggregates(data: dict[str, Any]) -> dict[str, Any]:
    """The result's top-level non-list fields: totals, counts, summaries, notes."""
    return {k: v for k, v in data.items() if not isinstance(v, list)}


def _add_sources(sources: dict[str, str], result: ToolResult) -> None:
    """Record, per retrieved id, the source text the checker reads for it.

    For a list tool that is the compact JSON of the item carrying the id plus the result's
    top-level counts and summaries (so "99 trials" or a stop-risk summary citing any listed trial
    can be checked); otherwise the whole result.
    """
    for rid in result.ids:
        text: str | None = None
        for value in result.data.values():
            if not isinstance(value, list):
                continue
            for item in value:
                if isinstance(item, dict) and any(item.get(k) == rid for k in _ID_KEYS):
                    text = _compact(item)
                    break
            if text is not None:
                break
        if text is None:
            text = _compact(result.data)
        elif agg := _aggregates(result.data):
            text += "\n" + _compact(agg)
        prev = sources.get(rid)
        if prev is None:
            sources[rid] = text
        elif text not in prev.split("\n\n"):
            sources[rid] = prev + "\n\n" + text


def _toolresult(use_id: str, payload: Any, error: bool = False) -> dict[str, Any]:
    block: dict[str, Any] = {"toolUseId": use_id}
    if isinstance(payload, str):
        block["content"] = [{"text": payload}]
    else:
        block["content"] = [{"json": payload}]
    if error:
        block["status"] = "error"
    return {"toolResult": block}


def _validation_text(exc: ValidationError) -> str:
    parts = [f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}" for e in exc.errors()[:8]]
    return "; ".join(parts)


def _parse_memo(raw: Any) -> tuple[Memo | None, str]:
    try:
        return Memo.model_validate(raw), ""
    except ValidationError as exc:
        return None, _validation_text(exc)


def _memo_from_text(content: list[dict[str, Any]]) -> Any | None:
    """A memo the writer returned as JSON text instead of a submit_memo call (models that cannot
    be forced to call a tool do this); None when the text holds no JSON object."""
    text = "".join(b.get("text", "") for b in content).strip()
    if text.startswith("```"):
        text = text.strip("`").removeprefix("json").strip()
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        return None
    try:
        value = json.loads(text[start : end + 1])
    except ValueError:
        return None
    return value if isinstance(value, dict) else None


class _Run:
    def __init__(
        self,
        req: RunRequest,
        cfg: AgentConfig,
        model: ModelClient,
        ctx: ToolContext,
        sink: StepSink,
        clock: Callable[[], float],
        label: str | None,
        data_date: str,
        dispatch_fn: DispatchFn | None = None,
    ) -> None:
        self.dispatch_fn = dispatch_fn
        self.req, self.cfg, self.model, self.ctx = req, cfg, model, ctx
        self.sink, self.clock = sink, clock
        self.label, self.data_date = label, data_date
        self.t0 = clock()
        self.steps: list[Step] = []
        self.messages: list[dict[str, Any]] = []
        self.tokens_in = 0
        self.tokens_out = 0
        self.cost = 0.0
        self.tool_calls = 0
        self.limit_name: str | None = None
        self.retrieved: set[str] = set()
        self.sources: dict[str, str] = {}
        self.verdicts: list[Verdict] = []
        self.removed: list[dict[str, Any]] = []
        self.judgement_shown = False
        self.judgement_adjusted: dict[str, Any] | None = None
        self.model_failed = False
        self._pend_in = 0
        self._pend_out = 0

    # -- bookkeeping -------------------------------------------------------------------------

    def emit(
        self,
        kind: StepKind,
        text: str,
        *,
        tool: str | None = None,
        ids: list[str] | None = None,
        ms: int = 0,
    ) -> None:
        step = Step(
            n=len(self.steps) + 1,
            kind=kind,
            text=text,
            tool=tool,
            ids=ids or [],
            ms=ms,
            tokens_in=self._pend_in,
            tokens_out=self._pend_out,
        )
        self._pend_in = self._pend_out = 0
        self.steps.append(step)
        self.sink(step)

    def converse(
        self,
        model_id: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        max_tokens: int,
        tool_choice: str | None = None,
    ) -> ModelResponse:
        try:
            resp = self.model.converse(
                model=model_id,
                system=SYSTEM_PROMPT,
                messages=copy.deepcopy(messages),
                tools=tools,
                max_tokens=max_tokens,
                tool_choice=tool_choice,
            )
        except ReplayMismatch:
            raise
        except Exception:
            self.model_failed = True
            raise
        self.account(resp, model_id)
        return resp

    def account(self, resp: ModelResponse, model_id: str) -> None:
        self.tokens_in += resp.tokens_in
        self.tokens_out += resp.tokens_out
        self._pend_in += resp.tokens_in
        self._pend_out += resp.tokens_out
        price = self.cfg.prices.get(model_id)
        if price:
            self.cost += response_cost(resp, price)

    # -- limits ------------------------------------------------------------------------------

    def check_limits(self, *, tools: bool) -> str | None:
        lim = self.cfg.limits
        if self.tokens_in >= lim.max_input_tokens:
            return "input tokens"
        if self.tokens_out >= lim.max_output_tokens:
            return "output tokens"
        if self.clock() - self.t0 >= lim.max_seconds:
            return "time"
        if tools and self.tool_calls >= lim.max_tool_calls:
            return "tool calls"
        return None

    def hit(self, name: str) -> None:
        if self.limit_name is None:
            self.limit_name = name
            lim = self.cfg.limits
            detail = {
                "tool calls": f"{self.tool_calls} of {lim.max_tool_calls}",
                "input tokens": f"{self.tokens_in} of {lim.max_input_tokens}",
                "output tokens": f"{self.tokens_out} of {lim.max_output_tokens}",
                "time": f"{int(self.clock() - self.t0)}s of {lim.max_seconds}s",
            }[name]
            self.emit(
                "limit", f"Limit reached: {name} ({detail}). Writing the memo from what exists."
            )

    # -- the loop ----------------------------------------------------------------------------

    def first_message(self) -> dict[str, Any]:
        lines = [f"Target id: {self.req.target}"]
        if self.label:
            lines.append(f"Label: {self.label}")
        lines.append(f"Disease: {self.req.disease}")
        if self.data_date:
            lines.append(f"Data date: {self.data_date}")
        lines.append(f"Tool-call limit for this run: {self.cfg.limits.max_tool_calls}")
        return {"role": "user", "content": [{"text": "\n".join(lines)}]}

    def run_tool(self, use: dict[str, Any]) -> dict[str, Any]:
        if (name := self.limit_name or self.check_limits(tools=True)) is not None:
            self.hit(name)
            text = (
                "not run: tool-call limit reached"
                if name == "tool calls"
                else f"not run: {name} limit reached"
            )
            return _toolresult(use["toolUseId"], text, error=True)
        self.tool_calls += 1
        started = self.clock()
        result = (self.dispatch_fn or dispatch)(use["name"], use.get("input") or {}, self.ctx)
        ms = int((self.clock() - started) * 1000)
        self.retrieved.update(result.ids)
        _add_sources(self.sources, result)
        self.emit("tool", summary_line(result), tool=result.name, ids=result.ids, ms=ms)
        payload = {"data": result.data, "ids": result.ids, "error": result.error}
        return _toolresult(use["toolUseId"], payload, error=result.error is not None)

    def planner_messages(self) -> list[dict[str, Any]]:
        """The history with a cache point after its last block, so the growing prefix is cached."""
        msgs = copy.deepcopy(self.messages)
        msgs[-1]["content"].append(dict(CACHE_POINT))
        return msgs

    def gather(self) -> None:
        """Planner loop: tool calls until ready_to_write, plain text, or a limit."""
        while True:
            if (name := self.check_limits(tools=False)) is not None:
                self.hit(name)
                return
            cap = self.cfg.limits.max_output_tokens
            budget = min(max(cap - self.tokens_out, MIN_PLANNER_TOKENS), cap)
            resp = self.converse(
                self.cfg.models.planner, self.planner_messages(), PLANNER_TOOLS, budget
            )
            content = resp.content or [{"text": "(no output)"}]
            self.messages.append({"role": "assistant", "content": content})
            uses = [b["toolUse"] for b in content if "toolUse" in b]
            if not uses:
                return
            results: list[dict[str, Any]] = []
            truncated = resp.stop_reason == "max_tokens"
            ready = False
            for use in uses:
                if truncated:
                    # The input may be cut off mid-JSON: never execute it.
                    results.append(
                        _toolresult(
                            use["toolUseId"], "not run: the response was cut off", error=True
                        )
                    )
                elif use["name"] == "ready_to_write":
                    ready = True
                    results.append(_toolresult(use["toolUseId"], _READY))
                else:
                    results.append(self.run_tool(use))
            self.messages.append({"role": "user", "content": results})
            if ready:
                self.emit("note", "Gathering done; writing the memo")
                return
            if self.limit_name:
                return

    def writer_messages(self, instruction: str) -> list[dict[str, Any]]:
        """Conversation so far plus the writer instruction, keeping roles alternating."""
        msgs = copy.deepcopy(self.messages)
        block = {"text": instruction}
        if msgs and msgs[-1]["role"] == "user":
            msgs[-1]["content"].append(block)
        else:
            msgs.append({"role": "user", "content": [block]})
        return msgs

    def write(self) -> Memo | None:
        instruction = "Write the final memo now by calling submit_memo."
        if self.limit_name:
            instruction += (
                f" The run hit its {self.limit_name} limit, so use only the evidence gathered so "
                "far and say plainly where evidence is missing."
            )
        msgs = self.writer_messages(instruction)
        lim = self.cfg.limits.max_output_tokens
        for attempt in range(2):
            budget = max(min(lim - self.tokens_out, WRITER_MAX_TOKENS), WRITER_MIN_TOKENS)
            resp = self.converse(
                self.cfg.models.writer, msgs, WRITER_TOOLS, budget, tool_choice="submit_memo"
            )
            use = next(
                (
                    b["toolUse"]
                    for b in resp.content
                    if b.get("toolUse", {}).get("name") == "submit_memo"
                ),
                None,
            )
            raw = use.get("input") if use else _memo_from_text(resp.content)
            memo, err = _parse_memo(raw) if raw is not None else (None, "no submit_memo call")
            if memo is not None:
                self.emit("write", f"Memo written: {_plural(len(memo.sections), 'sentence')}")
                return memo
            if attempt == 0:
                self.emit("note", "Memo invalid, retrying")
                content = resp.content or [{"text": "(no output)"}]
                msgs = [*msgs, {"role": "assistant", "content": content}]
                fix = f"The memo was invalid ({err}). Call submit_memo again with a corrected memo."
                reply: list[dict[str, Any]] = [
                    _toolresult(
                        b["toolUse"]["toolUseId"],
                        fix if b["toolUse"] is use else "not run: submit_memo only, once",
                        error=True,
                    )
                    for b in content
                    if "toolUse" in b
                ]
                reply.append({"text": fix})
                msgs.append({"role": "user", "content": reply})
        return None

    def finish(self, memo: Memo) -> Memo:
        """Check the memo: deterministic checks, model check, verdicts, judgement gate.

        Runs after the run's caps (the checker is bounded per call); its usage counts in the
        totals. A failing checker leaves sentences `partly` and the judgement withheld.
        """
        n = len(memo.sections)
        memo, removed = deterministic_check(memo, self.retrieved, self.sources)
        for r in removed:
            self.emit("note", f"Removed {r['sentence_id']}: {r['reason']}")
        memo, notes = scrub_summary_lines(memo, self.retrieved)
        for note in notes:
            self.emit("note", note)
        verdicts: list[Verdict] = []
        if memo.sections:
            verdicts = model_check(
                memo,
                self.sources,
                model=self.model,
                model_id=self.cfg.models.checker,
                on_response=lambda r: self.account(r, self.cfg.models.checker),
            )
        memo, unsupported = apply_verdicts(memo, verdicts)
        removed += unsupported
        kept = {s.id for s in memo.sections}
        supported = sum(v.verdict == "supported" and v.sentence_id in kept for v in verdicts)
        partly = sum(v.verdict == "partly" and v.sentence_id in kept for v in verdicts)
        self.emit(
            "check",
            f"checking {n} claims … {supported} supported, {partly} partly, {len(removed)} removed",
        )
        self.verdicts, self.removed = verdicts, removed
        memo, self.judgement_shown, self.judgement_adjusted = settle_judgement(memo, verdicts)
        if self.judgement_adjusted:
            n_dropped = self.judgement_adjusted["reasons_removed"]
            self.emit(
                "note",
                f"Judgement kept with {_plural(n_dropped, 'unsupported reason')} dropped; "
                f"confidence {self.judgement_adjusted['confidence_was']} → "
                f"{memo.judgement.confidence}",
            )
        return memo

    def execute(self) -> Memo | None:
        self.emit("plan", f"Planning: {self.label or self.req.target} · {self.req.disease}")
        self.messages.append(self.first_message())
        self.gather()
        memo = self.write()
        if memo is None:
            self.emit("error", "memo could not be produced")
            return None
        memo = self.finish(memo)
        self.emit("done", "Done")
        return memo


def run_agent(
    req: RunRequest,
    *,
    cfg: AgentConfig,
    model: ModelClient,
    ctx: ToolContext,
    sink: StepSink,
    clock: Callable[[], float] = time.monotonic,
    run_id: str | None = None,
    fingerprint: str = "",
    data_date: str = "",
    label: str | None = None,
    now: Callable[[], datetime] = lambda: datetime.now(UTC),
    dispatch_fn: DispatchFn | None = None,
) -> RunRecord:
    """Run the agent and return its record.

    Any failure ends the run as status "failed" with an `error` step naming only the exception
    class ("model call failed" if it came from a planner/writer call, else "run failed"); the
    message goes to the log only.
    ReplayMismatch is deliberately re-raised:
    replay drift must fail CI loudly, not become a quiet failed run.
    """
    stamp = "%Y-%m-%dT%H:%M:%SZ"
    started = now().strftime(stamp)
    run_id = run_id or uuid.uuid4().hex
    token = current_run.set(run_id)
    try:
        run = _Run(req, cfg, model, ctx, sink, clock, label, data_date, dispatch_fn)
        try:
            memo = run.execute()
        except ReplayMismatch:
            raise
        except Exception as exc:  # noqa: BLE001 - a failed model call must still end the run
            prefix = "model call failed" if run.model_failed else "run failed"
            # The page gets the class only; the log gets the message (R42).
            log_error("model" if run.model_failed else "run", exc)
            run.emit("error", f"{prefix}: {type(exc).__name__}")
            memo = None
    finally:
        current_run.reset(token)
    return RunRecord(
        run_id=run_id,
        target=req.target,
        disease=req.disease,
        fingerprint=fingerprint,
        agent_version=cfg.agent_version,
        status="done" if memo is not None else "failed",
        started_at=started,
        finished_at=now().strftime(stamp),
        steps=run.steps,
        memo=memo,
        verdicts=run.verdicts,
        removed=run.removed,
        judgement_shown=run.judgement_shown,
        judgement_adjusted=run.judgement_adjusted,
        models=cfg.models.model_dump(),
        tokens_in=run.tokens_in,
        tokens_out=run.tokens_out,
        cost_usd=run.cost,
        data_date=data_date,
    )
