from dataclasses import dataclass, field

from app.agents import AgentService, ClearanceAgentService, RightsClearanceAgentService
from app.config import IntegrationMode, Settings
from app.integrations import (
    GeminiClient,
    MockGeminiClient,
    MockParallelSearchClient,
    ParallelSearchClient,
    ParallelSearchHttpClient,
    VertexGeminiClient,
)
from app.repositories import (
    AgentRunRepository,
    AssetRepository,
    CaseRepository,
    CloudStorageAssetRepository,
    FirestoreAgentRunRepository,
    FirestoreCaseRepository,
    FirestoreProductionRepository,
    FirestoreWorkspaceMemberRepository,
    InMemoryAgentRunRepository,
    InMemoryAssetRepository,
    InMemoryCaseRepository,
    InMemoryProductionRepository,
    InMemoryWorkspaceMemberRepository,
    ProductionRepository,
    WorkspaceMemberRepository,
)


@dataclass(frozen=True)
class ApplicationServices:
    case_repository: CaseRepository
    asset_repository: AssetRepository
    agent_service: AgentService
    production_repository: ProductionRepository = field(
        default_factory=InMemoryProductionRepository
    )
    agent_run_repository: AgentRunRepository = field(
        default_factory=InMemoryAgentRunRepository
    )
    clearance_agent: ClearanceAgentService | None = None
    workspace_member_repository: WorkspaceMemberRepository = field(
        default_factory=InMemoryWorkspaceMemberRepository
    )


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
    gemini: GeminiClient
    parallel: ParallelSearchClient

    if settings.selected_mode(settings.gemini_mode) is IntegrationMode.REAL:
        gemini = VertexGeminiClient(
            project=_require(settings.google_cloud_project, "RIGHTSRADAR_GOOGLE_CLOUD_PROJECT"),
            location=settings.google_cloud_location,
            model=settings.gemini_model,
        )
    else:
        gemini = MockGeminiClient()

    if settings.selected_mode(settings.parallel_mode) is IntegrationMode.REAL:
        parallel = ParallelSearchHttpClient(
            api_key=_require(settings.parallel_api_key, "RIGHTSRADAR_PARALLEL_API_KEY"),
            client_model=settings.gemini_model,
        )
    else:
        parallel = MockParallelSearchClient()

    case_repository, asset_repository = build_repositories(settings)

    production_repository: ProductionRepository
    agent_run_repository: AgentRunRepository
    workspace_member_repository: WorkspaceMemberRepository
    if settings.selected_mode(settings.repository_mode) is IntegrationMode.REAL:
        project = _require(settings.google_cloud_project, "RIGHTSRADAR_GOOGLE_CLOUD_PROJECT")
        production_repository = FirestoreProductionRepository(
            project, settings.firestore_productions_collection
        )
        agent_run_repository = FirestoreAgentRunRepository(
            project, settings.firestore_agent_runs_collection
        )
        workspace_member_repository = FirestoreWorkspaceMemberRepository(
            project, settings.firestore_workspace_members_collection
        )
    else:
        production_repository = InMemoryProductionRepository()
        agent_run_repository = InMemoryAgentRunRepository()
        workspace_member_repository = InMemoryWorkspaceMemberRepository()

    return ApplicationServices(
        case_repository=case_repository,
        asset_repository=asset_repository,
        agent_service=RightsClearanceAgentService(
            gemini, parallel, max_concurrency=settings.parallel_max_concurrency
        ),
        production_repository=production_repository,
        agent_run_repository=agent_run_repository,
        clearance_agent=ClearanceAgentService(
            gemini, parallel, case_repository, agent_run_repository
        ),
        workspace_member_repository=workspace_member_repository,
    )
