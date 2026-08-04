import hashlib
from datetime import datetime
from enum import StrEnum
from typing import Self

from pydantic import BaseModel, Field, model_validator

from .analysis import EvidenceSelection
from .cases import Evidence, ReviewerStatus


class ProductionSourceKind(StrEnum):
    SCRIPT = "script"
    ASSET = "asset"


class SourceChangeState(StrEnum):
    NEW = "new"
    CHANGED = "changed"
    UNCHANGED = "unchanged"
    RETIRED = "retired"


class ProductionRunTrigger(StrEnum):
    INITIAL = "initial"
    CHANGES_DETECTED = "changes_detected"
    EXPLICIT_RECHECK = "explicit_recheck"


class Production(BaseModel):
    id: str
    name: str
    revision: int = Field(ge=0)
    created_at: datetime
    updated_at: datetime


class ProductionSource(BaseModel):
    id: str
    production_id: str
    kind: ProductionSourceKind
    name: str
    active: bool
    current_version_id: str
    last_monitored_version_id: str | None
    last_monitored_fingerprint_sha256: str | None = Field(
        default=None, pattern=r"^[0-9a-f]{64}$"
    )
    content_type: str | None = None
    byte_size: int | None = Field(default=None, ge=0)
    created_at: datetime
    updated_at: datetime

    @model_validator(mode="after")
    def require_kind_specific_metadata(self) -> Self:
        if self.kind is ProductionSourceKind.ASSET:
            if self.content_type != "text/plain":
                raise ValueError("asset sources must use content type text/plain")
            if self.byte_size is None:
                raise ValueError("asset sources require a byte size")
        elif self.content_type is not None or self.byte_size is not None:
            raise ValueError("script sources cannot include asset metadata")
        return self


