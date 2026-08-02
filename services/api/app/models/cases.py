from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, Field


class ReviewerStatus(StrEnum):
    PENDING = "pending"
    ACCEPTED = "accepted"
    DISMISSED = "dismissed"
    ESCALATED = "escalated"


class Source(BaseModel):
    title: str
    url: str


class Evidence(BaseModel):
    excerpt: str
    source: Source


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


class Case(BaseModel):
    id: str
    script_text: str
    created_at: datetime
    findings: list[Finding]
