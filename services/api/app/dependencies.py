from dataclasses import dataclass, field

from app.agents import AgentService, RightsClearanceAgentService
from app.config import IntegrationMode, Settings
from app.integrations import (
    AdjudicatorClient,
    AdkAdjudicator,
    GeminiClient,
    MockAdjudicator,
    MockGeminiClient,
    MockParallelSearchClient,
    ParallelSdkClient,
    ParallelSearchClient,
    VertexGeminiClient,
)
from app.repositories import (
    AnalysisQuota,
    AssetRepository,
    CaseRepository,
    CloudStorageAssetRepository,
    CloudStorageProductionIconRepository,
    FirestoreAnalysisQuota,
    FirestoreCaseRepository,
    FirestoreProductionRepository,
    InMemoryAnalysisQuota,
    InMemoryAssetRepository,
    InMemoryCaseRepository,
    InMemoryProductionIconRepository,
    InMemoryProductionRepository,
    ProductionIconRepository,
    ProductionRepository,
)


@dataclass(frozen=True)
class ApplicationServices:
    case_repository: CaseRepository
    asset_repository: AssetRepository
    agent_service: AgentService
    production_repository: ProductionRepository = field(
        default_factory=InMemoryProductionRepository
    )
    production_icon_repository: ProductionIconRepository = field(
        default_factory=InMemoryProductionIconRepository
    )
    analysis_quota: AnalysisQuota = field(default_factory=lambda: InMemoryAnalysisQuota(cap=25))


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
        parallel = ParallelSdkClient(
            api_key=_require(settings.parallel_api_key, "RIGHTSRADAR_PARALLEL_API_KEY"),
            client_model=settings.gemini_model,
        )
    else:
        parallel = MockParallelSearchClient()

    adjudicator: AdjudicatorClient
    if settings.adjudicator_mode == "adk":
        assert isinstance(parallel, ParallelSdkClient)
        adjudicator = AdkAdjudicator(
            project=_require(settings.google_cloud_project, "RIGHTSRADAR_GOOGLE_CLOUD_PROJECT"),
            location=settings.google_cloud_location,
            model=settings.gemini_model,
            parallel_api_key=_require(settings.parallel_api_key, "RIGHTSRADAR_PARALLEL_API_KEY"),
            parallel_sdk=parallel.sdk,
        )
    else:
        adjudicator = MockAdjudicator()

    case_repository, asset_repository = build_repositories(settings)

    production_repository: ProductionRepository
    production_icon_repository: ProductionIconRepository
    if settings.selected_mode(settings.repository_mode) is IntegrationMode.REAL:
        project = _require(settings.google_cloud_project, "RIGHTSRADAR_GOOGLE_CLOUD_PROJECT")
        production_repository = FirestoreProductionRepository(
            project, settings.firestore_productions_collection
        )
        production_icon_repository = CloudStorageProductionIconRepository(
            project=project,
            bucket_name=_require(
                settings.cloud_storage_bucket,
                "RIGHTSRADAR_CLOUD_STORAGE_BUCKET",
            ),
        )
    else:
        production_repository = InMemoryProductionRepository()
        production_icon_repository = InMemoryProductionIconRepository()

    analysis_quota: AnalysisQuota
    if settings.selected_mode(settings.repository_mode) is IntegrationMode.REAL:
        analysis_quota = FirestoreAnalysisQuota(
            project=_require(settings.google_cloud_project, "RIGHTSRADAR_GOOGLE_CLOUD_PROJECT"),
            collection="rightsrader_quota",
            cap=settings.daily_analysis_cap,
        )
    else:
        analysis_quota = InMemoryAnalysisQuota(cap=settings.daily_analysis_cap)

    return ApplicationServices(
        case_repository=case_repository,
        asset_repository=asset_repository,
        agent_service=RightsClearanceAgentService(
            gemini,
            parallel,
            max_concurrency=settings.parallel_max_concurrency,
            adjudicator=adjudicator,
            adjudicate_below_confidence=settings.adjudicate_below_confidence,
        ),
        production_repository=production_repository,
        production_icon_repository=production_icon_repository,
        analysis_quota=analysis_quota,
    )