def fingerprint_utf8(text: str) -> str:
    """Return the lowercase SHA-256 digest for the text's exact UTF-8 bytes."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def source_change_state(
    source: ProductionSource, current_fingerprint_sha256: str
) -> SourceChangeState:
    """Return the one-time retirement or current monitoring state for a source."""
    if not source.active and source.last_monitored_version_id != source.current_version_id:
        return SourceChangeState.RETIRED
    if source.last_monitored_version_id is None:
        return SourceChangeState.NEW
    if source.last_monitored_fingerprint_sha256 is None:
        return (
            SourceChangeState.CHANGED
            if source.last_monitored_version_id != source.current_version_id
            else SourceChangeState.UNCHANGED
        )
    if source.last_monitored_fingerprint_sha256 != current_fingerprint_sha256:
        return SourceChangeState.CHANGED
    return SourceChangeState.UNCHANGED


class ProductionSourceVersion(BaseModel):
    id: str
    source_id: str
    fingerprint_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    script_text: str | None = None
    asset_id: str | None = None
    asset_filename: str | None = None
    asset_content_type: str | None = None
    asset_byte_size: int | None = Field(default=None, ge=0)
    created_at: datetime

    @model_validator(mode="after")
    def require_one_content_reference(self) -> Self:
        if (self.script_text is None) == (self.asset_id is None):
            raise ValueError("exactly one source content reference is required")
        asset_metadata = (self.asset_filename, self.asset_content_type, self.asset_byte_size)
        if self.asset_id is not None:
            if any(value is None for value in asset_metadata):
                raise ValueError("asset source versions require immutable asset metadata")
            if self.asset_content_type != "text/plain":
                raise ValueError("asset source versions must use content type text/plain")
        elif any(value is not None for value in asset_metadata):
            raise ValueError("script source versions cannot include asset metadata")
        return self


class ProductionMonitoringSource(BaseModel):
    source: ProductionSource
    version: ProductionSourceVersion
    change_state: SourceChangeState


class ProductionMonitoringSnapshot(BaseModel):
    production: Production
    sources: list[ProductionMonitoringSource]
    has_successful_run: bool


class ProductionFinding(BaseModel):
    id: str
    run_id: str
    source_id: str
    category: str
    detected_item: str
    explanation: str
    confidence: float = Field(ge=0, le=1)
    supporting_evidence: list[Evidence]
    source_urls: list[str]
    retrieved_at: datetime
    reviewer_status: ReviewerStatus
    evidence: EvidenceSelection = Field(default_factory=EvidenceSelection)


class StoredProductionRunSourceSnapshot(BaseModel):
    source_id: str
    source_version_id: str
    kind: ProductionSourceKind
    name: str
    fingerprint_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    change_state: SourceChangeState


class StoredProductionRun(BaseModel):
    id: str
    production_id: str
    production_revision: int = Field(ge=0)
    trigger: ProductionRunTrigger
    created_at: datetime
    source_snapshots: list[StoredProductionRunSourceSnapshot]
    findings: list[ProductionFinding]


class ProductionRunSourceSnapshot(BaseModel):
    source_id: str
    kind: ProductionSourceKind
    name: str
    change_state: SourceChangeState


class ProductionRun(BaseModel):
    id: str
    production_id: str
    production_revision: int = Field(ge=0)
    trigger: ProductionRunTrigger
    created_at: datetime
    source_snapshots: list[ProductionRunSourceSnapshot]
    findings: list[ProductionFinding]


def to_public_run(stored: StoredProductionRun) -> ProductionRun:
    """Project a stored run without version IDs or fingerprint data."""
    return ProductionRun(
        id=stored.id,
        production_id=stored.production_id,
        production_revision=stored.production_revision,
        trigger=stored.trigger,
        created_at=stored.created_at,
        source_snapshots=[
            ProductionRunSourceSnapshot(
                source_id=item.source_id,
                kind=item.kind,
                name=item.name,
                change_state=item.change_state,
            )
            for item in stored.source_snapshots
        ],
        findings=[item.model_copy(deep=True) for item in stored.findings],
    )


class ProductionSourceView(BaseModel):
    id: str
    kind: ProductionSourceKind
    name: str
    active: bool
    change_state: SourceChangeState
    updated_at: datetime
    script_text: str | None = None
    content_type: str | None = None
    byte_size: int | None = Field(default=None, ge=0)


def to_public_source(
    source: ProductionSource, version: ProductionSourceVersion
) -> ProductionSourceView:
    """Project a current source, keeping private asset identifiers server-side."""
    return ProductionSourceView(
        id=source.id,
        kind=source.kind,
        name=source.name,
        active=source.active,
        change_state=source_change_state(source, version.fingerprint_sha256),
        updated_at=source.updated_at,
        script_text=version.script_text if source.kind is ProductionSourceKind.SCRIPT else None,
        content_type=source.content_type if source.kind is ProductionSourceKind.ASSET else None,
        byte_size=source.byte_size if source.kind is ProductionSourceKind.ASSET else None,
    )


class ProductionRunSummary(BaseModel):
    id: str
    trigger: ProductionRunTrigger
    created_at: datetime
    source_count: int = Field(ge=0)
    changed_source_count: int = Field(ge=0)
    finding_count: int = Field(ge=0)


class ProductionSummary(BaseModel):
    id: str
    name: str
    revision: int = Field(ge=0)
    updated_at: datetime
    script_count: int = Field(ge=0)
    asset_count: int = Field(ge=0)
    sources_needing_recheck: int = Field(ge=0)
    latest_run_at: datetime | None = None


class ProductionDetail(ProductionSummary):
    created_at: datetime
    sources: list[ProductionSourceView]
    reviewer_status_counts: dict[ReviewerStatus, int] = Field(default_factory=dict)


def to_public_detail(
    production: Production,
    sources: list[ProductionMonitoringSource],
    *,
    latest_run: StoredProductionRun | None,
) -> ProductionDetail:
    """Build the safe current-production view from server-side source records."""
    source_views = [to_public_source(item.source, item.version) for item in sources]
    reviewer_status_counts = {status: 0 for status in ReviewerStatus}
    if latest_run is not None:
        for finding in latest_run.findings:
            reviewer_status_counts[finding.reviewer_status] += 1

    return ProductionDetail(
        id=production.id,
        name=production.name,
        revision=production.revision,
        created_at=production.created_at,
        updated_at=production.updated_at,
        script_count=sum(view.kind is ProductionSourceKind.SCRIPT for view in source_views),
        asset_count=sum(view.kind is ProductionSourceKind.ASSET for view in source_views),
        sources_needing_recheck=sum(
            view.change_state is not SourceChangeState.UNCHANGED for view in source_views
        ),
        latest_run_at=latest_run.created_at if latest_run is not None else None,
        sources=source_views,
        reviewer_status_counts=reviewer_status_counts,
    )


class ReviewEvent(BaseModel):
    id: str
    production_id: str
    run_id: str
    finding_id: str
    previous_status: ReviewerStatus
    reviewer_status: ReviewerStatus
    created_at: datetime


class ReviewUpdate(BaseModel):
    finding: ProductionFinding
    event: ReviewEvent
