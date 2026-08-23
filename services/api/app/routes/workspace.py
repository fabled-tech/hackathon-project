from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request, status

from app.dependencies import ApplicationServices
from app.models import OrganizationIssue, ReviewerStatus, WorkspaceMember
from app.models.requests import CreateWorkspaceMemberRequest
from app.repositories import WorkspaceMemberNotFound

router = APIRouter(prefix="/api/workspace", tags=["workspace"])


def _services(request: Request) -> ApplicationServices:
    return request.app.state.services  # type: ignore[no-any-return]


@router.get("/members", response_model=list[WorkspaceMember])
def list_workspace_members(request: Request) -> list[WorkspaceMember]:
    return _services(request).workspace_member_repository.list()


@router.post("/members", response_model=WorkspaceMember, status_code=status.HTTP_201_CREATED)
def create_workspace_member(
    payload: CreateWorkspaceMemberRequest, request: Request
) -> WorkspaceMember:
    member = WorkspaceMember(
        id=str(uuid4()),
        name=payload.name,
        email=payload.email,
        role=payload.role,
        created_at=datetime.now(UTC),
    )
    return _services(request).workspace_member_repository.create(member)


@router.delete("/members/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_workspace_member(member_id: str, request: Request) -> None:
    try:
        _services(request).workspace_member_repository.delete(member_id)
    except WorkspaceMemberNotFound as error:
        raise HTTPException(status_code=404, detail="Workspace member not found") from error


@router.get("/issues", response_model=list[OrganizationIssue])
def list_organization_issues(request: Request) -> list[OrganizationIssue]:
    services = _services(request)
    production_titles = {
        production.id: production.title for production in services.production_repository.list()
    }
    issues: list[OrganizationIssue] = []

    for case in services.case_repository.list_all():
        if case.production_id is None or case.production_id not in production_titles:
            continue
        for finding in case.findings:
            if finding.reviewer_status not in {
                ReviewerStatus.PENDING,
                ReviewerStatus.ESCALATED,
            }:
                continue
            issues.append(
                OrganizationIssue(
                    finding_id=finding.id,
                    case_id=case.id,
                    production_id=case.production_id,
                    production_title=production_titles[case.production_id],
                    case_excerpt=case.script_text[:160],
                    category=finding.category,
                    detected_item=finding.detected_item,
                    confidence=finding.confidence,
                    retrieved_at=finding.retrieved_at,
                    reviewer_status=finding.reviewer_status,
                    assignee=finding.assignee,
                    due_date=finding.due_date,
                    comment_count=len(finding.comments),
                )
            )

    issues.sort(
        key=lambda issue: (
            issue.reviewer_status is not ReviewerStatus.ESCALATED,
            issue.due_date is None,
            issue.due_date or "",
            -issue.confidence,
        )
    )
    return issues
