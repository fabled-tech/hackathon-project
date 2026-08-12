from datetime import datetime
from enum import StrEnum
from typing import TYPE_CHECKING, Any

from pydantic import BaseModel, Field, model_validator

if TYPE_CHECKING:
    from .analysis import EvidenceSelection


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


def _empty_evidence_selection() -> "EvidenceSelection":
    from .analysis import EvidenceSelection

    return EvidenceSelection()


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
    evidence: "EvidenceSelection" = Field(default_factory=_empty_evidence_selection)

    @model_validator(mode="before")
    @classmethod
    def map_legacy_supporting_evidence(cls, values: Any) -> Any:
        if not isinstance(values, dict) or values.get("evidence") is not None:
            return values

        data = dict(values)
        data["evidence"] = {"alternatives": data.get("supporting_evidence", [])}
        return data


class Case(BaseModel):
    id: str
    script_text: str
    created_at: datetime
    findings: list[Finding]
    asset_count: int = Field(default=0, ge=0)
