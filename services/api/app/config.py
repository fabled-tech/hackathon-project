from enum import StrEnum
from typing import Annotated

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


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
    enable_real_smoke: bool = False
    enable_reconciliation: bool = False
    allowed_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["http://localhost:3000", "http://127.0.0.1:3000"]
    )
    daily_analysis_cap: int = Field(default=25, ge=1, le=10_000)
    adjudicate_below_confidence: float = Field(default=0.75, ge=0, le=1)

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    def selected_mode(self, integration_mode: IntegrationMode) -> IntegrationMode:
        if self.mode is EnvironmentMode.MOCK:
            return IntegrationMode.MOCK
        if self.mode is EnvironmentMode.CLOUD:
            return IntegrationMode.REAL
        return integration_mode

    @property
    def adjudicator_mode(self) -> str:
        gemini_real = self.selected_mode(self.gemini_mode) is IntegrationMode.REAL
        parallel_real = self.selected_mode(self.parallel_mode) is IntegrationMode.REAL
        return "adk" if gemini_real and parallel_real else "fixture"
