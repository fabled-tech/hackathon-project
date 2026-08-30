from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query, Request, status

from app.agents import ClearanceAgentService
from app.dependencies import ApplicationServices
from app.models import AgentRun, Finding, FindingComment, Production, ProductionSummary
from app.models.requests import (
    CreateFindingCommentRequest,
    CreateProductionRequest,
    UpdateFindingMetaRequest,
    UpdateProductionRequest,
)
from app.repositories import (
    CaseRepositoryNotFound,
    FindingNotFound,
    ProductionRepositoryNotFound,
)

router = APIRouter(prefix="/api/productions", tags=["productions"])


def _services(request: Request) -> ApplicationServices:
    return request.app.state.services  # type: ignore[no-any-return]


@router.post("", response_model=Production, status_code=status.HTTP_201_CREATED)
def create_production(payload: CreateProductionRequest, request: Request) -> Production:
    production = Production(
        id=str(uuid4()),
        title=payload.title,
        studio=payload.studio,
        status=payload.status,
        icon=payload.icon,
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
    try:
        return _services(request).production_repository.update(
            production_id,
            title=payload.title,
            studio=payload.studio,
            status=payload.status,
            icon=payload.icon,
        )
    except ProductionRepositoryNotFound as error:
        raise HTTPException(status_code=404, detail="Production not found") from error


@router.delete("/{production_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_production(production_id: str, request: Request) -> None:
    try:
        _services(request).production_repository.delete(production_id)
    except ProductionRepositoryNotFound as error:
        raise HTTPException(status_code=404, detail="Production not found") from error


@router.get("/{production_id}/cases", response_model=list)
def list_production_cases(production_id: str, request: Request) -> list[Any]:
    services = _services(request)
    try:
        services.production_repository.get(production_id)
    except ProductionRepositoryNotFound as error:
        raise HTTPException(status_code=404, detail="Production not found") from error
    return services.case_repository.list_for_production(production_id)


def _clearance_agent(services: ApplicationServices) -> ClearanceAgentService:
    if services.clearance_agent is None:
        raise HTTPException(status_code=503, detail="Clearance agent is not configured")
    return services.clearance_agent


@router.post("/{production_id}/brief", response_model=AgentRun, status_code=status.HTTP_201_CREATED)
async def run_digest(production_id: str, request: Request) -> AgentRun:
    services = _services(request)
    try:
        services.production_repository.get(production_id)
    except ProductionRepositoryNotFound as error:
        raise HTTPException(status_code=404, detail="Production not found") from error
    return await _clearance_agent(services).digest(production_id)


@router.post("/{production_id}/watch", response_model=AgentRun, status_code=status.HTTP_201_CREATED)
async def run_watch(production_id: str, request: Request) -> AgentRun:
    services = _services(request)
    try:
        services.production_repository.get(production_id)
    except ProductionRepositoryNotFound as error:
        raise HTTPException(status_code=404, detail="Production not found") from error
    return await _clearance_agent(services).watch(production_id)


@router.get("/{production_id}/runs", response_model=list[AgentRun])
def list_agent_runs(
    production_id: str, request: Request, limit: int = Query(default=20, ge=1, le=100)
) -> list[AgentRun]:
    services = _services(request)
    try:
        services.production_repository.get(production_id)
    except ProductionRepositoryNotFound as error:
        raise HTTPException(status_code=404, detail="Production not found") from error
    return services.agent_run_repository.list_for_production(production_id, limit)


@router.patch("/{production_id}/cases/{case_id}/findings/{finding_id}/meta", response_model=Finding)
def update_finding_meta(
    production_id: str,
    case_id: str,
    finding_id: str,
    payload: UpdateFindingMetaRequest,
    request: Request,
) -> Finding:
    del production_id
    try:
        return _services(request).case_repository.update_finding_meta(
            case_id, finding_id, assignee=payload.assignee, due_date=payload.due_date
        )
    except CaseRepositoryNotFound as error:
        raise HTTPException(status_code=404, detail="Case not found") from error
    except FindingNotFound as error:
        raise HTTPException(status_code=404, detail="Finding not found") from error


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
    del production_id
    comment = FindingComment(
        id=str(uuid4()),
        author=payload.author,
        body=payload.body,
        created_at=datetime.now(UTC),
    )
    try:
        return _services(request).case_repository.add_finding_comment(case_id, finding_id, comment)
    except CaseRepositoryNotFound as error:
        raise HTTPException(status_code=404, detail="Case not found") from error
    except FindingNotFound as error:
        raise HTTPException(status_code=404, detail="Finding not found") from error
