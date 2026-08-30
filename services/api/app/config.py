from enum import StrEnum

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class EnvironmentMode(StrEnum):
    MOCK = "mock"
    HYBRID = "hybrid"
    CLOUD = "cloud"


class IntegrationMode(StrEnum):
    MOCK = "mock"
    REAL = "real"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../../.env"), env_prefix="RIGHTSRADAR_", extra="ignore"
    )

    mode: EnvironmentMode = EnvironmentMode.MOCK
    gemini_mode: IntegrationMode = IntegrationMode.MOCK
    parallel_mode: IntegrationMode = IntegrationMode.MOCK
    repository_mode: IntegrationMode = IntegrationMode.MOCK
    google_cloud_project: str | None = None
    google_cloud_location: str = "global"
    gemini_model: str = "gemini-2.5-flash"
    parallel_api_key: str | None = None
    parallel_max_concurrency: int = Field(default=4, ge=1, le=16)
    firestore_collection: str = "rightsrader_cases"
    firestore_productions_collection: str = "rightsrader_productions"
    firestore_agent_runs_collection: str = "rightsrader_agent_runs"
    cloud_storage_bucket: str | None = None
    enable_real_smoke: bool = False
    enable_reconciliation: bool = False

    def selected_mode(self, integration_mode: IntegrationMode) -> IntegrationMode:
        if self.mode is EnvironmentMode.MOCK:
            return IntegrationMode.MOCK
        if self.mode is EnvironmentMode.CLOUD:
            return IntegrationMode.REAL
        return integration_mode
