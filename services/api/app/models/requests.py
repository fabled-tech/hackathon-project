from pydantic import BaseModel, Field, field_validator

from .cases import ReviewerStatus

ALLOWED_ASSET_CONTENT_TYPE = "text/plain"
MAX_ASSET_BYTES = 256 * 1024


class CreateCaseRequest(BaseModel):
    script_text: str = Field(min_length=1, max_length=20_000)


class UpdateFindingRequest(BaseModel):
    reviewer_status: ReviewerStatus


class CreateProductionRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("name must not be blank")
        return value


class CreateScriptRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    script_text: str = Field(min_length=1, max_length=20_000)

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("name must not be blank")
        return value


class UpdateScriptRequest(BaseModel):
    script_text: str = Field(min_length=1, max_length=20_000)


class UpdateProductionFindingRequest(BaseModel):
    reviewer_status: ReviewerStatus
