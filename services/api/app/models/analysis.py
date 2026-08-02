from pydantic import BaseModel, Field

from .cases import Source


class GeminiSignal(BaseModel):
    category: str
    detected_item: str
    explanation: str
    confidence: float = Field(ge=0, le=1)


class SearchResult(BaseModel):
    source: Source
    excerpt: str
