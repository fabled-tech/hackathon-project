from enum import StrEnum

from pydantic import Field, field_validator
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
    gemini_model: str = "gemini-3.7-flash"
    parallel_api_key: str | None = None
    parallel_max_concurrency: int = Field(default=4, ge=1, le=16)
    firestore_collection: str = "rightsrader_cases"
    firestore_productions_collection: str = "rightsrader_productions"
    cloud_storage_bucket: str | None = None
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    enable_real_smoke: bool = False
    enable_reconciliation: bool = False

    @field_validator("cors_origins")
    @classmethod
    def validate_cors_origins(cls, value: str) -> str:
        origins = [origin.strip().rstrip("/") for origin in value.split(",") if origin.strip()]
        if not origins:
            raise ValueError("cors_origins must include at least one origin")
        if any(not origin.startswith(("http://", "https://")) for origin in origins):
            raise ValueError("cors_origins entries must use http or https")
        return ",".join(dict.fromkeys(origins))

    @property
    def allowed_cors_origins(self) -> list[str]:
        return self.cors_origins.split(",")

    def selected_mode(self, integration_mode: IntegrationMode) -> IntegrationMode:
        if self.mode is EnvironmentMode.MOCK:
            return IntegrationMode.MOCK
        if self.mode is EnvironmentMode.CLOUD:
            return IntegrationMode.REAL
        return integration_mode
