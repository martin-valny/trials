import json
from typing import Any

import pytest

from diligence.checker import (
    apply_verdicts,
    deterministic_check,
    gate_judgement,
    model_check,
    scrub_summary_lines,
)
from diligence.model import ModelResponse
from diligence.prompts import CHECKER_PROMPT, VERDICTS_TOOL
from diligence.types import Memo, Sentence, Verdict


def memo_of(*sentences: tuple[str, str, list[str]], reasons: list[str] | None = None) -> Memo:
    return Memo.model_validate(
        {
            "sections": [
                {"id": i, "section": "landscape", "text": t, "cites": c} for i, t, c in sentences
            ],
            "read": ["a", "b", "c"],
            "judgement": {
                "stance": "mixed",
                "confidence": "low",
                "reasons": reasons if reasons is not None else [sentences[0][0]],
            },
            "would_change": ["x"],
        }
    )


def ids(memo: Memo) -> list[str]:
    return [s.id for s in memo.sections]


def test_unretrieved_cite_removed() -> None:
    memo = memo_of(("s1", "Fine.", ["NCT90000001"]), ("s2", "Invented.", ["PMID:123"]))
    out, removed = deterministic_check(memo, {"NCT90000001"}, {"NCT90000001": "x"})
    assert ids(out) == ["s1"]
    assert removed == [
        {
            "sentence_id": "s2",
            "text": "Invented.",
            "reason": "cites PMID:123, not retrieved in this run",
        }
    ]


def test_uncited_sentence_removed() -> None:
    memo = memo_of(("s1", "Fine.", ["NCT90000001"]), ("s2", "Bare claim.", []))
    out, removed = deterministic_check(memo, {"NCT90000001"}, {})
    assert ids(out) == ["s1"]
    assert removed[0]["sentence_id"] == "s2" and removed[0]["reason"] == "no citation"


def test_number_not_in_source_removed() -> None:
    memo = memo_of(("s1", "It enrolled 412 patients.", ["NCT90000001"]))
    src = {"NCT90000001": '{"nct":"NCT90000001","enrollment":214}'}
    out, removed = deterministic_check(memo, {"NCT90000001"}, src)
    assert out.sections == []
    assert removed[0]["reason"] == "number not found in cited sources"


@pytest.mark.parametrize(
    ("text", "source", "kept"),
    [
        ("It enrolled 412 patients.", '{"n":412}', True),
        ("It enrolled 1,200 patients.", '{"n":1200}', True),
        ("A 42.8% response.", '{"rate":42.8}', True),
        ("A 42.8% response.", '{"rate":42}', False),
        ("A 21 month gap.", '{"n":214}', False),  # not a substring of a longer number
        ("A 21 month gap.", '{"n":"x 21 y"}', True),
        ("Phase 2 trial with 3 arms.", "{}", True),  # single digits ignored
        ("Started in 2019.", '{"start":"2019-05"}', True),
        ("Started in 2019.", '{"start":"2018-05"}', False),
        ("Started in 2019.", '{"a":1,"b":2019}', True),
        ("Targets CD20 in NCT90000001.", "{}", True),  # digits in ids/identifiers ignored
        ("Cites PMID:123456 here.", "{}", True),
    ],
)
def test_number_rules(text: str, source: str, kept: bool) -> None:
    cites = ["PMID:123456"] if "PMID" in text else ["NCT90000001"]
    memo = memo_of(("s1", text, cites))
    retrieved = {cites[0]}
    out, _ = deterministic_check(memo, retrieved, {cites[0]: source})
    assert bool(out.sections) is kept


def test_numbers_checked_against_own_cites_only() -> None:
    memo = memo_of(("s1", "It enrolled 412 patients.", ["NCT90000001"]))
    src = {"NCT90000001": '{"n":214}', "NCT90000002": '{"n":412}'}
    out, _ = deterministic_check(memo, set(src), src)
    assert out.sections == []


def test_checks_do_not_mutate_input() -> None:
    memo = memo_of(("s1", "Bare.", []))
    deterministic_check(memo, set(), {})
    assert ids(memo) == ["s1"]


# -- model_check -------------------------------------------------------------------------------


def verdict_resp(entries: list[dict[str, Any]], tin: int = 10, tout: int = 5) -> ModelResponse:
    block = {
        "toolUse": {"toolUseId": "v", "name": "submit_verdicts", "input": {"verdicts": entries}}
    }
    return ModelResponse("tool_use", [block], tin, tout)


class FakeChecker:
    def __init__(self, entries: list[Any]) -> None:
        self.entries = list(entries)
        self.calls: list[dict[str, Any]] = []

    def converse(self, **kw: Any) -> ModelResponse:
        self.calls.append(kw)
        e = self.entries.pop(0)
        if isinstance(e, Exception):
            raise e
        return e


def v(i: str, verdict: str = "supported", reason: str = "ok") -> dict[str, str]:
    return {"sentence_id": i, "verdict": verdict, "reason": reason}


