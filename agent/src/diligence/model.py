"""Model seam: a ModelClient protocol with Bedrock, recording and replay implementations."""

import hashlib
import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Protocol

import boto3
from botocore.config import Config

from diligence import prompts
from diligence.config import AgentConfig, Price
from diligence.tools.registry_of_tools import WRITER_TOOLS

CACHE_POINT: dict[str, Any] = {"cachePoint": {"type": "default"}}


@dataclass(frozen=True)
class ModelResponse:
    stop_reason: str
    content: list[dict[str, Any]]
    # All input tokens, cached or not (what the run's input cap counts).
    tokens_in: int
    tokens_out: int
    # The cached part of tokens_in: read from, and written to, the prompt cache.
    cache_read: int = 0
    cache_write: int = 0


def response_cost(resp: ModelResponse, price: Price) -> float:
    """USD for one response; cache reads and writes use their own prices when configured."""
    read_price = (
        price.input_per_mtok if price.cache_read_per_mtok is None else price.cache_read_per_mtok
    )
    write_price = (
        price.input_per_mtok if price.cache_write_per_mtok is None else price.cache_write_per_mtok
    )
    plain = max(resp.tokens_in - resp.cache_read - resp.cache_write, 0)
    return (
        plain * price.input_per_mtok
        + resp.cache_read * read_price
        + resp.cache_write * write_price
        + resp.tokens_out * price.output_per_mtok
    ) / 1e6


class ModelClient(Protocol):
    def converse(
        self,
        *,
        model: str,
        system: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        max_tokens: int,
        tool_choice: str | None = None,
    ) -> ModelResponse: ...


class ReplayMismatch(Exception):
    """The request made during replay differs from the recorded one."""


