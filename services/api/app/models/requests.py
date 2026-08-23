from pydantic import BaseModel, Field

from .cases import ReviewerStatus
from .productions import ProductionStatus

ALLOWED_ASSET_CONTENT_TYPE = "text/plain"
MAX_ASSET_BYTES = 256 * 1024


class CreateCaseRequest(BaseModel):
    script_text: str = Field(min_length=1, max_length=20_000)
    production_id: str | None = None
    title: str = ""


class UpdateFindingRequest(BaseModel):
    reviewer_status: ReviewerStatus


class UpdateFindingMetaRequest(BaseModel):
    assignee: str | None = None
    due_date: str | None = None


class CreateFindingCommentRequest(BaseModel):
    author: str = Field(min_length=1, max_length=120)
    body: str = Field(min_length=1, max_length=4_000)


class CreateProductionRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    studio: str = ""
    status: ProductionStatus = ProductionStatus.DEVELOPMENT
    icon: str = "clapperboard"


class UpdateProductionRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    studio: str | None = None
    status: ProductionStatus | None = None
    icon: str | None = None