def test_model_check_one_call_with_cited_sources_only() -> None:
    memo = memo_of(("s1", "One.", ["NCT90000001"]), ("s2", "Two.", ["NCT90000002"]))
    src = {"NCT90000001": "alpha text", "NCT90000002": "beta text", "NCT90000003": "gamma"}
    fake = FakeChecker([verdict_resp([v("s1"), v("s2", "partly", "loose")])])
    out = model_check(memo, src, model=fake, model_id="chk")
    assert [(x.sentence_id, x.verdict) for x in out] == [("s1", "supported"), ("s2", "partly")]
    (call,) = fake.calls
    assert call["model"] == "chk" and call["system"] == CHECKER_PROMPT
    assert call["tools"] == [VERDICTS_TOOL] and call["tool_choice"] == "submit_verdicts"
    assert call["max_tokens"] == 2000
    (msg,) = call["messages"]
    text = msg["content"][0]["text"]
    assert "alpha text" in text and "beta text" in text and "gamma" not in text


def test_model_check_batches_of_ten_fresh_conversations() -> None:
    sents = [(f"s{i}", f"Claim {i}.", ["NCT90000001"]) for i in range(1, 24)]
    memo = memo_of(*sents)
    fake = FakeChecker(
        [
            verdict_resp([v(f"s{i}") for i in range(1, 11)]),
            verdict_resp([v(f"s{i}") for i in range(11, 21)]),
            verdict_resp([v(f"s{i}") for i in range(21, 24)]),
        ]
    )
    out = model_check(memo, {"NCT90000001": "t"}, model=fake, model_id="chk")
    assert len(out) == 23 and len(fake.calls) == 3
    assert all(len(c["messages"]) == 1 for c in fake.calls)
    assert "Claim 11." in fake.calls[1]["messages"][0]["content"][0]["text"]
    assert "Claim 5." not in fake.calls[1]["messages"][0]["content"][0]["text"]


def test_model_check_failure_marks_batch_not_checked() -> None:
    memo = memo_of(("s1", "One.", ["NCT90000001"]))
    out = model_check(memo, {}, model=FakeChecker([TimeoutError("secret")]), model_id="chk")
    assert out == [
        Verdict(sentence_id="s1", verdict="partly", reason="not checked: checker unavailable")
    ]


def test_model_check_unusable_output_marks_not_checked() -> None:
    memo = memo_of(("s1", "One.", ["NCT90000001"]))
    junk = ModelResponse("end_turn", [{"text": "no tool"}], 1, 1)
    out = model_check(memo, {}, model=FakeChecker([junk]), model_id="chk")
    assert out[0].verdict == "partly" and out[0].reason == "not checked: checker unavailable"


def test_model_check_ignores_invented_ids_and_fills_missing() -> None:
    memo = memo_of(("s1", "One.", ["NCT90000001"]), ("s2", "Two.", ["NCT90000001"]))
    fake = FakeChecker([verdict_resp([v("s1"), v("s99", "unsupported"), {"bad": 1}])])
    out = model_check(memo, {}, model=fake, model_id="chk")
    assert [x.sentence_id for x in out] == ["s1", "s2"]
    assert out[1].verdict == "partly" and out[1].reason.startswith("not checked")


def test_model_check_reports_usage() -> None:
    memo = memo_of(("s1", "One.", ["NCT90000001"]))
    seen: list[tuple[int, int]] = []
    model_check(
        memo,
        {},
        model=FakeChecker([verdict_resp([v("s1")], 7, 3)]),
        model_id="chk",
        on_response=lambda r: seen.append((r.tokens_in, r.tokens_out)),
    )
    assert seen == [(7, 3)]


def test_replay_mismatch_propagates() -> None:
    from diligence.model import ReplayMismatch

    memo = memo_of(("s1", "One.", ["NCT90000001"]))
    with pytest.raises(ReplayMismatch):
        model_check(memo, {}, model=FakeChecker([ReplayMismatch("x")]), model_id="chk")


# -- apply_verdicts / gate ---------------------------------------------------------------------


def test_partly_kept_with_mark() -> None:
    memo = memo_of(("s1", "One.", ["NCT90000001"]), ("s2", "Two.", ["NCT90000001"]))
    verdicts = [
        Verdict(sentence_id="s1", verdict="partly", reason="loose"),
        Verdict(sentence_id="s2", verdict="unsupported", reason="not stated"),
    ]
    out, removed = apply_verdicts(memo, verdicts)
    assert ids(out) == ["s1"]  # kept; the verdict list carries the mark and reason
    assert removed == [{"sentence_id": "s2", "text": "Two.", "reason": "not stated"}]


def test_judgement_withheld_if_reason_partly() -> None:
    memo = memo_of(
        ("s1", "One.", ["NCT90000001"]), ("s2", "Two.", ["NCT90000001"]), reasons=["s1", "s2"]
    )
    verdicts = [
        Verdict(sentence_id="s1", verdict="supported", reason=""),
        Verdict(sentence_id="s2", verdict="partly", reason="loose"),
    ]
    assert gate_judgement(memo, verdicts) is False


