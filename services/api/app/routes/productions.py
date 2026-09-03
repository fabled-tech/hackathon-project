import logging
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, File, HTTPException, Request, Response, UploadFile, status
from starlette.concurrency import run_in_threadpool

from app.agents.messages import human_message
from app.dependencies import ApplicationServices
from app.file_validation import content_matches_type
from app.models import (
    Case,
    Finding,
    FindingComment,
    Production,
    ProductionMember,
    ProductionSummary,
)
from app.models.requests import (
    ALLOWED_PRODUCTION_ICON_CONTENT_TYPES,
    MAX_PRODUCTION_ICON_BYTES,
    CreateFindingCommentRequest,
    CreateProductionRequest,
    ProductionMemberInput,
    UpdateFindingMetaRequest,
    UpdateProductionRequest,
)
from app.repositories import (
    CaseRepositoryNotFound,
    FindingNotFound,
    ProductionIconNotFound,
    ProductionRepositoryNotFound,
)

router = APIRouter(prefix="/api/productions", tags=["productions"])
logger = logging.getLogger(__name__)


def _services(request: Request) -> ApplicationServices:
    return request.app.state.services  # type: ignore[no-any-return]


def _members_from_input(
    entries: list[ProductionMemberInput],
    existing: Sequence[ProductionMember] = (),
) -> list[ProductionMember]:
    """Build roster members, keeping the id of anyone already on the roster.

    Findings, memos, and thread messages reference member ids, so a rename or an added
    member must not re-issue the ids of the people who are staying.
    """
    reusable = {member.id for member in existing}
    members: list[ProductionMember] = []
    for entry in entries:
        if entry.id is not None and entry.id in reusable:
            reusable.discard(entry.id)
            member_id = entry.id
        else:
            member_id = str(uuid4())
        members.append(
            ProductionMember(
                id=member_id,
                name=entry.name,
                role=entry.role,
                email=entry.email,
            )
        )
    return members


@router.post("", response_model=Production, status_code=status.HTTP_201_CREATED)
def create_production(payload: CreateProductionRequest, request: Request) -> Production:
    production = Production(
        id=str(uuid4()),
        title=payload.title,
        studio=payload.studio,
        status=payload.status,
        icon=payload.icon,
        roster=_members_from_input(payload.roster),
        created_at=datetime.now(UTC),
    )
    return _services(request).production_repository.create(production)


@router.get("", response_model=list[ProductionSummary])
def list_productions(request: Request) -> list[ProductionSummary]:
    services = _services(request)
    cases = services.case_repository.list_all()
    return [
        services.production_repository.summarize(production, cases)
        for production in services.production_repository.list()
    ]


@router.get("/{production_id}", response_model=ProductionSummary)
def get_production(production_id: str, request: Request) -> ProductionSummary:
    services = _services(request)
    try:
        production = services.production_repository.get(production_id)
    except ProductionRepositoryNotFound as error:
        raise HTTPException(status_code=404, detail="Production not found") from error
    cases = services.case_repository.list_for_production(production_id)
    return services.production_repository.summarize(production, cases)


@router.patch("/{production_id}", response_model=Production)
def update_production(
    production_id: str, payload: UpdateProductionRequest, request: Request
) -> Production:
    services = _services(request)
    try:
        existing = services.production_repository.get(production_id)
        updated = services.production_repository.update(
            production_id,
            title=payload.title,
            studio=payload.studio,
            status=payload.status,
            icon=payload.icon,
            ignore_keywords=payload.ignore_keywords,
            roster=(
                _members_from_input(payload.roster, existing.roster)
                if payload.roster is not None
                else None
            ),
            clear_custom_icon=payload.icon is not None,
        )
    except ProductionRepositoryNotFound as error:
        raise HTTPException(status_code=404, detail="Production not found") from error
    if payload.icon is not None and existing.icon_version is not None:
        try:
            services.production_icon_repository.delete(
                production_id, existing.icon_version
            )
        except Exception:
            logger.warning("Custom production icon cleanup failed after selecting a built-in icon.")
    return updated


@router.post("/{production_id}/icon", response_model=Production)
async def upload_production_icon(
    production_id: str,
    file: Annotated[UploadFile, File(json_schema_extra={"format": "binary"})],
    request: Request,
) -> Production:
    services = _services(request)
    try:
        production = await run_in_threadpool(
            services.production_repository.get, production_id
        )
    except ProductionRepositoryNotFound as error:
        raise HTTPException(status_code=404, detail="Production not found") from error

    content_type = file.content_type or ""
    if content_type not in ALLOWED_PRODUCTION_ICON_CONTENT_TYPES:
        raise HTTPException(
            status_code=422,
            detail="Production icons must be PNG, JPEG, or WebP images",
        )
    content = await file.read(MAX_PRODUCTION_ICON_BYTES + 1)
    if len(content) > MAX_PRODUCTION_ICON_BYTES:
        raise HTTPException(status_code=422, detail="Production icon must not exceed 512 KiB")
    if not content_matches_type(content, content_type):
        raise HTTPException(
            status_code=422,
            detail="Production icon content does not match its image type",
        )

    version = str(uuid4())
    await run_in_threadpool(
        services.production_icon_repository.store,
        production_id,
        version,
        content_type,
        content,
    )
    try:
        updated = await run_in_threadpool(
            services.production_repository.set_icon_metadata,
            production_id,
            version=version,
            content_type=content_type,
        )
    except Exception:
        try:
            await run_in_threadpool(
                services.production_icon_repository.delete,
                production_id,
                version,
            )
        except Exception:
            logger.warning("Custom production icon cleanup failed after a metadata error.")
        raise

    if production.icon_version is not None:
        try:
            await run_in_threadpool(
                services.production_icon_repository.delete,
                production_id,
                production.icon_version,
            )
        except Exception:
            logger.warning("Replaced custom production icon cleanup failed.")
    return updated


