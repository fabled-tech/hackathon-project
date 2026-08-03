from pydantic import BaseModel, Field

from .cases import Evidence, Finding, Source


class EvidenceSelection(BaseModel):
    primary: Evidence | None = None
    rationale: str | None = None
    alternatives: list[Evidence] = Field(default_factory=list)


class EvidenceCurationDecision(BaseModel):
    primary_url: str | None = None
    rationale: str | None = None


class GeminiSignal(BaseModel):
    category: str
    detected_item: str
    explanation: str
    confidence: float = Field(ge=0, le=1)
    context_excerpt: str = ""


class SearchResult(BaseModel):
    source: Source
    excerpt: str


Finding.model_rebuild(_types_namespace={"EvidenceSelection": EvidenceSelection})
