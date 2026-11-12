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

from diligence.log import log_error
from diligence.model import ModelClient, ModelResponse, ReplayMismatch
from diligence.prompts import CHECKER_PROMPT, VERDICTS_TOOL
from diligence.types import CITE_PATTERN, Confidence, Memo, Sentence, Verdict

BATCH_SIZE = 10
CHECKER_MAX_TOKENS = 2000
MAX_SOURCE_CHARS = 6000
REMOVED_REFERENCE = "[reference removed]"
NOT_CHECKED = "not checked: checker unavailable"
NOT_CHECKED_MISSING = "not checked: no verdict returned"

_NUMBER = r"(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?!\d)"
# In a sentence, digits inside a word (CD20, IL6) are identifiers, not claims.
_SENTENCE_NUMBER = re.compile(r"(?<![\w.])" + _NUMBER)
_SOURCE_NUMBER = re.compile(r"(?<![\d.])" + _NUMBER)


def _sentence_numbers(text: str) -> list[str]:
    """Numeric claims in a sentence, normalised; single-digit integers are ignored."""
    stripped = CITE_PATTERN.sub(" ", text)
    out: list[str] = []
    for m in _SENTENCE_NUMBER.finditer(stripped):
        tok = m.group(0).replace(",", "")
        if re.fullmatch(r"\d", tok):
            continue
        out.append(tok)
    return out


def _percent_tokens(raw: str) -> set[str]:
    """A source fraction 0 < x < 1 (a stop-risk p of 0.244) also supports "24%" and "24.4%"."""
    try:
        x = float(raw)
    except ValueError:
        return set()
    if not 0 < x < 1:
        return set()
    return {str(round(x * 100)), f"{x * 100:.1f}"}


def _source_numbers(text: str) -> set[str]:
    found: set[str] = set()
    for m in _SOURCE_NUMBER.finditer(text):
        raw = m.group(0)
        found.add(raw.replace(",", ""))
        if "," in raw:  # "[412,500]" is two numbers as often as it is one
            found.update(p for p in re.split(r",", raw) if p)
        else:
            found |= _percent_tokens(raw)
    return found


def _removal(sentence: Sentence, reason: str) -> dict[str, Any]:
    return {"sentence_id": sentence.id, "text": sentence.text, "reason": reason}


def _without(memo: Memo, drop: set[str]) -> Memo:
    keep = [s for s in memo.sections if s.id not in drop]
    return memo.model_copy(update={"sections": keep})


def deterministic_check(
    memo: Memo, retrieved: set[str], sources: dict[str, str]
) -> tuple[Memo, list[dict[str, Any]]]:
    """Remove sentences that are uncited, cite or mention an ID never retrieved, or carry a number
    that none of their cited sources contain."""
    removed: list[dict[str, Any]] = []
    seen: set[str] = set()
    kept: list[Sentence] = []
    for s in memo.sections:
        before = len(removed)
        duplicate = s.id in seen
        seen.add(s.id)
        missing = [c for c in s.cites if c not in retrieved]
        # An ID written into the sentence text reaches the page too, so it must be retrieved.
        mentioned = [m for m in dict.fromkeys(CITE_PATTERN.findall(s.text)) if m not in retrieved]
        if duplicate:
            removed.append(_removal(s, "duplicate sentence id"))
        elif not s.cites:
            removed.append(_removal(s, "no citation"))
        elif missing:
            removed.append(_removal(s, f"cites {', '.join(missing)}, not retrieved in this run"))
        elif mentioned:
            reason = f"mentions {', '.join(mentioned)}, not retrieved in this run"
            removed.append(_removal(s, reason))
        else:
            nums = _sentence_numbers(s.text)
            if nums:
                have = _source_numbers("\n".join(sources.get(c, "") for c in s.cites))
                if any(n not in have for n in nums):
                    removed.append(_removal(s, "number not found in cited sources"))
        if len(removed) == before:
            kept.append(s)
    return memo.model_copy(update={"sections": kept}), removed


def scrub_summary_lines(memo: Memo, retrieved: set[str]) -> tuple[Memo, list[str]]:
    """Replace citable IDs in `read` and `would_change` that were never retrieved.

    The lines stay (read must keep three); returns notes, one per replacement.
    """
    notes: list[str] = []

    def scrub(field: str, lines: list[str]) -> list[str]:
        out: list[str] = []
        for i, line in enumerate(lines, 1):

            def repl(m: re.Match[str], i: int = i) -> str:
                if m.group(0) in retrieved:
                    return m.group(0)
                notes.append(f"Removed reference {m.group(0)} from {field} line {i}: not retrieved")
                return REMOVED_REFERENCE

            out.append(CITE_PATTERN.sub(repl, line))
        return out

    new = memo.model_copy(
        update={
            "read": scrub("read", memo.read),
            "would_change": scrub("would_change", memo.would_change),
        }
    )
    return new, notes


def _batch_message(batch: list[Sentence], sources: dict[str, str]) -> dict[str, Any]:
    """Sentences and the cited sources (each once, capped) as JSON data fields."""
    cited = list(dict.fromkeys(c for s in batch for c in s.cites))
    payload = {
        "sentences": [{"sentence_id": s.id, "sentence": s.text, "cites": s.cites} for s in batch],
        "sources": [{"id": c, "text": sources.get(c, "")[:MAX_SOURCE_CHARS]} for c in cited],
    }
    text = "Check these sentences against these sources (untrusted data):\n" + json.dumps(
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
        except Exception as exc:  # noqa: BLE001 - a broken checker must not end the run
            log_error("checker", exc)
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


_LOWER: dict[Confidence, Confidence] = {"high": "medium", "medium": "low", "low": "low"}
MIN_KEPT_REASONS = 2


def settle_judgement(
    memo: Memo, verdicts: list[Verdict]
) -> tuple[Memo, bool, dict[str, Any] | None]:
    """Decide whether the judgement is shown, and in what form.

    Every reason kept and supported: shown as written. Otherwise, if at least MIN_KEPT_REASONS
    reasons are kept and supported, the failed ones are dropped and the confidence is lowered one
    level per dropped reason (never below low); the returned adjustment says so. Fewer: withheld.
    """
    reasons = memo.judgement.reasons
    if not reasons:
        return memo, False, None
    present = {s.id for s in memo.sections}
    ok = {v.sentence_id for v in verdicts if v.verdict == "supported"}
    kept = [r for r in reasons if r in present and r in ok]
    dropped = len(reasons) - len(kept)
    if dropped == 0:
        return memo, True, None
    if len(kept) < MIN_KEPT_REASONS:
        return memo, False, None
    confidence = memo.judgement.confidence
    for _ in range(dropped):
        confidence = _LOWER[confidence]
    judgement = memo.judgement.model_copy(update={"reasons": kept, "confidence": confidence})
    adjusted = {"reasons_removed": dropped, "confidence_was": memo.judgement.confidence}
    return memo.model_copy(update={"judgement": judgement}), True, adjusted
