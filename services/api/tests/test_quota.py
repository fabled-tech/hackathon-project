import asyncio
from collections.abc import Sequence
from datetime import UTC, datetime
from io import BytesIO
from zipfile import ZipFile

from fastapi import FastAPI, HTTPException
from starlette.datastructures import Headers, UploadFile
from starlette.requests import Request

from app.dependencies import ApplicationServices
from app.errors import AnalysisUnavailableError
from app.models import Finding, Production
from app.models.requests import DOCX_CONTENT_TYPE, CreateCaseRequest
from app.repositories.assets import InMemoryAssetRepository
from app.repositories.cases import InMemoryCaseRepository
from app.repositories.productions import InMemoryProductionRepository
from app.repositories.quota import InMemoryAnalysisQuota, today_key
from app.routes.cases import create_case, create_case_from_file


class CountingAgentService:
    def __init__(self) -> None:
        self.calls = 0

    async def analyze_desk(self, case_id: str, script_text: str, ignored_keywords: Sequence[str] = (), roster: Sequence[object] = ()):  # noqa: E501
        from app.agents.service import AnalysisDeskResult

        self.calls += 1
        return AnalysisDeskResult(findings=[], thread=[], tool_calls=[])

    async def analyze(self, *args: object, **kwargs: object) -> list[Finding]:
        return []


def _request(
    agent: object,
    quota: InMemoryAnalysisQuota,
    production_repository: InMemoryProductionRepository | None = None,
) -> Request:
    app = FastAPI()
    app.state.services = ApplicationServices(
        case_repository=InMemoryCaseRepository(),
        asset_repository=InMemoryAssetRepository(),
        agent_service=agent,  # type: ignore[arg-type]
        analysis_quota=quota,
        production_repository=production_repository or InMemoryProductionRepository(),
    )
    return Request({"type": "http", "app": app, "headers": []})


def test_in_memory_quota_counts_per_day() -> None:
    quota = InMemoryAnalysisQuota(cap=2)
    assert quota.try_consume("2026-09-01") is True
    assert quota.try_consume("2026-09-01") is True
    assert quota.try_consume("2026-09-01") is False
    assert quota.try_consume("2026-09-02") is True


def test_today_key_is_utc_date() -> None:
    assert len(today_key()) == 10 and today_key()[4] == "-"


def test_create_case_returns_429_when_cap_reached_without_calling_agents() -> None:
    agent = CountingAgentService()
    quota = InMemoryAnalysisQuota(cap=1)
    payload = CreateCaseRequest(script_text="A scene with Nimbus Soda.", production_id=None)

    asyncio.run(create_case(payload, _request(agent, quota)))
    assert agent.calls == 1

    try:
        asyncio.run(create_case(payload, _request(agent, quota)))
    except HTTPException as error:
        assert error.status_code == 429
        assert "budget" in str(error.detail)
    else:
        raise AssertionError("expected 429")
    assert agent.calls == 1


def test_missing_production_does_not_consume_quota() -> None:
    agent = CountingAgentService()
    quota = InMemoryAnalysisQuota(cap=1)
    payload = CreateCaseRequest(script_text="A scene with Nimbus Soda.", production_id="missing")

    try:
        asyncio.run(create_case(payload, _request(agent, quota)))
    except HTTPException as error:
        assert error.status_code == 404
    else:
        raise AssertionError("expected 404")
    assert agent.calls == 0
    assert quota.try_consume(today_key()) is True


def test_in_memory_quota_refund_restores_a_slot() -> None:
    quota = InMemoryAnalysisQuota(cap=1)
    assert quota.try_consume("2026-09-01") is True
    quota.refund("2026-09-01")
    assert quota.try_consume("2026-09-01") is True


def test_analysis_unavailable_refunds_quota() -> None:
    class FailingDesk:
        async def analyze_desk(self, *args: object, **kwargs: object):
            raise AnalysisUnavailableError("unavailable")

    quota = InMemoryAnalysisQuota(cap=1)
    payload = CreateCaseRequest(script_text="A scene with Nimbus Soda.", production_id=None)
    try:
        asyncio.run(create_case(payload, _request(FailingDesk(), quota)))
    except HTTPException as error:
        assert error.status_code == 503
    else:
        raise AssertionError("expected 503")
    assert quota.try_consume(today_key()) is True


def test_unreadable_docx_does_not_consume_quota() -> None:
    agent = CountingAgentService()
    quota = InMemoryAnalysisQuota(cap=1)
    productions = InMemoryProductionRepository()
    productions.create(Production(id="p1", title="T", created_at=datetime.now(UTC)))
    request = _request(agent, quota, productions)
    archive = BytesIO()
    with ZipFile(archive, "w") as zipped:
        zipped.writestr("readme.txt", "not a word document")
    upload = UploadFile(
        filename="script.docx",
        file=BytesIO(archive.getvalue()),
        headers=Headers({"content-type": DOCX_CONTENT_TYPE}),
    )

    try:
        asyncio.run(create_case_from_file("p1", upload, request))
    except HTTPException as error:
        assert error.status_code == 422
    else:
        raise AssertionError("expected 422")
    assert agent.calls == 0
    assert quota.try_consume(today_key()) is True


def test_invalid_from_file_upload_does_not_consume_quota() -> None:
    agent = CountingAgentService()
    quota = InMemoryAnalysisQuota(cap=1)
    productions = InMemoryProductionRepository()
    productions.create(Production(id="p1", title="T", created_at=datetime.now(UTC)))
    request = _request(agent, quota, productions)
    upload = UploadFile(
        filename="note.txt",
        file=BytesIO(b"hello"),
        headers=Headers({"content-type": "text/plain"}),
    )

    try:
        asyncio.run(create_case_from_file("p1", upload, request))
    except HTTPException as error:
        assert error.status_code == 422
    else:
        raise AssertionError("expected 422")
    assert agent.calls == 0
    assert quota.try_consume(today_key()) is True
