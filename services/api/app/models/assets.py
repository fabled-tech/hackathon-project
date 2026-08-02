from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, Field


class Asset(BaseModel):
    id: str
    case_id: str
    filename: str
    content_type: str
    byte_size: int = Field(ge=0)
    created_at: datetime


class AssetLifecycle(StrEnum):
    PENDING = "pending"
    READY = "ready"
    CLEANUP_PENDING = "cleanup_pending"


class StoredAsset(Asset):
    storage_reference: str
    marker_generation: int | None = None
    lifecycle: AssetLifecycle = AssetLifecycle.READY
    lease_token: str | None = None
    lease_expires_at: datetime | None = None


class CaseSummary(BaseModel):
    id: str
    created_at: datetime
    script_excerpt: str
    finding_count: int = Field(ge=0)
    asset_count: int = Field(ge=0)


@dataclass(frozen=True)
class AssetUpload:
    filename: str
    content_type: str
    content: bytes
