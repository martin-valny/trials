"""Shared data types: tool results, trace steps, memo, checker verdicts, run records."""

import re
from typing import Annotated, Any, Literal

from pydantic import AfterValidator, BaseModel, Field, model_validator

# Citable ID formats, as one regex source shared by the types, the memo schema and the checker.
CITE_REGEX = r"(?:NCT\d{8}|PMID:\d+|PPR\d+|CHEMBL\d+|FDA:[A-Za-z0-9-]+)"
CITE_PATTERN = re.compile(CITE_REGEX)
# Memo sentence ids: s1, s2, ... (reader flags address sentences by this id).
SENTENCE_ID_REGEX = r"s\d{1,4}"
SENTENCE_ID_PATTERN = re.compile(SENTENCE_ID_REGEX)


def _check_cite(value: str) -> str:
    if not CITE_PATTERN.fullmatch(value):
        raise ValueError(f"not a citable ID: {value!r}")
    return value


CiteId = Annotated[str, AfterValidator(_check_cite)]


def _check_sentence_id(value: str) -> str:
    if not SENTENCE_ID_PATTERN.fullmatch(value):
        raise ValueError(f"sentence id must be s1, s2, ... (got {value!r})")
    return value


SentenceId = Annotated[str, AfterValidator(_check_sentence_id)]

Stance = Literal["favours", "mixed", "against"]
Confidence = Literal["high", "medium", "low"]
Section = Literal["landscape", "track_record", "literature", "competition"]
StepKind = Literal["plan", "tool", "note", "write", "check", "limit", "error", "done"]


class ToolResult(BaseModel):
    name: str
    args: dict[str, Any] = Field(default_factory=dict)
    data: dict[str, Any] = Field(default_factory=dict)
    ids: list[str] = Field(default_factory=list)
    error: str | None = None


class Step(BaseModel):
    n: int
    kind: StepKind
    text: str
    tool: str | None = None
    ids: list[str] = Field(default_factory=list)
    ms: int = 0
    tokens_in: int = 0
    tokens_out: int = 0


class Sentence(BaseModel):
    id: SentenceId
    section: Section
    text: str
    # May be empty at schema level; the checker removes uncited sentences.
    cites: list[CiteId]


class Judgement(BaseModel):
    stance: Stance
    confidence: Confidence
    reasons: list[str]


class Memo(BaseModel):
    sections: list[Sentence]
    read: Annotated[list[str], Field(min_length=3, max_length=3)]
    judgement: Judgement
    would_change: Annotated[list[str], Field(min_length=1, max_length=3)]

    @model_validator(mode="after")
    def _unique_sentence_ids(self) -> "Memo":
        ids = [s.id for s in self.sections]
        if len(ids) != len(set(ids)):
            raise ValueError("sentence ids must be unique")
        return self


class Verdict(BaseModel):
    sentence_id: str
    verdict: Literal["supported", "partly", "unsupported"]
    reason: str


class RunRecord(BaseModel):
    run_id: str
    target: str
    disease: str
    fingerprint: str
    agent_version: str
    status: Literal["running", "done", "failed"]
    started_at: str
    finished_at: str | None = None
    steps: list[Step] = Field(default_factory=list)
    memo: Memo | None = None
    verdicts: list[Verdict] = Field(default_factory=list)
    # Entries: {"sentence_id": str, "text": str, "reason": str}
    removed: list[dict[str, Any]] = Field(default_factory=list)
    judgement_shown: bool = False
    models: dict[str, Any] = Field(default_factory=dict)
    tokens_in: int = 0
    tokens_out: int = 0
    cost_usd: float = 0.0
    data_date: str = ""
