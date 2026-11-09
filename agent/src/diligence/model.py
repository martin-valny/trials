"""Model seam: a ModelClient protocol with Bedrock, recording and replay implementations."""

import hashlib
import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Protocol

import boto3
from botocore.config import Config

from diligence import prompts
from diligence.config import AgentConfig
from diligence.tools.registry_of_tools import TOOL_SPECS

_CACHE_POINT = {"cachePoint": {"type": "default"}}


@dataclass(frozen=True)
class ModelResponse:
    stop_reason: str
    content: list[dict[str, Any]]
    tokens_in: int
    tokens_out: int


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
        json.dumps(TOOL_SPECS, sort_keys=True),
        json.dumps(prompts.VERDICTS_TOOL, sort_keys=True),
        json.dumps(cfg.models.model_dump(), sort_keys=True),
    ]
    return _sha("\x00".join(parts))


class BedrockModel:
    def __init__(self, region: str, client: Any | None = None) -> None:
        self._client: Any = client or boto3.client(
            "bedrock-runtime",
            region_name=region,
            config=Config(
                read_timeout=60,
                connect_timeout=5,
                retries={"max_attempts": 2, "mode": "standard"},
            ),
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
            "system": [{"text": system}, _CACHE_POINT],
            "messages": messages,
            "inferenceConfig": {"maxTokens": max_tokens},
        }
        if tools:
            request["toolConfig"] = {"tools": [*tools, _CACHE_POINT]}
            if tool_choice:
                request["toolConfig"]["toolChoice"] = {"tool": {"name": tool_choice}}
        out = self._client.converse(**request)
        usage = out.get("usage", {})
        return ModelResponse(
            stop_reason=out["stopReason"],
            content=out["output"]["message"]["content"],
            # Cached tokens are still input; count them toward the run's input budget.
            tokens_in=usage.get("inputTokens", 0)
            + usage.get("cacheReadInputTokens", 0)
            + usage.get("cacheWriteInputTokens", 0),
            tokens_out=usage.get("outputTokens", 0),
        )


def _request_record(
    model: str,
    system: str,
    messages: list[dict[str, Any]],
    max_tokens: int,
    tool_choice: str | None,
) -> dict[str, Any]:
    return {
        "tool_choice": tool_choice,
        "model": model,
        "system_hash": _sha(system),
        "messages_hash": _hash_json(messages),
        "max_tokens": max_tokens,
    }


class RecordingModel:
    """Wraps a client and appends each call as a `kind: model` JSONL line."""

    def __init__(self, inner: ModelClient, path: Path) -> None:
        self._inner = inner
        self._path = path

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
        line = {
            "kind": "model",
            "request": {
                **_request_record(model, system, messages, max_tokens, tool_choice),
                "messages": messages,
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
        expected = line["request"]["messages_hash"]
        got = _hash_json(messages)
        if got != expected:
            raise ReplayMismatch(
                f"messages_hash differs at model call index {self._next} (file line {index}): "
                f"expected {expected[:12]}, got {got[:12]}; re-record the evaluation"
            )
        self._next += 1
        r = line["response"]
        return ModelResponse(r["stop_reason"], r["content"], r["tokens_in"], r["tokens_out"])
