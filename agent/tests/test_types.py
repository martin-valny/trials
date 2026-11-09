import pytest
from pydantic import ValidationError

from diligence.types import Judgement, Memo, RunRecord, Sentence


def _sentence(cites: list[str]) -> Sentence:
    return Sentence(id="s1", section="landscape", text="x", cites=cites)


def _memo(read: list[str]) -> Memo:
    return Memo(
        sections=[_sentence(["NCT01234567"])],
        read=read,
        judgement=Judgement(stance="mixed", confidence="low", reasons=["s1"]),
        would_change=["a new phase 3 readout"],
    )


def test_memo_requires_three_read_lines() -> None:
    assert len(_memo(["a", "b", "c"]).read) == 3
    with pytest.raises(ValidationError):
        _memo(["a", "b"])
    with pytest.raises(ValidationError):
        _memo(["a", "b", "c", "d"])


def test_memo_would_change_bounds() -> None:
    with pytest.raises(ValidationError):
        Memo(
            sections=[],
            read=["a", "b", "c"],
            judgement=Judgement(stance="mixed", confidence="low", reasons=[]),
            would_change=[],
        )


def test_judgement_rejects_unknown_stance() -> None:
    with pytest.raises(ValidationError):
        Judgement(stance="bullish", confidence="high", reasons=[])  # type: ignore[arg-type]


@pytest.mark.parametrize("cite", ["PMID:123", "NCT01234567", "CHEMBL25", "FDA:abc-123", "PPR12345"])
def test_sentence_cite_format_ok(cite: str) -> None:
    assert _sentence([cite]).cites == [cite]


@pytest.mark.parametrize("cite", ["foo", "NCT123", "PMID:", "pmid:1", "FDA:a b", "CHEMBL"])
def test_sentence_cite_format_rejected(cite: str) -> None:
    with pytest.raises(ValidationError):
        _sentence([cite])


def test_sentence_requires_a_cite() -> None:
    with pytest.raises(ValidationError):
        _sentence([])


def test_run_record_roundtrip() -> None:
    r = RunRecord(
        run_id="r1",
        target="MS4A1",
        disease="all",
        fingerprint="f",
        agent_version="0.1.0",
        status="running",
        started_at="2026-11-09T10:00:00Z",
    )
    assert r.finished_at is None and r.memo is None and r.steps == []
    assert RunRecord.model_validate_json(r.model_dump_json()) == r
