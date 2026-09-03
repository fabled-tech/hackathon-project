from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field

from app.errors import AdjudicationError

from .productions import WorkspaceRole


class MemoVerdict(StrEnum):
    CLEARED = "cleared"
    LICENSE_REQUIRED = "license_required"
    REWRITE_RECOMMENDED = "rewrite_recommended"
    NEEDS_HUMAN = "needs_human"


class Hypothesis(BaseModel):
    id: str = Field(min_length=1, max_length=16)
    claim: str = Field(min_length=1, max_length=400)
    likely_rights_holder: str = Field(min_length=1, max_length=200)
    what_would_prove_it: str = Field(min_length=1, max_length=400)


class HypothesisSet(BaseModel):
    hypotheses: list[Hypothesis] = Field(min_length=2, max_length=3)


class AdvocateReport(BaseModel):
    hypothesis_id: str
    best_url: str | None = None
    why: str = Field(default="", max_length=1_000)
    strength: Literal["strong", "weak", "none"] = "none"
    searched_urls: list[str] = Field(default_factory=list)


class ClearanceMemo(BaseModel):
    verdict: MemoVerdict
    confidence: float = Field(ge=0, le=1)
    winning_hypothesis_id: str
    dispositive_url: str | None = None
    rationale: str = Field(min_length=1, max_length=2_000)
    recommended_owner_role: WorkspaceRole
    hypotheses: list[Hypothesis] = Field(default_factory=list)
    advocates: list[AdvocateReport] = Field(default_factory=list)
    assigned_member_id: str | None = None


def validate_memo_urls(memo: ClearanceMemo, allowed: set[str]) -> ClearanceMemo:
    if memo.dispositive_url is not None and memo.dispositive_url not in allowed:
        raise AdjudicationError("Judge cited a URL no advocate or grounding source returned")
    return memo
