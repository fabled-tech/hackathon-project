from dataclasses import dataclass
from datetime import datetime

from pydantic import BaseModel, Field


class Asset(BaseModel):
    id: str
    case_id: str
    filename: str
    content_type: str
    byte_size: int = Field(ge=0)
    created_at: datetime


class StoredAsset(Asset):
    storage_reference: str


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
