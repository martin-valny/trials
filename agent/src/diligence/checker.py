"""Memo checker: deterministic citation and number checks, a model check, and the judgement gate.

All functions are pure apart from `model_check`, which calls the checker model. A failing checker
never crashes the run: affected sentences come back `partly` ("not checked") and the normal gate
then withholds the judgement.
"""

import json
import re
from collections.abc import Callable
from typing import Any

from pydantic import ValidationError

from diligence.model import ModelClient, ModelResponse, ReplayMismatch
from diligence.prompts import CHECKER_PROMPT, VERDICTS_TOOL
from diligence.types import CITE_SEARCH_PATTERN, Memo, Sentence, Verdict

BATCH_SIZE = 10
CHECKER_MAX_TOKENS = 2000
NOT_CHECKED = "not checked: checker unavailable"
NOT_CHECKED_MISSING = "not checked: no verdict returned"

_NUMBER = r"(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?!\d)"
# In a sentence, digits inside a word (CD20, IL6) are identifiers, not claims.
_SENTENCE_NUMBER = re.compile(r"(?<![\w.])" + _NUMBER)
_SOURCE_NUMBER = re.compile(r"(?<![\d.])" + _NUMBER)


def _sentence_numbers(text: str) -> list[str]:
    """Numeric claims in a sentence, normalised; single-digit integers are ignored."""
    stripped = CITE_SEARCH_PATTERN.sub(" ", text)
    out: list[str] = []
    for m in _SENTENCE_NUMBER.finditer(stripped):
        tok = m.group(0).replace(",", "")
        if re.fullmatch(r"\d", tok):
            continue
        out.append(tok)
    return out


def _source_numbers(text: str) -> set[str]:
    found: set[str] = set()
    for m in _SOURCE_NUMBER.finditer(text):
        raw = m.group(0)
        found.add(raw.replace(",", ""))
        if "," in raw:  # "[412,500]" is two numbers as often as it is one
            found.update(p for p in re.split(r",", raw) if p)
    return found


def _removal(sentence: Sentence, reason: str) -> dict[str, Any]:
    return {"sentence_id": sentence.id, "text": sentence.text, "reason": reason}


def _without(memo: Memo, drop: set[str]) -> Memo:
    keep = [s for s in memo.sections if s.id not in drop]
    return memo.model_copy(update={"sections": keep})


def deterministic_check(
    memo: Memo, retrieved: set[str], sources: dict[str, str]
) -> tuple[Memo, list[dict[str, Any]]]:
    """Remove sentences that are uncited, cite something never retrieved, or carry a number
    that none of their cited sources contain."""
    removed: list[dict[str, Any]] = []
    for s in memo.sections:
        missing = [c for c in s.cites if c not in retrieved]
        if not s.cites:
            removed.append(_removal(s, "no citation"))
        elif missing:
            removed.append(_removal(s, f"cites {', '.join(missing)}, not retrieved in this run"))
        else:
            nums = _sentence_numbers(s.text)
            if nums:
                have = _source_numbers("\n".join(sources.get(c, "") for c in s.cites))
                if any(n not in have for n in nums):
                    removed.append(_removal(s, "number not found in cited sources"))
    return _without(memo, {r["sentence_id"] for r in removed}), removed


def _batch_message(batch: list[Sentence], sources: dict[str, str]) -> dict[str, Any]:
    payload = [
        {
            "sentence_id": s.id,
            "text": s.text,
            "cites": s.cites,
            "sources": {c: sources.get(c, "") for c in s.cites},
        }
        for s in batch
    ]
    text = "Sentences to check, with the text of their cited sources (data):\n" + json.dumps(
        payload, ensure_ascii=False
    )
    return {"role": "user", "content": [{"text": text}]}


def _parse_verdicts(resp: ModelResponse, batch: list[Sentence]) -> dict[str, Verdict] | None:
    use = next(
        (
            b["toolUse"]
            for b in resp.content
            if b.get("toolUse", {}).get("name") == "submit_verdicts"
        ),
        None,
    )
    items = use.get("input", {}).get("verdicts") if use else None
    if not isinstance(items, list):
        return None
    wanted = {s.id for s in batch}
    out: dict[str, Verdict] = {}
    for item in items:
        try:
            verdict = Verdict.model_validate(item)
        except ValidationError:
            continue
        if verdict.sentence_id in wanted and verdict.sentence_id not in out:
            out[verdict.sentence_id] = verdict
    return out


def model_check(
    memo: Memo,
    sources: dict[str, str],
    *,
    model: ModelClient,
    model_id: str,
    on_response: Callable[[ModelResponse], None] | None = None,
) -> list[Verdict]:
    """One checker call per batch of up to 10 sentences, each in a fresh conversation."""
    verdicts: list[Verdict] = []
    for i in range(0, len(memo.sections), BATCH_SIZE):
        batch = memo.sections[i : i + BATCH_SIZE]
        parsed: dict[str, Verdict] | None
        try:
            resp = model.converse(
                model=model_id,
                system=CHECKER_PROMPT,
                messages=[_batch_message(batch, sources)],
                tools=[VERDICTS_TOOL],
                max_tokens=CHECKER_MAX_TOKENS,
                tool_choice="submit_verdicts",
            )
            if on_response is not None:
                on_response(resp)
            parsed = _parse_verdicts(resp, batch)
        except ReplayMismatch:
            raise
        except Exception:  # noqa: BLE001 - a broken checker must not end the run
            parsed = None
        for s in batch:
            if parsed is None:
                verdicts.append(Verdict(sentence_id=s.id, verdict="partly", reason=NOT_CHECKED))
            elif s.id in parsed:
                verdicts.append(parsed[s.id])
            else:
                verdicts.append(
                    Verdict(sentence_id=s.id, verdict="partly", reason=NOT_CHECKED_MISSING)
                )
    return verdicts


def apply_verdicts(memo: Memo, verdicts: list[Verdict]) -> tuple[Memo, list[dict[str, Any]]]:
    """Unsupported sentences leave the memo with the checker's reason; partly ones stay (the
    verdict list carries their mark and reason)."""
    bad = {v.sentence_id: v.reason for v in verdicts if v.verdict == "unsupported"}
    removed = [_removal(s, bad[s.id]) for s in memo.sections if s.id in bad]
    return _without(memo, set(bad)), removed


def gate_judgement(memo: Memo, verdicts: list[Verdict]) -> bool:
    """True only if the judgement has reasons and every one is a kept sentence judged supported."""
    reasons = memo.judgement.reasons
    if not reasons:
        return False
    present = {s.id for s in memo.sections}
    ok = {v.sentence_id for v in verdicts if v.verdict == "supported"}
    return all(r in present and r in ok for r in reasons)
