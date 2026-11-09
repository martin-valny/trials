"""The checker wired into the loop (R3): check step, removals, verdicts, judgement gate."""

from typing import Any

import httpx
import pytest
from test_loop import (
    Entry,
    ScriptedModel,
    fake_results,
    make_cfg,
    memo_resp,
    resp,
    run,
    use,
    valid_memo,
)

from diligence import loop
from diligence.model import ModelResponse
from diligence.prompts import CHECKER_PROMPT
from diligence.tools.registry_of_tools import ToolContext
from diligence.types import RunRecord, Step


@pytest.fixture(autouse=True)
def _dispatch(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(loop, "dispatch", fake_results)


@pytest.fixture
def tctx() -> ToolContext:
    return ToolContext(http=httpx.Client(), base_url="https://example.test/")


def two_sentence_memo(reasons: list[str]) -> dict[str, Any]:
    memo = valid_memo()
    memo["sections"].append(
        {"id": "s2", "section": "track_record", "text": "Invented.", "cites": ["PMID:777"]}
    )
    memo["judgement"]["reasons"] = reasons
    return memo


def verdicts(*entries: tuple[str, str], tin: int = 40, tout: int = 8) -> ModelResponse:
    items = [{"sentence_id": i, "verdict": v, "reason": f"{v} reason"} for i, v in entries]
    block = {"toolUse": {"toolUseId": "c", "name": "submit_verdicts", "input": {"verdicts": items}}}
    return resp([block], tin=tin, tout=tout)


def run_with(memo: dict[str, Any], checker: list[Entry], tctx: ToolContext):  # type: ignore[no-untyped-def]
    model = ScriptedModel(
        [
            resp([use("site_target", {}, "a")]),
            resp([use("submit_memo", memo, "d")]),
            memo_resp(memo, tin=0, tout=0),
            *checker,
        ]
    )
    rec, steps = run(model, tctx, make_cfg())
    return model, rec, steps


def kinds(steps: list[Step]) -> list[str]:
    return [s.kind for s in steps]


def test_all_supported_shows_judgement(tctx: ToolContext) -> None:
    model, rec, steps = run_with(valid_memo(), [verdicts(("s1", "supported"))], tctx)
    assert rec.status == "done" and rec.judgement_shown is True
    assert rec.removed == [] and [v.verdict for v in rec.verdicts] == ["supported"]
    assert kinds(steps)[-2:] == ["check", "done"]
    assert steps[-2].text == "checking 1 claims … 1 supported, 0 partly, 0 removed"
    cfg = make_cfg()
    chk = model.calls[-1]
    assert chk["model"] == cfg.models.checker and chk["system"] == CHECKER_PROMPT
    assert chk["tool_choice"] == "submit_verdicts"
    # Checker tokens land on the check step and in the run totals.
    assert (steps[-2].tokens_in, steps[-2].tokens_out) == (40, 8)
    assert rec.tokens_in == 100 + 100 + 0 + 40 and rec.tokens_out == 50 + 50 + 0 + 8


def test_unretrieved_cite_removed_with_note_and_counts(tctx: ToolContext) -> None:
    model, rec, steps = run_with(two_sentence_memo(["s1"]), [verdicts(("s1", "supported"))], tctx)
    assert [s.id for s in rec.memo.sections] == ["s1"]  # type: ignore[union-attr]
    assert rec.removed == [
        {
            "sentence_id": "s2",
            "text": "Invented.",
            "reason": "cites PMID:777, not retrieved in this run",
        }
    ]
    note = next(s for s in steps if s.kind == "note")
    assert note.text == "Removed s2: cites PMID:777, not retrieved in this run"
    assert steps[-2].text == "checking 2 claims … 1 supported, 0 partly, 1 removed"
    # Only the surviving sentence went to the checker.
    sent = model.calls[-1]["messages"][0]["content"][0]["text"]
    assert "Invented." not in sent
    assert rec.judgement_shown is True


def test_judgement_reason_pointing_at_removed_sentence_is_withheld(tctx: ToolContext) -> None:
    _, rec, _ = run_with(two_sentence_memo(["s1", "s2"]), [verdicts(("s1", "supported"))], tctx)
    assert rec.judgement_shown is False


def test_unsupported_removed_by_model_check(tctx: ToolContext) -> None:
    _, rec, steps = run_with(valid_memo(), [verdicts(("s1", "unsupported"))], tctx)
    assert rec.memo.sections == []  # type: ignore[union-attr]
    assert rec.removed == [
        {
            "sentence_id": "s1",
            "text": "Three trials test CD20 in MS.",
            "reason": "unsupported reason",
        }
    ]
    assert steps[-2].text == "checking 1 claims … 0 supported, 0 partly, 1 removed"
    assert rec.judgement_shown is False


def test_partly_counts_and_withholds(tctx: ToolContext) -> None:
    _, rec, steps = run_with(valid_memo(), [verdicts(("s1", "partly"))], tctx)
    assert steps[-2].text == "checking 1 claims … 0 supported, 1 partly, 0 removed"
    assert rec.judgement_shown is False and len(rec.memo.sections) == 1  # type: ignore[union-attr]


def test_checker_failure_still_finishes_done(tctx: ToolContext) -> None:
    def boom() -> ModelResponse:
        raise TimeoutError("secret")

    _, rec, steps = run_with(valid_memo(), [boom], tctx)
    assert rec.status == "done" and rec.judgement_shown is False
    assert rec.verdicts[0].verdict == "partly"
    assert rec.verdicts[0].reason == "not checked: checker unavailable"
    assert steps[-2].text == "checking 1 claims … 0 supported, 1 partly, 0 removed"
    assert kinds(steps)[-1] == "done"


def test_checker_runs_after_caps_and_cost_is_added(tctx: ToolContext) -> None:
    cfg = make_cfg(max_tool_calls=1)
    model = ScriptedModel(
        [
            resp([use("site_target", {}, "a"), use("fda_label", {}, "b")], tin=10, tout=60),
            memo_resp(valid_memo(), tin=0, tout=0),
            verdicts(("s1", "supported"), tin=1_000_000, tout=0),
        ]
    )
    from diligence.config import Price

    cfg = cfg.model_copy(
        update={
            "prices": {
                **cfg.prices,
                cfg.models.checker: Price(input_per_mtok=2.0, output_per_mtok=0.0),
            }
        }
    )
    rec, steps = run(model, tctx, cfg)
    assert any(s.kind == "limit" for s in steps)
    assert rec.judgement_shown is True
    assert rec.cost_usd >= 2.0


def test_number_check_runs_in_loop(tctx: ToolContext) -> None:
    memo = valid_memo("It enrolled 412 patients.")
    _, rec, steps = run_with(memo, [], tctx)  # no checker call: nothing survives the numbers
    assert rec.removed[0]["reason"] == "number not found in cited sources"
    assert steps[-2].text == "checking 1 claims … 0 supported, 0 partly, 1 removed"
    assert isinstance(rec, RunRecord)


def test_summary_lines_scrubbed_with_notes(tctx: ToolContext) -> None:
    memo = valid_memo()
    memo["read"] = ["See NCT12345678.", "b", "c"]
    _, rec, steps = run_with(memo, [verdicts(("s1", "supported"))], tctx)
    assert rec.memo.read == ["See [reference removed].", "b", "c"]  # type: ignore[union-attr]
    assert "Removed reference NCT12345678 from read line 1: not retrieved" in [
        s.text for s in steps if s.kind == "note"
    ]


def test_number_removal_has_note_step(tctx: ToolContext) -> None:
    _, _, steps = run_with(valid_memo("It enrolled 412 patients."), [], tctx)
    notes = [s.text for s in steps if s.kind == "note"]
    assert notes == ["Removed s1: number not found in cited sources"]
