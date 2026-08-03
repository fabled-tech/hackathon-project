from app.agents import RightsClearanceAgentService
from app.agents.adk import AdkRightsResearchAgentService
from app.config import EnvironmentMode, IntegrationMode, Settings
from app.dependencies import build_services


def test_cloud_mode_uses_the_single_adk_agent_service() -> None:
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
        Settings(mode=EnvironmentMode.MOCK, _env_file=None)  # type: ignore[call-arg]
    )

    assert isinstance(services.agent_service, RightsClearanceAgentService)
