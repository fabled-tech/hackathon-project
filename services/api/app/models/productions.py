from datetime import datetime
from enum import StrEnum
from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints, field_validator


class WorkspaceRole(StrEnum):
    PRODUCTION = "production"
    CLEARANCE = "clearance"
    LEGAL = "legal"

IgnoredKeyword = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=100),
]


def normalize_ignore_keywords(values: list[str]) -> list[str]:
    unique: list[str] = []
    seen: set[str] = set()
    for value in values:
        normalized = " ".join(value.split())
        key = normalized.casefold()
        if key not in seen:
            unique.append(normalized)
            seen.add(key)
    return unique


class ProductionStatus(StrEnum):
    DEVELOPMENT = "development"
    PRE_PRODUCTION = "pre_production"
    SHOOTING = "shooting"
    POST = "post"
    RELEASED = "released"


class ProductionMember(BaseModel):
    id: str
    name: str = Field(min_length=1, max_length=120)
    role: WorkspaceRole
    email: str | None = Field(default=None, max_length=254)


class Production(BaseModel):
    id: str
    title: str
    studio: str = ""
    status: ProductionStatus = ProductionStatus.DEVELOPMENT
    icon: str = "clapperboard"
    icon_version: str | None = None
    icon_content_type: str | None = None
    ignore_keywords: list[IgnoredKeyword] = Field(default_factory=list, max_length=50)
    roster: list[ProductionMember] = Field(default_factory=list, max_length=5)
    created_at: datetime

    @field_validator("ignore_keywords")
    @classmethod
    def deduplicate_ignore_keywords(cls, values: list[str]) -> list[str]:
        return normalize_ignore_keywords(values)


class ProductionSummary(Production):
    case_count: int = Field(default=0, ge=0)
    open_finding_count: int = Field(default=0, ge=0)
    escalated_finding_count: int = Field(default=0, ge=0)


class FindingComment(BaseModel):
    id: str
    author: str
    body: str
    created_at: datetime
