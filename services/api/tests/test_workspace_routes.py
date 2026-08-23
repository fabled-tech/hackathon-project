from datetime import UTC, datetime

from fastapi import FastAPI
from starlette.requests import Request

from app.dependencies import ApplicationServices
from app.models import Case, Finding, Production, ReviewerStatus
from app.models.requests import CreateWorkspaceMemberRequest, EscalateFindingRequest
from app.repositories import (
    InMemoryAssetRepository,
    InMemoryCaseRepository,
    InMemoryProductionRepository,
)
from app.routes.productions import escalate_finding
from app.routes.workspace import (
    create_workspace_member,
    list_organization_issues,
    list_workspace_members,
)


class EmptyAgentService:
    async def analyze(self, case_id: str, script_text: str) -> list[Finding]:
        del case_id, script_text
        return []


def make_request(services: ApplicationServices) -> Request:
    app = FastAPI()
    app.state.services = services
    return Request({"type": "http", "app": app, "headers": []})


def test_escalation_creates_a_visible_workspace_handoff() -> None:
    cases = InMemoryCaseRepository()
    productions = InMemoryProductionRepository()
    services = ApplicationServices(
        case_repository=cases,
        asset_repository=InMemoryAssetRepository(),
        agent_service=EmptyAgentService(),
        production_repository=productions,
    )
    request = make_request(services)
    production = productions.create(
        Production(
            id="production-1",
            title="Neon Skywalk",
            created_at=datetime.now(UTC),
        )
    )
    finding = Finding(
        id="finding-1",
        case_id="case-1",
        category="brand_reference",
        detected_item="Nimbus Soda",
        explanation="Possible brand reference.",
        confidence=0.84,
        supporting_evidence=[],
        source_urls=[],
        retrieved_at=datetime.now(UTC),
        reviewer_status=ReviewerStatus.PENDING,
    )
    case = cases.create(
        Case(
            id="case-1",
            script_text="Nimbus Soda appears in the scene.",
            created_at=datetime.now(UTC),
            findings=[finding],
            production_id=production.id,
        )
    )
    member = create_workspace_member(
        CreateWorkspaceMemberRequest(
            name="Avery Chen",
            email="avery@example.com",
            role="legal",
        ),
        request,
    )

    updated = escalate_finding(
        production.id,
        case.id,
        finding.id,
        EscalateFindingRequest(assignee=member.id, due_date="2026-09-01"),
        request,
    )

    assert updated.reviewer_status is ReviewerStatus.ESCALATED
    assert updated.assignee == "Avery Chen"
    assert updated.due_date == "2026-09-01"
    assert updated.comments[-1].body == "Escalated to Avery Chen (legal) due 2026-09-01."
    assert list_workspace_members(request) == [member]

    issues = list_organization_issues(request)
    assert len(issues) == 1
    assert issues[0].production_title == "Neon Skywalk"
    assert issues[0].assignee == "Avery Chen"
    assert issues[0].comment_count == 1
