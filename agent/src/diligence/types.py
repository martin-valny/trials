"""Shared data types: tool results, trace steps, memo, checker verdicts, run records."""

import re
from typing import Annotated, Any, Literal

from pydantic import AfterValidator, BaseModel, Field, model_validator

# Citable ID formats; the checker reuses these.
CITE_PATTERN = re.compile(r"(?:NCT\d{8}|PMID:\d+|PPR\d+|CHEMBL\d+|FDA:[A-Za-z0-9-]+)")
# Same formats, unanchored, for finding IDs inside free text.
CITE_SEARCH_PATTERN = re.compile(CITE_PATTERN.pattern)


def _check_cite(value: str) -> str:
    if not CITE_PATTERN.fullmatch(value):
        raise ValueError(f"not a citable ID: {value!r}")
    return value


CiteId = Annotated[str, AfterValidator(_check_cite)]

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
    id: str
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