def _sha(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def _hash_json(value: Any) -> str:
    return _sha(json.dumps(value, sort_keys=True))


def prompt_hash(cfg: AgentConfig) -> str:
    """Hash of everything that shapes model behaviour: prompts, tool schemas, model IDs."""
    parts = [
        prompts.SYSTEM_PROMPT,
        prompts.CHECKER_PROMPT,
        json.dumps(WRITER_TOOLS, sort_keys=True),
        json.dumps(prompts.VERDICTS_TOOL, sort_keys=True),
        json.dumps(cfg.models.model_dump(), sort_keys=True),
    ]
    return _sha("\x00".join(parts))


def bedrock_client_config() -> Config:
    """Timeouts and retries for every bedrock-runtime client (Lambda and record_eval)."""
    return Config(
        read_timeout=60,
        connect_timeout=5,
        retries={"max_attempts": 2, "mode": "standard"},
    )


class BedrockModel:
    def __init__(self, region: str, client: Any | None = None) -> None:
        self._client: Any = client or boto3.client(
            "bedrock-runtime", region_name=region, config=bedrock_client_config()
        )

    def converse(
        self,
        *,
        model: str,
        system: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        max_tokens: int,
        tool_choice: str | None = None,
    ) -> ModelResponse:
        request: dict[str, Any] = {
            "modelId": model,
            "system": [{"text": system}, CACHE_POINT],
            "messages": messages,
            "inferenceConfig": {"maxTokens": max_tokens},
        }
        if tools:
            request["toolConfig"] = {"tools": [*tools, CACHE_POINT]}
            if tool_choice:
                request["toolConfig"]["toolChoice"] = {"tool": {"name": tool_choice}}
        out = self._client.converse(**request)
        usage = out.get("usage", {})
        cache_read = usage.get("cacheReadInputTokens", 0)
        cache_write = usage.get("cacheWriteInputTokens", 0)
        return ModelResponse(
            stop_reason=out["stopReason"],
            content=out["output"]["message"]["content"],
            # Cached tokens are still input; count them toward the run's input budget.
            tokens_in=usage.get("inputTokens", 0) + cache_read + cache_write,
            tokens_out=usage.get("outputTokens", 0),
            cache_read=cache_read,
            cache_write=cache_write,
        )


def _request_record(
    model: str,
    system: str,
    messages: list[dict[str, Any]],
    max_tokens: int,
    tool_choice: str | None,
    tools: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "tool_choice": tool_choice,
        "model": model,
        "system_hash": _sha(system),
        "tools_hash": _hash_json(tools),
        "messages_hash": _hash_json(messages),
        "max_tokens": max_tokens,
    }


def _without_cache_points(message: dict[str, Any]) -> dict[str, Any]:
    return {**message, "content": [b for b in message["content"] if "cachePoint" not in b]}


def _shared_prefix(prev: list[dict[str, Any]], messages: list[dict[str, Any]]) -> int:
    """How many leading messages equal the previous request's (cache points ignored)."""
    n = 0
    for a, b in zip(prev, messages, strict=False):
        if _without_cache_points(a) != _without_cache_points(b):
            break
        n += 1
    return n


class RecordingModel:
    """Wraps a client and appends each call as a `kind: model` JSONL line.

    The request's messages are stored as a delta to keep recordings small: `messages_prefix` is how
    many leading messages equal the previous request's (cache points ignored) and
    `messages_tail` holds the rest. Replay compares `messages_hash`, which covers all of them.
    """

    def __init__(self, inner: ModelClient, path: Path) -> None:
        self._inner = inner
        self._path = path
        self._prev: list[dict[str, Any]] = []

    def converse(
        self,
        *,
        model: str,
        system: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        max_tokens: int,
        tool_choice: str | None = None,
    ) -> ModelResponse:
        response = self._inner.converse(
            model=model,
            system=system,
            messages=messages,
            tools=tools,
            max_tokens=max_tokens,
            tool_choice=tool_choice,
        )
        prefix = _shared_prefix(self._prev, messages)
        self._prev = messages
        line = {
            "kind": "model",
            "request": {
                **_request_record(model, system, messages, max_tokens, tool_choice, tools),
                "messages_prefix": prefix,
                "messages_tail": messages[prefix:],
            },
            "response": asdict(response),
        }
        self._path.parent.mkdir(parents=True, exist_ok=True)
        with self._path.open("a") as f:
            f.write(json.dumps(line) + "\n")
        return response


def read_lines(path: Path) -> list[dict[str, Any]]:
    """All JSONL lines of a recording, in order, whatever their kind."""
    return [json.loads(x) for x in path.read_text().splitlines() if x.strip()]


class ReplayModel:
    """Returns recorded responses in order; ignores non-model lines."""

    def __init__(self, path: Path) -> None:
        self._calls = [
            (i, line) for i, line in enumerate(read_lines(path)) if line.get("kind") == "model"
        ]
        self._next = 0

    def converse(
        self,
        *,
        model: str,
        system: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        max_tokens: int,
        tool_choice: str | None = None,
    ) -> ModelResponse:
        if self._next >= len(self._calls):
            raise ReplayMismatch(
                f"recording exhausted after {len(self._calls)} model calls; re-record the evaluation"
            )
        index, line = self._calls[self._next]
        want = line["request"]
        got = _request_record(model, system, messages, max_tokens, tool_choice, tools)
        for field in (
            "model",
            "system_hash",
            "tools_hash",
            "tool_choice",
            "max_tokens",
            "messages_hash",
        ):
            if got[field] != want.get(field):
                detail = f"expected {str(want.get(field))[:12]}, got {str(got[field])[:12]}"
                raise ReplayMismatch(
                    f"{field} differs at model call index {self._next} (file line {index}): "
                    f"{detail}; re-record the evaluation"
                )
        self._next += 1
        r = line["response"]
        return ModelResponse(
            r["stop_reason"],
            r["content"],
            r["tokens_in"],
            r["tokens_out"],
            r.get("cache_read", 0),
            r.get("cache_write", 0),
        )
