import asyncio
from collections.abc import Sequence

from fastapi import FastAPI, HTTPException
from starlette.requests import Request

from app.dependencies import ApplicationServices
from app.models import Finding
from app.models.requests import CreateCaseRequest
from app.repositories.assets import InMemoryAssetRepository
from app.repositories.cases import InMemoryCaseRepository
from app.repositories.quota import InMemoryAnalysisQuota, today_key
from app.routes.cases import create_case


class CountingAgentService:
    def __init__(self) -> None:
        self.calls = 0

    async def analyze_desk(self, case_id: str, script_text: str, ignored_keywords: Sequence[str] = (), roster: Sequence[object] = ()):  # noqa: E501
        from app.agents.service import AnalysisDeskResult

        self.calls += 1
        return AnalysisDeskResult(findings=[], thread=[], tool_calls=[])

    async def analyze(self, *args: object, **kwargs: object) -> list[Finding]:
        return []


def _request(agent: CountingAgentService, quota: InMemoryAnalysisQuota) -> Request:
    app = FastAPI()
    app.state.services = ApplicationServices(
        case_repository=InMemoryCaseRepository(),
        asset_repository=InMemoryAssetRepository(),
        agent_service=agent,  # type: ignore[arg-type]
        analysis_quota=quota,
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
