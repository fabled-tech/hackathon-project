import pytest
from fastapi.testclient import TestClient

from app.agents.service import RightsClearanceAgentService
from app.dependencies import ApplicationServices
from app.models import Case, EvidenceCurationDecision, GeminiSignal, SearchResult, Source
from app.repositories.assets import InMemoryAssetRepository
from app.repositories.cases import InMemoryCaseRepository
from app.repositories.productions import InMemoryProductionRepository
from app.services import ProductionMonitoringService


class FailingGeminiProvider:
    def identify_material(self, script_text: str) -> list[GeminiSignal]:
        del script_text
        raise RuntimeError("provider details must not reach the client")

    def curate_evidence(
        self, signal: GeminiSignal, candidates: list[SearchResult]
    ) -> EvidenceCurationDecision:
        del signal, candidates
        raise AssertionError("curation is not reached after detection fails")


class UnusedParallelProvider:
    def search(
        self, detected_item: str, category: str, context_excerpt: str = ""
    ) -> list[SearchResult]:
        del detected_item, category, context_excerpt
        raise AssertionError("search is not reached after detection fails")


class CandidateParallelProvider:
    def search(
        self, detected_item: str, category: str, context_excerpt: str = ""
    ) -> list[SearchResult]:
        del detected_item, category, context_excerpt
        return [
            SearchResult(
                source=Source(title="Known", url="https://source.test/known"),
                excerpt="Known excerpt",
            )
        ]


class InvalidRationaleGemini:
    def __init__(self, rationale: str | None) -> None:
        self.rationale = rationale

    def identify_material(self, script_text: str) -> list[GeminiSignal]:
        del script_text
        return [
            GeminiSignal(
                category="brand_reference",
                detected_item="Example Brand",
                explanation="A named brand.",
                confidence=0.8,
            )
        ]

    def curate_evidence(
        self, signal: GeminiSignal, candidates: list[SearchResult]
    ) -> EvidenceCurationDecision:
        del signal, candidates
        return EvidenceCurationDecision.model_validate(
            {"primary_url": "https://source.test/known", "rationale": self.rationale}
        )


class TrackingCaseRepository(InMemoryCaseRepository):
    def __init__(self) -> None:
        super().__init__()
        self.create_calls = 0

    def create(self, case: Case) -> Case:
        self.create_calls += 1
        return super().create(case)


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


def test_creating_a_case_returns_a_safe_503_without_saving_when_analysis_fails() -> None:
    from app.main import create_app

    app = create_app()
    repository = TrackingCaseRepository()
    asset_repository = InMemoryAssetRepository()
    production_repository = InMemoryProductionRepository()
    agent_service = RightsClearanceAgentService(FailingGeminiProvider(), UnusedParallelProvider())
    app.state.services = ApplicationServices(
        case_repository=repository,
        asset_repository=asset_repository,
        production_repository=production_repository,
        agent_service=agent_service,
        production_monitoring_service=ProductionMonitoringService(
            production_repository, asset_repository, agent_service
        ),
    )
    client = TestClient(app)

    response = client.post("/api/cases", json={"script_text": "A failed analysis."})

    assert response.status_code == 503
    assert response.json() == {
        "detail": "RightsRadar analysis is temporarily unavailable. Please try again."
    }
    assert repository.create_calls == 0


@pytest.mark.parametrize("rationale", [None, "  \t"])
def test_creating_a_case_rejects_primary_evidence_without_rationale_before_saving(
    rationale: str | None,
) -> None:
    from app.main import create_app

    app = create_app()
    repository = TrackingCaseRepository()
    asset_repository = InMemoryAssetRepository()
    production_repository = InMemoryProductionRepository()
    agent_service = RightsClearanceAgentService(
        InvalidRationaleGemini(rationale), CandidateParallelProvider()
    )
    app.state.services = ApplicationServices(
        case_repository=repository,
        asset_repository=asset_repository,
        production_repository=production_repository,
        agent_service=agent_service,
        production_monitoring_service=ProductionMonitoringService(
            production_repository, asset_repository, agent_service
        ),
    )
    client = TestClient(app)

    response = client.post("/api/cases", json={"script_text": "A contextual excerpt."})

    assert response.status_code == 503
    assert response.json() == {
        "detail": "RightsRadar analysis is temporarily unavailable. Please try again."
    }
    assert repository.create_calls == 0