def test_judgement_shown_when_all_reasons_supported() -> None:
    memo = memo_of(
        ("s1", "One.", ["NCT90000001"]), ("s2", "Two.", ["NCT90000001"]), reasons=["s1", "s2"]
    )
    verdicts = [Verdict(sentence_id=i, verdict="supported", reason="") for i in ("s1", "s2")]
    assert gate_judgement(memo, verdicts) is True


def test_judgement_withheld_for_removed_unknown_or_missing_reason_ids() -> None:
    memo = memo_of(("s1", "One.", ["NCT90000001"]), reasons=["s1", "s9"])
    sup = [
        Verdict(sentence_id="s1", verdict="supported", reason=""),
        Verdict(sentence_id="s9", verdict="supported", reason=""),
    ]
    assert gate_judgement(memo, sup) is False  # s9 is not in the memo
    assert gate_judgement(memo_of(("s1", "One.", ["NCT90000001"]), reasons=["s1"]), []) is False
    assert gate_judgement(memo_of(("s1", "One.", ["NCT90000001"]), reasons=[]), sup) is False


def test_json_serialisable_removed() -> None:
    memo = memo_of(("s1", "Bare.", []))
    _, removed = deterministic_check(memo, set(), {})
    json.dumps(removed)


# -- fix round 1 -------------------------------------------------------------------------------


def raw_memo(sentences: list[dict[str, Any]]) -> Memo:
    base = memo_of(("s1", "x", ["NCT90000001"]))
    return Memo.model_construct(**{**base.__dict__, "sections": [Sentence(**s) for s in sentences]})


def test_memo_rejects_duplicate_sentence_ids() -> None:
    with pytest.raises(ValueError, match="unique"):
        memo_of(("s1", "One.", ["NCT90000001"]), ("s1", "Two.", ["NCT90000001"]))


def test_duplicate_ids_removed_in_deterministic_check() -> None:
    def sent(text: str) -> dict[str, Any]:
        return {"id": "s1", "section": "landscape", "text": text, "cites": ["NCT90000001"]}

    memo = raw_memo([sent("First."), sent("Second.")])
    out, removed = deterministic_check(memo, {"NCT90000001"}, {})
    assert [s.text for s in out.sections] == ["First."]
    assert removed == [{"sentence_id": "s1", "text": "Second.", "reason": "duplicate sentence id"}]


def test_scrub_summary_lines() -> None:
    memo = memo_of(("s1", "One.", ["NCT90000001"]))
    memo = memo.model_copy(
        update={
            "read": ["See NCT12345678 and NCT90000001.", "plain", "PMID:5 too"],
            "would_change": ["A result like FDA:abc-1"],
        }
    )
    out, notes = scrub_summary_lines(memo, {"NCT90000001"})
    assert out.read == [
        "See [reference removed] and NCT90000001.",
        "plain",
        "[reference removed] too",
    ]
    assert out.would_change == ["A result like [reference removed]"]
    assert len(out.read) == 3
    assert notes == [
        "Removed reference NCT12345678 from read line 1: not retrieved",
        "Removed reference PMID:5 from read line 3: not retrieved",
        "Removed reference FDA:abc-1 from would_change line 1: not retrieved",
    ]


def test_prompt_states_untrusted_sentences_and_sources() -> None:
    low = CHECKER_PROMPT.lower()
    assert "sentences" in low and "untrusted" in low and "ignore any instructions" in low


def test_batch_payload_dedupes_and_caps_sources() -> None:
    memo = memo_of(("s1", "One.", ["NCT90000001"]), ("s2", "Two.", ["NCT90000001"]))
    fake = FakeChecker([verdict_resp([v("s1"), v("s2")])])
    model_check(memo, {"NCT90000001": "A" * 9000}, model=fake, model_id="chk")
    text = fake.calls[0]["messages"][0]["content"][0]["text"]
    payload = json.loads(text[text.index("{") :])
    assert [x["id"] for x in payload["sources"]] == ["NCT90000001"]
    assert len(payload["sources"][0]["text"]) == 4000
    assert [x["sentence_id"] for x in payload["sentences"]] == ["s1", "s2"]
    assert payload["sentences"][0]["sentence"] == "One."


@pytest.mark.parametrize(
    ("text", "source", "kept"),
    [
        ("Enrolled 412 patients.", '{"a":[412,500]}', True),
        ("Enrolled 412,500 patients.", '{"a":[412,500]}', True),
        ("Enrolled 412 patients.", None, False),  # retrieved cite with no source text
    ],
)
def test_source_edge_cases(text: str, source: str | None, kept: bool) -> None:
    memo = memo_of(("s1", text, ["NCT90000001"]))
    srcs = {} if source is None else {"NCT90000001": source}
    out, _ = deterministic_check(memo, {"NCT90000001"}, srcs)
    assert bool(out.sections) is kept


@pytest.mark.parametrize("cite", ["FDA:abc-123456", "PPR123456", "CHEMBL123456"])
def test_other_ids_stripped_before_numbers(cite: str) -> None:
    memo = memo_of(("s1", f"Per {cite} this holds.", [cite]))
    out, _ = deterministic_check(memo, {cite}, {cite: "{}"})
    assert len(out.sections) == 1
