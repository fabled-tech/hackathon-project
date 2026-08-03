from dataclasses import dataclass

from app.agents import AdkRightsResearchAgentService, AgentService, RightsClearanceAgentService
from app.config import IntegrationMode, Settings
from app.integrations import (
    MockGeminiClient,
    MockParallelSearchClient,
    ParallelSearchClient,
    ParallelSearchHttpClient,
)
from app.repositories import (
    AssetRepository,
    CaseRepository,
    CloudStorageAssetRepository,
    FirestoreCaseRepository,
    InMemoryAssetRepository,
    InMemoryCaseRepository,
)


@dataclass(frozen=True)
class ApplicationServices:
    case_repository: CaseRepository
    asset_repository: AssetRepository
    agent_service: AgentService


def _require(value: str | None, setting_name: str) -> str:
    if not value:
        raise ValueError(f"{setting_name} must be set when its real integration is enabled")
    return value


def build_repositories(settings: Settings) -> tuple[CaseRepository, AssetRepository]:
    case_repository: CaseRepository
    asset_repository: AssetRepository

    if settings.selected_mode(settings.repository_mode) is IntegrationMode.REAL:
        project = _require(settings.google_cloud_project, "RIGHTSRADAR_GOOGLE_CLOUD_PROJECT")
        case_repository = FirestoreCaseRepository(project, settings.firestore_collection)
        asset_repository = CloudStorageAssetRepository(
            project=project,
            bucket_name=_require(settings.cloud_storage_bucket, "RIGHTSRADAR_CLOUD_STORAGE_BUCKET"),
            case_collection=settings.firestore_collection,
        )
    else:
        case_repository = InMemoryCaseRepository()
        asset_repository = InMemoryAssetRepository()
    return case_repository, asset_repository


def build_services(settings: Settings) -> ApplicationServices:
    parallel: ParallelSearchClient

    if settings.selected_mode(settings.parallel_mode) is IntegrationMode.REAL:
        parallel = ParallelSearchHttpClient(
            api_key=_require(settings.parallel_api_key, "RIGHTSRADAR_PARALLEL_API_KEY")
        )
    else:
        parallel = MockParallelSearchClient()

    if settings.selected_mode(settings.gemini_mode) is IntegrationMode.REAL:
        agent_service: AgentService = AdkRightsResearchAgentService(
            project=_require(settings.google_cloud_project, "RIGHTSRADAR_GOOGLE_CLOUD_PROJECT"),
            location=settings.google_cloud_location,
            model=settings.gemini_model,
            parallel_search=parallel,
        )
    else:
        agent_service = RightsClearanceAgentService(MockGeminiClient(), parallel)

    case_repository, asset_repository = build_repositories(settings)

    return ApplicationServices(
        case_repository=case_repository,
        asset_repository=asset_repository,
        agent_service=agent_service,
    )