@router.get("/{production_id}/icon/{version}", response_class=Response)
def get_production_icon(
    production_id: str,
    version: str,
    request: Request,
) -> Response:
    services = _services(request)
    try:
        production = services.production_repository.get(production_id)
    except ProductionRepositoryNotFound as error:
        raise HTTPException(status_code=404, detail="Production not found") from error
    if production.icon_version != version or production.icon_content_type is None:
        raise HTTPException(status_code=404, detail="Production icon not found")
    try:
        content = services.production_icon_repository.get(production_id, version)
    except ProductionIconNotFound as error:
        raise HTTPException(status_code=404, detail="Production icon not found") from error
    return Response(
        content=content,
        media_type=production.icon_content_type,
        headers={
            "Cache-Control": "private, max-age=31536000, immutable",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.delete("/{production_id}/icon", response_model=Production)
def delete_production_icon(production_id: str, request: Request) -> Production:
    services = _services(request)
    try:
        production = services.production_repository.get(production_id)
    except ProductionRepositoryNotFound as error:
        raise HTTPException(status_code=404, detail="Production not found") from error
    if production.icon_version is None:
        return production
    updated = services.production_repository.set_icon_metadata(
        production_id,
        version=None,
        content_type=None,
    )
    try:
        services.production_icon_repository.delete(
            production_id, production.icon_version
        )
    except Exception:
        logger.warning("Custom production icon cleanup failed after removal.")
    return updated


@router.delete("/{production_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_production(production_id: str, request: Request) -> None:
    services = _services(request)
    try:
        production = services.production_repository.get(production_id)
        services.production_repository.delete(production_id)
    except ProductionRepositoryNotFound as error:
        raise HTTPException(status_code=404, detail="Production not found") from error
    if production.icon_version is not None:
        try:
            services.production_icon_repository.delete(
                production_id, production.icon_version
            )
        except Exception:
            logger.warning("Custom production icon cleanup failed after production deletion.")


@router.get("/{production_id}/cases", response_model=list[Case])
def list_production_cases(production_id: str, request: Request) -> list[Case]:
    services = _services(request)
    try:
        services.production_repository.get(production_id)
    except ProductionRepositoryNotFound as error:
        raise HTTPException(status_code=404, detail="Production not found") from error
    return services.case_repository.list_for_production(production_id)


def _assert_case_belongs_to_production(
    services: ApplicationServices, production_id: str, case_id: str
) -> None:
    try:
        case = services.case_repository.get(case_id)
    except CaseRepositoryNotFound as error:
        raise HTTPException(status_code=404, detail="Case not found") from error
    if case.production_id != production_id:
        raise HTTPException(status_code=404, detail="Case not found")


@router.patch("/{production_id}/cases/{case_id}/findings/{finding_id}/meta", response_model=Finding)
def update_finding_meta(
    production_id: str,
    case_id: str,
    finding_id: str,
    payload: UpdateFindingMetaRequest,
    request: Request,
) -> Finding:
    services = _services(request)
    try:
        services.production_repository.get(production_id)
    except ProductionRepositoryNotFound as error:
        raise HTTPException(status_code=404, detail="Production not found") from error
    _assert_case_belongs_to_production(services, production_id, case_id)
    try:
        finding = services.case_repository.update_finding_meta(
            case_id, finding_id, assignee=payload.assignee, due_date=payload.due_date
        )
    except CaseRepositoryNotFound as error:
        raise HTTPException(status_code=404, detail="Case not found") from error
    except FindingNotFound as error:
        raise HTTPException(status_code=404, detail="Finding not found") from error
    if payload.actor_member_id:
        production = services.production_repository.get(production_id)
        actor = next(
            (member for member in production.roster if member.id == payload.actor_member_id),
            None,
        )
        if actor is not None:
            assignee_note = f" → {payload.assignee}" if payload.assignee else ""
            services.case_repository.add_thread_message(
                case_id,
                human_message(
                    case_id,
                    actor.id,
                    (
                        f"{actor.name} ({actor.role.value}) assigned "
                        f"{finding.detected_item}{assignee_note}."
                    ),
                    finding_id=finding_id,
                ),
            )
    return finding


@router.post(
    "/{production_id}/cases/{case_id}/findings/{finding_id}/comments",
    response_model=Finding,
    status_code=status.HTTP_201_CREATED,
)
def add_finding_comment(
    production_id: str,
    case_id: str,
    finding_id: str,
    payload: CreateFindingCommentRequest,
    request: Request,
) -> Finding:
    services = _services(request)
    try:
        services.production_repository.get(production_id)
    except ProductionRepositoryNotFound as error:
        raise HTTPException(status_code=404, detail="Production not found") from error
    _assert_case_belongs_to_production(services, production_id, case_id)
    comment = FindingComment(
        id=str(uuid4()),
        author=payload.author,
        body=payload.body,
        created_at=datetime.now(UTC),
    )
    try:
        return services.case_repository.add_finding_comment(case_id, finding_id, comment)
    except CaseRepositoryNotFound as error:
        raise HTTPException(status_code=404, detail="Case not found") from error
    except FindingNotFound as error:
        raise HTTPException(status_code=404, detail="Finding not found") from error
