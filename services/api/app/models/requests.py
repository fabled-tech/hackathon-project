from pydantic import BaseModel, Field

from .cases import ReviewerStatus

ALLOWED_ASSET_CONTENT_TYPE = "text/plain"
MAX_ASSET_BYTES = 256 * 1024


class CreateCaseRequest(BaseModel):
    script_text: str = Field(min_length=1, max_length=20_000)


class UpdateFindingRequest(BaseModel):
    reviewer_status: ReviewerStatus
