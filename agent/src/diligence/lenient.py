"""Tolerant decoding of tool arguments from models that package them loosely.

Open models on Bedrock cannot be forced to call a tool, and sometimes: answer with the call as JSON
text, wrap it as {"name": ..., "arguments": {...}}, or send a list field as a JSON string. These
helpers recover the intended arguments; the result still goes through the normal validation.
"""

import json
from typing import Any

_WRAPPER_KEYS = ("arguments", "input", "parameters")


def json_from_text(content: list[dict[str, Any]]) -> dict[str, Any] | None:
    """The first JSON object in the response's text blocks, if any (code fences allowed)."""
    text = "".join(b.get("text", "") for b in content)
    start = text.find("{")
    if start == -1:
        return None
    try:
        # The first complete object; trailing text (a stray brace, a closing fence) is ignored.
        value, _ = json.JSONDecoder().raw_decode(text, start)
    except ValueError:
        return None
    return value if isinstance(value, dict) else None


def unwrap_call(value: dict[str, Any], tool: str) -> dict[str, Any]:
    """{"name": tool, "arguments": {...}} -> the arguments; anything else is returned as is."""
    if value.get("name") == tool:
        for key in _WRAPPER_KEYS:
            inner = value.get(key)
            if isinstance(inner, str):
                inner = _loads(inner)
            if isinstance(inner, dict):
                return inner
    return value


def decode_string_fields(value: dict[str, Any]) -> dict[str, Any]:
    """Top-level fields sent as a JSON string of a list or object are decoded."""
    out = dict(value)
    for key, field in value.items():
        if isinstance(field, str) and field.lstrip()[:1] in ("[", "{"):
            decoded = _loads(field)
            if isinstance(decoded, (list, dict)):
                out[key] = decoded
    return out


def tool_arguments(content: list[dict[str, Any]], tool: str) -> dict[str, Any] | None:
    """The arguments of a call to `tool` in a response: a real toolUse, else JSON text."""
    use = next((b["toolUse"] for b in content if b.get("toolUse", {}).get("name") == tool), None)
    raw: Any = use.get("input") if use else json_from_text(content)
    if isinstance(raw, str):
        raw = _loads(raw)
    if not isinstance(raw, dict):
        return None
    return decode_string_fields(unwrap_call(raw, tool))


def _loads(text: str) -> Any:
    try:
        return json.loads(text)
    except ValueError:
        return None
