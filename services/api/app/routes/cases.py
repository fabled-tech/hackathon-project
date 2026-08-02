from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request, status

from app.dependencies import ApplicationServices
from app.models import Case, Finding
from app.models.requests import CreateCaseRequest, UpdateFindingRequest
from app.repositories import CaseRepositoryNotFound, FindingNotFound

router = APIRouter(prefix="/api/cases", tags=["cases"])


def _services(request: Request) -> ApplicationServices:
    return request.app.state.services  # type: ignore[no-any-return]


@router.post("", response_model=Case, status_code=status.HTTP_201_CREATED)
def create_case(payload: CreateCaseRequest, request: Request) -> Case:
    case_id = str(uuid4())
    services = _services(request)
    case = Case(
        id=case_id,
        script_text=payload.script_text,
        created_at=datetime.now(UTC),
        findings=services.agent_service.analyze(case_id, payload.script_text),
    )
    return services.case_repository.create(case)


@router.get("/{case_id}", response_model=Case)
def get_case(case_id: str, request: Request) -> Case:
    try:
        return _services(request).case_repository.get(case_id)
    except CaseRepositoryNotFound as error:
        raise HTTPException(status_code=404, detail="Case not found") from error


@router.patch("/{case_id}/findings/{finding_id}", response_model=Finding)
def update_finding(
    case_id: str, finding_id: str, payload: UpdateFindingRequest, request: Request
) -> Finding:
    try:
        return _services(request).case_repository.update_finding_status(
            case_id, finding_id, payload.reviewer_status
        )
    except CaseRepositoryNotFound as error:
        raise HTTPException(status_code=404, detail="Case not found") from error
    except FindingNotFound as error:
        raise HTTPException(status_code=404, detail="Finding not found") from error
