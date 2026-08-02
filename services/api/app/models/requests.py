from pydantic import BaseModel, Field

from .cases import ReviewerStatus


class CreateCaseRequest(BaseModel):
    script_text: str = Field(min_length=1, max_length=20_000)


class UpdateFindingRequest(BaseModel):
    reviewer_status: ReviewerStatus
