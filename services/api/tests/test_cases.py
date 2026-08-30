from collections.abc import Sequence

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.dependencies import ApplicationServices
from app.errors import AnalysisProviderError
from app.models import Finding
from app.repositories import InMemoryAssetRepository, InMemoryCaseRepository
from app.routes import cases_router


class FailingAgentService:
    async def analyze(
        self, case_id: str, script_text: str, ignored_keywords: Sequence[str] = ()
    ) -> list[Finding]:
        del case_id
        del script_text
        del ignored_keywords
        raise AnalysisProviderError("secret provider detail")


class ClosableAgentService:
    def __init__(self) -> None:
        self.closed = False

    async def analyze(
        self, case_id: str, script_text: str, ignored_keywords: Sequence[str] = ()
    ) -> list[Finding]:
        del case_id
        del script_text
        del ignored_keywords
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


def test_creating_a_case_returns_cited_character_franchise_and_likeness_leads() -> None:
    from app.main import create_app

    client = TestClient(create_app())
    response = client.post(
        "/api/cases",
        json={
            "script_text": (
                "Captain Aurelia opens The Copper Comet Chronicles while Rowan Voss watches. "
                'MARA opens a can of Nimbus Soda. "Time keeps the reel turning," she says.'
            )
        },
    )

    assert response.status_code == 201
    findings = {finding["category"]: finding for finding in response.json()["findings"]}

    assert findings["character_reference"]["detected_item"] == "Captain Aurelia"
    assert findings["franchise_reference"]["detected_item"] == "The Copper Comet Chronicles"
    assert findings["likeness_reference"]["detected_item"] == "Rowan Voss"
    assert {finding["detected_item"] for finding in findings.values()} == {
        "Captain Aurelia",
        "The Copper Comet Chronicles",
        "Rowan Voss",
        "Nimbus Soda",
        "Time keeps the reel turning",
    }
    for category in ("character_reference", "franchise_reference", "likeness_reference"):
        finding = findings[category]
        assert 0 <= finding["confidence"] <= 1
        assert "research" in finding["explanation"].casefold()
        assert finding["reviewer_status"] == "pending"
        assert finding["retrieved_at"]
        assert finding["supporting_evidence"]
        assert finding["supporting_evidence"][0]["source"]["url"] in finding["source_urls"]


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


def test_production_ignore_phrases_filter_findings_before_research() -> None:
    from app.main import create_app

    client = TestClient(create_app())
    production = client.post(
        "/api/productions",
        json={"title": "Studio Feature", "studio": "Universal Studios"},
    ).json()
    updated = client.patch(
        f"/api/productions/{production['id']}",
        json={
            "ignore_keywords": [
                "  NIMBUS   SODA ",
                "nimbus soda",
                "irrelevant fragment",
            ]
        },
    )

    assert updated.status_code == 200
    assert updated.json()["ignore_keywords"] == ["NIMBUS SODA", "irrelevant fragment"]

    response = client.post(
        "/api/cases",
        json={
            "production_id": production["id"],
            "script_text": (
                'MARA opens a can of Nimbus Soda. "Time keeps the reel turning," she says.'
            ),
        },
    )

    assert response.status_code == 201
    assert [finding["detected_item"] for finding in response.json()["findings"]] == [
        "Time keeps the reel turning"
    ]


def test_case_creation_rejects_an_unknown_production() -> None:
    from app.main import create_app

    client = TestClient(create_app())

    response = client.post(
        "/api/cases",
        json={"production_id": "missing", "script_text": "Nimbus Soda appears."},
    )

    assert response.status_code == 404
    assert response.json() == {"detail": "Production not found"}


def test_provider_failure_returns_safe_503_without_persisting_a_partial_case(
    caplog: pytest.LogCaptureFixture,
) -> None:
    cases = InMemoryCaseRepository()
    app = FastAPI()
    app.state.services = ApplicationServices(
        case_repository=cases,
        asset_repository=InMemoryAssetRepository(),
        agent_service=FailingAgentService(),
    )
    app.include_router(cases_router)
    client = TestClient(app, raise_server_exceptions=False)

    with caplog.at_level("WARNING", logger="app.routes.cases"):
        response = client.post("/api/cases", json={"script_text": "A scene."})

    assert response.status_code == 503
    assert response.json() == {
        "detail": "RightsRadar analysis is temporarily unavailable. Please try again."
    }
    assert cases.list_recent(10) == []
    assert "secret provider detail" not in response.text
    assert "analysis_provider" in caplog.text
    assert "secret provider detail" not in caplog.text


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
