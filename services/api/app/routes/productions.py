import logging
from datetime import UTC, datetime
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, File, HTTPException, Query, Request, UploadFile, status
from starlette.concurrency import run_in_threadpool

from app.dependencies import ApplicationServices
from app.errors import (
    AnalysisUnavailableError,
    ProductionContentUnavailableError,
    ProductionNoChangesError,
)
from app.models import (
    Production,
    ProductionDetail,
    ProductionRun,
    ProductionRunSummary,
    ProductionSource,
    ProductionSourceKind,
    ProductionSourceVersion,
    ProductionSourceView,
    ProductionSummary,
    ReviewEvent,
    ReviewUpdate,
    StoredAsset,
    fingerprint_utf8,
    to_public_source,
)
from app.models.requests import (
    CreateProductionRequest,
    CreateScriptRequest,
    UpdateProductionFindingRequest,
    UpdateScriptRequest,
)
from app.repositories import (
    ProductionFindingNotFound,
    ProductionRepositoryNotFound,
    ProductionRevisionConflict,
    ProductionRunNotFound,
    ProductionSourceNotFound,
)
from app.routes.asset_uploads import read_text_asset_upload

router = APIRouter(prefix="/api/productions", tags=["productions"])
logger = logging.getLogger(__name__)
_UNAVAILABLE_DETAIL = "Production monitoring is temporarily unavailable. Please try again."


def _services(request: Request) -> ApplicationServices:
    return request.app.state.services  # type: ignore[no-any-return]


def _now() -> datetime:
    return datetime.now(UTC)


def _not_found(error: Exception, detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail)


def _source_from_detail(
    services: ApplicationServices, production_id: str, source_id: str
) -> ProductionSourceView:
    try:
        detail = services.production_repository.get_detail(production_id)
    except ProductionRepositoryNotFound as error:
        raise _not_found(error, "Production not found") from error
    for source in detail.sources:
        if source.id == source_id:
            return source
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Production source not found")


async def _delete_asset_after_source_failure(
    services: ApplicationServices, asset: StoredAsset
) -> None:
    try:
        await run_in_threadpool(services.asset_repository.delete, asset)
    except Exception:
        logger.warning("Asset cleanup failed after a production source update error.")


@router.post("", response_model=ProductionDetail, status_code=status.HTTP_201_CREATED)
def create_production(payload: CreateProductionRequest, request: Request) -> ProductionDetail:
    now = _now()
    production = Production(
        id=str(uuid4()), name=payload.name, revision=0, created_at=now, updated_at=now
    )
    services = _services(request)
    services.production_repository.create(production)
    return services.production_repository.get_detail(production.id)


@router.get("", response_model=list[ProductionSummary])
def list_productions(
    request: Request, limit: int = Query(default=20, ge=1, le=50)
) -> list[ProductionSummary]:
    return _services(request).production_repository.list_recent(limit)


@router.get("/{production_id}", response_model=ProductionDetail)
def get_production(production_id: str, request: Request) -> ProductionDetail:
    try:
        return _services(request).production_repository.get_detail(production_id)
    except ProductionRepositoryNotFound as error:
        raise _not_found(error, "Production not found") from error


@router.post("/{production_id}/scripts", response_model=ProductionSourceView, status_code=201)
def create_script(
    production_id: str, payload: CreateScriptRequest, request: Request
) -> ProductionSourceView:
    now = _now()
    source_id = str(uuid4())
    version = ProductionSourceVersion(
        id=str(uuid4()),
        source_id=source_id,
        fingerprint_sha256=fingerprint_utf8(payload.script_text),
        script_text=payload.script_text,
        created_at=now,
    )
    source = ProductionSource(
        id=source_id,
        production_id=production_id,
        kind=ProductionSourceKind.SCRIPT,
        name=payload.name,
        active=True,
        current_version_id=version.id,
        last_monitored_version_id=None,
        created_at=now,
        updated_at=now,
    )
    try:
        created = _services(request).production_repository.create_source(
            production_id, source, version
        )
    except ProductionRepositoryNotFound as error:
        raise _not_found(error, "Production not found") from error
    return to_public_source(created, version)


@router.put("/{production_id}/scripts/{source_id}", response_model=ProductionSourceView)
def replace_script(
    production_id: str,
    source_id: str,
    payload: UpdateScriptRequest,
    request: Request,
) -> ProductionSourceView:
    now = _now()
    version = ProductionSourceVersion(
        id=str(uuid4()),
        source_id=source_id,
        fingerprint_sha256=fingerprint_utf8(payload.script_text),
        script_text=payload.script_text,
        created_at=now,
    )
    services = _services(request)
    try:
        source = services.production_repository.append_source_version(
            production_id, source_id, version, now
        )
    except ProductionRepositoryNotFound as error:
        raise _not_found(error, "Production not found") from error
    except ProductionSourceNotFound as error:
        raise _not_found(error, "Production source not found") from error
    return to_public_source(source, version)


@router.delete("/{production_id}/sources/{source_id}", response_model=ProductionSourceView)
def retire_source(production_id: str, source_id: str, request: Request) -> ProductionSourceView:
    services = _services(request)
    try:
        services.production_repository.retire_source(production_id, source_id, _now())
    except ProductionRepositoryNotFound as error:
        raise _not_found(error, "Production not found") from error
    except ProductionSourceNotFound as error:
        raise _not_found(error, "Production source not found") from error
    return _source_from_detail(services, production_id, source_id)


