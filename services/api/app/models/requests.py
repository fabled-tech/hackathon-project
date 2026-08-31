from pydantic import BaseModel, Field, field_validator

from .cases import ReviewerStatus
from .productions import IgnoredKeyword, ProductionStatus, WorkspaceRole, normalize_ignore_keywords

ALLOWED_ASSET_CONTENT_TYPE = "text/plain"
MAX_ASSET_BYTES = 256 * 1024
ALLOWED_PRODUCTION_ICON_CONTENT_TYPES = frozenset(
    {"image/jpeg", "image/png", "image/webp"}
)
MAX_PRODUCTION_ICON_BYTES = 512 * 1024
DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
ALLOWED_ANALYSIS_FILE_CONTENT_TYPES = frozenset(
    {
        "application/pdf",
        DOCX_CONTENT_TYPE,
        "image/jpeg",
        "image/png",
        "image/webp",
    }
)
MAX_ANALYSIS_FILE_BYTES = 10 * 1024 * 1024
MAX_EXTRACTED_DOCUMENT_CHARS = 200_000


class CreateCaseRequest(BaseModel):
    script_text: str = Field(min_length=1, max_length=20_000)
    production_id: str | None = None
    title: str = ""


class UpdateFindingRequest(BaseModel):
    reviewer_status: ReviewerStatus
    actor_member_id: str | None = None


class UpdateFindingMetaRequest(BaseModel):
    assignee: str | None = None
    due_date: str | None = None
    actor_member_id: str | None = None


class ProductionMemberInput(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    role: WorkspaceRole
    email: str | None = Field(default=None, max_length=254)


class CreateThreadMessageRequest(BaseModel):
    member_id: str = Field(min_length=1, max_length=80)
    body: str = Field(min_length=1, max_length=4_000)
    finding_id: str | None = None


class CreateFindingCommentRequest(BaseModel):
    author: str = Field(min_length=1, max_length=120)
    body: str = Field(min_length=1, max_length=4_000)


class CreateProductionRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    studio: str = ""
    status: ProductionStatus = ProductionStatus.DEVELOPMENT
    icon: str = "clapperboard"
    roster: list[ProductionMemberInput] = Field(default_factory=list, max_length=5)


class UpdateProductionRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    studio: str | None = None
    status: ProductionStatus | None = None
    icon: str | None = None
    ignore_keywords: list[IgnoredKeyword] | None = Field(default=None, max_length=50)
    roster: list[ProductionMemberInput] | None = Field(default=None, max_length=5)

    @field_validator("ignore_keywords")
    @classmethod
    def deduplicate_ignore_keywords(cls, values: list[str] | None) -> list[str] | None:
        return normalize_ignore_keywords(values) if values is not None else None
