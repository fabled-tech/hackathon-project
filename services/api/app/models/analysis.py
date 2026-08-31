from pydantic import BaseModel, Field, model_validator


class Source(BaseModel):
    title: str
    url: str


class Evidence(BaseModel):
    excerpt: str
    source: Source


class EvidenceSelection(BaseModel):
    primary: Evidence | None = None
    rationale: str | None = None
    alternatives: list[Evidence] = Field(default_factory=list)

    @model_validator(mode="after")
    def require_complete_primary_rationale_pair(self) -> "EvidenceSelection":
        if (self.primary is None) != (self.rationale is None):
            raise ValueError("primary evidence and rationale must be provided together")
        return self


class GeminiSignal(BaseModel):
    category: str
    detected_item: str
    explanation: str
    confidence: float = Field(ge=0, le=1)
    context_excerpt: str = ""


class EvidenceCurationDecision(BaseModel):
    primary_url: str | None
    rationale: str | None


class SearchObjectivePlan(BaseModel):
    objectives: list[str] = Field(min_length=2, max_length=3)


class StakeholderBrief(BaseModel):
    brief: str = Field(min_length=1, max_length=2_000)


class SearchResult(BaseModel):
    source: Source
    excerpt: str
    publish_date: str | None = None
