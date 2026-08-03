import re
from typing import Self

from pydantic import BaseModel, Field, model_validator

from app.errors import ResearchBoundaryError


class AdkFindingResponse(BaseModel):
    research_id: str = Field(min_length=1)
    category: str = Field(min_length=1)
    detected_item: str = Field(min_length=1)
    context_excerpt: str = ""
    explanation: str = Field(min_length=1)
    confidence: float = Field(ge=0, le=1)
    primary_url: str | None = None
    rationale: str | None = None

    @model_validator(mode="after")
    def require_rationale_for_primary(self) -> Self:
        if self.primary_url is not None and not (self.rationale or "").strip():
            raise ValueError("rationale is required when primary_url is selected")
        return self


class AdkAnalysisResponse(BaseModel):
    findings: list[AdkFindingResponse] = Field(default_factory=list)

    @model_validator(mode="after")
    def reject_duplicate_research_ids(self) -> Self:
        research_ids = [item.research_id for item in self.findings]
        if len(research_ids) != len(set(research_ids)):
            raise ValueError("research_id values must be unique")
        return self


_PROHIBITED_RESEARCH_CONCLUSIONS = (
    re.compile(r"\b(?:is|are|was|were)\s+(?:an?\s+)?(?:infringement|infringing)\b", re.I),
    re.compile(r"\b(?:violates?|violation of)\s+(?:copyright|trademark)\b", re.I),
    re.compile(r"\b(?:is|are|was|were)\s+(?:not\s+)?(?:cleared|licensed|permitted)\b", re.I),
    re.compile(
        r"\b(?:permission|authorization|licen[cs](?:e|ing))\s+(?:is\s+)?"
        r"(?:not\s+)?(?:required|needed|granted|denied)\b",
        re.I,
    ),
    re.compile(
        r"\b(?:you|the production)\s+(?:may|can|cannot|should)\s+"
        r"(?:legally\s+)?(?:use|publish|release|distribute)\b",
        re.I,
    ),
    re.compile(r"\b(?:is|are|was|were)\s+(?:un)?registered\b", re.I),
    re.compile(
        r"\bregistration\s+(?:is\s+)?(?:confirmed|unconfirmed|complete|incomplete|pending)\b",
        re.I,
    ),
    re.compile(r"\b(?:owns?|owned by|has rights to)\b", re.I),
    re.compile(r"\b(?:qualifies?|does not qualify)\s+as\s+fair use\b", re.I),
    re.compile(r"\b(?:is|are|was|were)\s+(?:a\s+)?fair use\b", re.I),
    re.compile(r"\b(?:is|are|was|were)\s+(?:a\s+)?(?:valid|invalid)\s+trademark\b", re.I),
    re.compile(
        r"\b(?:release|publication|distribution)\s+(?:is\s+)?"
        r"(?:legally\s+)?(?:allowed|permitted|prohibited)\b",
        re.I,
    ),
    re.compile(r"\b(?:no|low|high)\s+legal risk\b", re.I),
)


def ensure_research_assistance_text(*texts: str | None) -> None:
    if any(
        pattern.search(text or "")
        for pattern in _PROHIBITED_RESEARCH_CONCLUSIONS
        for text in texts
    ):
        raise ResearchBoundaryError("Agent output did not remain within research assistance.")
