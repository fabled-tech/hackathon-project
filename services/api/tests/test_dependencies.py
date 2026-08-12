from pytest import MonkeyPatch

from app.agents import RightsClearanceAgentService
from app.agents.adk import AdkRightsResearchAgentService
from app.config import EnvironmentMode, IntegrationMode, Settings
from app.dependencies import build_repositories, build_services
from app.repositories import (
    InMemoryAssetRepository,
    InMemoryCaseRepository,
    InMemoryProductionRepository,
)


def test_cloud_mode_uses_the_single_adk_agent_service(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setattr(
        "app.dependencies.build_repositories",
        lambda _settings: (
            InMemoryCaseRepository(),
            InMemoryAssetRepository(),
            InMemoryProductionRepository(),
        ),
    )

    services = build_services(
        Settings(
            mode=EnvironmentMode.CLOUD,
            google_cloud_project="project",
            cloud_storage_bucket="bucket",
            parallel_api_key="parallel-key",
        )
    )

    assert isinstance(services.agent_service, AdkRightsResearchAgentService)


def test_hybrid_real_gemini_uses_adk_with_mock_parallel() -> None:
    services = build_services(
        Settings(
            mode=EnvironmentMode.HYBRID,
            gemini_mode=IntegrationMode.REAL,
            parallel_mode=IntegrationMode.MOCK,
            google_cloud_project="project",
        )
    )

    assert isinstance(services.agent_service, AdkRightsResearchAgentService)


def test_mock_gemini_keeps_the_deterministic_service() -> None:
    services = build_services(
        Settings(mode=EnvironmentMode.MOCK, _env_file=None)
    )

    assert isinstance(services.agent_service, RightsClearanceAgentService)


def test_build_repositories_uses_matching_production_repository_for_mock_mode() -> None:
    case_repository, asset_repository, production_repository = build_repositories(
        Settings(repository_mode="mock")
    )

    assert isinstance(case_repository, InMemoryCaseRepository)
    assert isinstance(asset_repository, InMemoryAssetRepository)
    assert isinstance(production_repository, InMemoryProductionRepository)


def test_build_repositories_constructs_production_firestore_repository_in_real_mode(
    monkeypatch: MonkeyPatch,
) -> None:
    """A real-mode production repository must use the configured project and base collection."""
    created: dict[str, tuple[str, str]] = {}

    def production_repository(project: str, collection: str) -> object:
        created["production"] = (project, collection)
        return object()

    monkeypatch.setattr("app.dependencies.FirestoreCaseRepository", lambda *_args: object())
    monkeypatch.setattr("app.dependencies.FirestoreProductionRepository", production_repository)
    monkeypatch.setattr("app.dependencies.CloudStorageAssetRepository", lambda **_kwargs: object())

    _, _, repository = build_repositories(
        Settings(
            mode=EnvironmentMode.HYBRID,
            repository_mode=IntegrationMode.REAL,
            google_cloud_project="monitoring-project",
            cloud_storage_bucket="private-assets",
            firestore_collection="production-cases",
        )
    )

    assert repository is not None
    assert created == {"production": ("monitoring-project", "production-cases")}
