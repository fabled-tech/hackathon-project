from datetime import datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field, model_validator

from .analysis import Evidence, EvidenceSelection
from .memo import ClearanceMemo
from .productions import FindingComment


class ThreadAuthorKind(StrEnum):
    AGENT = "agent"
    HUMAN = "human"


class ToolCallProvider(StrEnum):
    VERTEX = "vertex"
    PARALLEL = "parallel"


class ToolCallEvent(BaseModel):
    id: str
    case_id: str
    provider: ToolCallProvider
    method: str = Field(min_length=1, max_length=80)
    agent_name: str = Field(min_length=1, max_length=40)
    ok: bool
    fixture: bool = False
    summary: str = Field(min_length=1, max_length=400)
    lead: str | None = None
    duration_ms: int = Field(default=0, ge=0)
    started_at: datetime


class CaseThreadMessage(BaseModel):
    id: str
    case_id: str
    author_kind: ThreadAuthorKind
    body: str = Field(min_length=1, max_length=4_000)
    agent_name: str | None = None
    member_id: str | None = None
    finding_id: str | None = None
    mentions: list[str] = Field(default_factory=list)
    created_at: datetime


class ReviewerStatus(StrEnum):
    PENDING = "pending"
    ACCEPTED = "accepted"
    DISMISSED = "dismissed"
    ESCALATED = "escalated"


class FindingSeverity(StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class Finding(BaseModel):
    id: str
    case_id: str
    category: str
    detected_item: str
    explanation: str
    confidence: float = Field(ge=0, le=1)
    supporting_evidence: list[Evidence]
    source_urls: list[str]
    retrieved_at: datetime
    reviewer_status: ReviewerStatus
    evidence: EvidenceSelection = Field(default_factory=EvidenceSelection)
    assignee: str | None = None
    due_date: str | None = None
    comments: list[FindingComment] = Field(default_factory=list)
    stakeholder_ids: list[str] = Field(default_factory=list)
    memo: ClearanceMemo | None = None

    @model_validator(mode="before")
    @classmethod
    def preserve_legacy_evidence(cls, value: Any) -> Any:
        if not isinstance(value, dict) or "evidence" in value:
            return value
        normalized = dict(value)
        normalized["evidence"] = {
            "alternatives": list(normalized.get("supporting_evidence") or [])
        }
        return normalized

    @property
    def severity(self) -> FindingSeverity:
        if self.reviewer_status is ReviewerStatus.ESCALATED or self.confidence >= 0.8:
            return FindingSeverity.HIGH
        if self.confidence >= 0.6:
            return FindingSeverity.MEDIUM
        return FindingSeverity.LOW


class Case(BaseModel):
    id: str
    script_text: str
    created_at: datetime
    findings: list[Finding]
    asset_count: int = Field(default=0, ge=0)
    production_id: str | None = None
    title: str = ""
    notes: str = ""
    thread: list[CaseThreadMessage] = Field(default_factory=list)
    tool_calls: list[ToolCallEvent] = Field(default_factory=list)
