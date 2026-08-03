import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.dependencies import ApplicationServices
from app.errors import AnalysisProviderError
from app.models import Finding
from app.repositories import InMemoryAssetRepository, InMemoryCaseRepository
from app.routes import cases_router


class FailingAgentService:
    async def analyze(self, case_id: str, script_text: str) -> list[Finding]:
        del case_id
        del script_text
        raise AnalysisProviderError("secret provider detail")


class ClosableAgentService:
    def __init__(self) -> None:
        self.closed = False

    async def analyze(self, case_id: str, script_text: str) -> list[Finding]:
        del case_id
        del script_text
        return []

    async def aclose(self) -> None:
        self.closed = True


def test_creating_a_case_returns_deterministic_findings() -> None:
    from app.main import create_app

    client = TestClient(create_app())

    response = client.post(
        "/api/cases",
        json={
            "script_text": (
                'MARA opens a can of Nimbus Soda. "Time keeps the reel turning," she says.'
            )
        },
    )

    assert response.status_code == 201
    case = response.json()
    assert case["script_text"].startswith("MARA opens")
    assert {finding["detected_item"] for finding in case["findings"]} == {
        "Nimbus Soda",
        "Time keeps the reel turning",
    }
    assert all(finding["reviewer_status"] == "pending" for finding in case["findings"])
    assert all(finding["evidence"]["primary"] is not None for finding in case["findings"])
    assert all(finding["evidence"]["rationale"] for finding in case["findings"])


def test_updating_a_finding_status_persists_on_the_case() -> None:
    from app.main import create_app

    client = TestClient(create_app())
    case = client.post(
        "/api/cases",
        json={"script_text": "A Nimbus Soda poster fills the frame."},
    ).json()
    finding_id = case["findings"][0]["id"]

    response = client.patch(
        f"/api/cases/{case['id']}/findings/{finding_id}",
        json={"reviewer_status": "escalated"},
    )

    assert response.status_code == 200
    assert response.json()["reviewer_status"] == "escalated"
    updated_case = client.get(f"/api/cases/{case['id']}").json()
    assert updated_case["findings"][0]["reviewer_status"] == "escalated"


def test_provider_failure_returns_safe_503_without_persisting_a_partial_case() -> None:
    cases = InMemoryCaseRepository()
    app = FastAPI()
    app.state.services = ApplicationServices(
        case_repository=cases,
        asset_repository=InMemoryAssetRepository(),
        agent_service=FailingAgentService(),
    )
    app.include_router(cases_router)
    client = TestClient(app, raise_server_exceptions=False)

    response = client.post("/api/cases", json={"script_text": "A scene."})

    assert response.status_code == 503
    assert response.json() == {
        "detail": "RightsRadar analysis is temporarily unavailable. Please try again."
    }
    assert cases.list_recent(10) == []
    assert "secret provider detail" not in response.text


def test_app_lifespan_closes_provider_clients(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.main import create_app

    agent = ClosableAgentService()
    services = ApplicationServices(
        case_repository=InMemoryCaseRepository(),
        asset_repository=InMemoryAssetRepository(),
        agent_service=agent,
    )
    monkeypatch.setattr("app.main.build_services", lambda settings: services)

    with TestClient(create_app()) as client:
        assert client.get("/health").status_code == 200

    assert agent.closed is True
