from typing import Self

from pydantic import BaseModel, Field, model_validator

from .cases import Evidence, Finding, Source


class EvidenceSelection(BaseModel):
    primary: Evidence | None = None
    rationale: str | None = None
    alternatives: list[Evidence] = Field(default_factory=list)


class EvidenceCurationDecision(BaseModel):
    primary_url: str | None = None
    rationale: str | None = None

    @model_validator(mode="after")
    def require_rationale_for_primary(self) -> Self:
        if self.primary_url is not None and (
            self.rationale is None or not self.rationale.strip()
        ):
            raise ValueError("rationale is required when primary_url is selected")
        return self


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