@router.post("/{production_id}/assets", response_model=ProductionSourceView, status_code=201)
async def create_asset(
    production_id: str,
    file: Annotated[UploadFile, File(json_schema_extra={"format": "binary"})],
    request: Request,
) -> ProductionSourceView:
    upload = await read_text_asset_upload(file)
    services = _services(request)
    stored = await run_in_threadpool(services.asset_repository.store, production_id, upload)
    now = _now()
    source_id = str(uuid4())
    version = ProductionSourceVersion(
        id=str(uuid4()),
        source_id=source_id,
        fingerprint_sha256=fingerprint_utf8(upload.content.decode("utf-8")),
        asset_id=stored.id,
        created_at=now,
    )
    source = ProductionSource(
        id=source_id,
        production_id=production_id,
        kind=ProductionSourceKind.ASSET,
        name=upload.filename,
        active=True,
        current_version_id=version.id,
        last_monitored_version_id=None,
        content_type=upload.content_type,
        byte_size=len(upload.content),
        created_at=now,
        updated_at=now,
    )
    try:
        created = await run_in_threadpool(
            services.production_repository.create_source, production_id, source, version
        )
    except ProductionRepositoryNotFound as error:
        await _delete_asset_after_source_failure(services, stored)
        raise _not_found(error, "Production not found") from error
    except Exception:
        await _delete_asset_after_source_failure(services, stored)
        raise
    return to_public_source(created, version)


@router.post("/{production_id}/assets/{source_id}/versions", response_model=ProductionSourceView)
async def replace_asset(
    production_id: str,
    source_id: str,
    file: Annotated[UploadFile, File(json_schema_extra={"format": "binary"})],
    request: Request,
) -> ProductionSourceView:
    upload = await read_text_asset_upload(file)
    services = _services(request)
    stored = await run_in_threadpool(services.asset_repository.store, production_id, upload)
    now = _now()
    version = ProductionSourceVersion(
        id=str(uuid4()),
        source_id=source_id,
        fingerprint_sha256=fingerprint_utf8(upload.content.decode("utf-8")),
        asset_id=stored.id,
        created_at=now,
    )
    try:
        source = await run_in_threadpool(
            services.production_repository.append_source_version,
            production_id,
            source_id,
            version,
            now,
        )
    except ProductionRepositoryNotFound as error:
        await _delete_asset_after_source_failure(services, stored)
        raise _not_found(error, "Production not found") from error
    except ProductionSourceNotFound as error:
        await _delete_asset_after_source_failure(services, stored)
        raise _not_found(error, "Production source not found") from error
    except Exception:
        await _delete_asset_after_source_failure(services, stored)
        raise
    return to_public_source(source, version)


def _monitor(production_id: str, request: Request, *, explicit_recheck: bool) -> ProductionRun:
    try:
        return _services(request).production_monitoring_service.monitor(
            production_id, explicit_recheck=explicit_recheck
        )
    except ProductionRepositoryNotFound as error:
        raise _not_found(error, "Production not found") from error
    except ProductionNoChangesError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "No changed sources are available to monitor. "
                "Use Recheck all sources to run research again."
            ),
        ) from error
    except ProductionRevisionConflict as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "The production changed while monitoring. "
                "Review the latest sources and try again."
            ),
        ) from error
    except (AnalysisUnavailableError, ProductionContentUnavailableError) as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=_UNAVAILABLE_DETAIL
        ) from error


@router.post("/{production_id}/runs", response_model=ProductionRun, status_code=201)
def monitor_changes(production_id: str, request: Request) -> ProductionRun:
    return _monitor(production_id, request, explicit_recheck=False)


@router.post("/{production_id}/rechecks", response_model=ProductionRun, status_code=201)
def recheck_all_sources(production_id: str, request: Request) -> ProductionRun:
    return _monitor(production_id, request, explicit_recheck=True)


@router.get("/{production_id}/runs", response_model=list[ProductionRunSummary])
def list_runs(
    production_id: str, request: Request, limit: int = Query(default=25, ge=1, le=100)
) -> list[ProductionRunSummary]:
    try:
        return _services(request).production_repository.list_runs(production_id, limit)
    except ProductionRepositoryNotFound as error:
        raise _not_found(error, "Production not found") from error


@router.get("/{production_id}/runs/{run_id}", response_model=ProductionRun)
def get_run(production_id: str, run_id: str, request: Request) -> ProductionRun:
    try:
        return _services(request).production_repository.get_run(production_id, run_id)
    except ProductionRepositoryNotFound as error:
        raise _not_found(error, "Production not found") from error
    except ProductionRunNotFound as error:
        raise _not_found(error, "Production run not found") from error


@router.patch(
    "/{production_id}/runs/{run_id}/findings/{finding_id}", response_model=ReviewUpdate
)
def update_production_finding(
    production_id: str,
    run_id: str,
    finding_id: str,
    payload: UpdateProductionFindingRequest,
    request: Request,
) -> ReviewUpdate:
    try:
        return _services(request).production_repository.update_finding_status(
            production_id, run_id, finding_id, payload.reviewer_status, _now()
        )
    except ProductionRepositoryNotFound as error:
        raise _not_found(error, "Production not found") from error
    except ProductionRunNotFound as error:
        raise _not_found(error, "Production run not found") from error
    except ProductionFindingNotFound as error:
        raise _not_found(error, "Production finding not found") from error


@router.get("/{production_id}/review-events", response_model=list[ReviewEvent])
def list_review_events(
    production_id: str, request: Request, limit: int = Query(default=50, ge=1, le=100)
) -> list[ReviewEvent]:
    try:
        return _services(request).production_repository.list_review_events(production_id, limit)
    except ProductionRepositoryNotFound as error:
        raise _not_found(error, "Production not found") from error
