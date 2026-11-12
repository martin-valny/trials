import json

from diligence.lenient import decode_string_fields, json_from_text, tool_arguments, unwrap_call


def test_real_tool_call_passes_through() -> None:
    content = [{"toolUse": {"name": "submit_memo", "input": {"sections": []}}}]
    assert tool_arguments(content, "submit_memo") == {"sections": []}


def test_list_field_sent_as_a_json_string_is_decoded() -> None:
    """DeepSeek V3.2 sent submit_verdicts' list as one string (cd20/MG, 2026-11-12)."""
    verdicts = [{"sentence_id": "s1", "verdict": "supported", "reason": "ok"}]
    content = [
        {"text": "I'll analyze each sentence."},
        {"toolUse": {"name": "submit_verdicts", "input": {"verdicts": json.dumps(verdicts)}}},
    ]
    assert tool_arguments(content, "submit_verdicts") == {"verdicts": verdicts}


def test_call_written_as_wrapped_json_text_is_unwrapped() -> None:
    """Qwen3 answered with {"name": "submit_memo", "arguments": {...}} as text (clemastine/MS)."""
    memo = {"sections": [], "read": ["a", "b", "c"]}
    text = json.dumps({"name": "submit_memo", "arguments": memo})
    assert tool_arguments([{"text": text}], "submit_memo") == memo


def test_fenced_json_text_and_string_arguments() -> None:
    text = "```json\n" + json.dumps({"name": "x", "arguments": json.dumps({"a": [1]})}) + "\n```"
    assert tool_arguments([{"text": text}], "x") == {"a": [1]}


def test_no_json_means_no_arguments() -> None:
    assert tool_arguments([{"text": "I will now write the memo."}], "submit_memo") is None
    assert tool_arguments([{"text": "{not json"}], "submit_memo") is None
    assert json_from_text([{"text": "[1, 2]"}]) is None


def test_other_tools_and_plain_strings_are_left_alone() -> None:
    assert unwrap_call({"name": "other", "arguments": {"a": 1}}, "submit_memo") == {
        "name": "other",
        "arguments": {"a": 1},
    }
    assert decode_string_fields({"text": "plain", "n": "[oops"}) == {"text": "plain", "n": "[oops"}
