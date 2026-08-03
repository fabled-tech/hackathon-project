from datetime import datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field, model_validator

from .analysis import Evidence, EvidenceSelection, Source


class ReviewerStatus(StrEnum):
    PENDING = "pending"
    ACCEPTED = "accepted"
    DISMISSED = "dismissed"
    ESCALATED = "escalated"


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


class Case(BaseModel):
    id: str
    script_text: str
    created_at: datetime
    findings: list[Finding]
    asset_count: int = Field(default=0, ge=0)
