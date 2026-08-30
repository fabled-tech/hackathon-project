from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, Field


class ProductionStatus(StrEnum):
    DEVELOPMENT = "development"
    PRE_PRODUCTION = "pre_production"
    SHOOTING = "shooting"
    POST = "post"
    RELEASED = "released"


class Production(BaseModel):
    id: str
    title: str
    studio: str = ""
    status: ProductionStatus = ProductionStatus.DEVELOPMENT
    icon: str = "clapperboard"
    created_at: datetime


class ProductionSummary(Production):
    case_count: int = Field(default=0, ge=0)
    open_finding_count: int = Field(default=0, ge=0)
    escalated_finding_count: int = Field(default=0, ge=0)


class FindingComment(BaseModel):
    id: str
    author: str
    body: str
    created_at: datetime


class AgentRunStatus(StrEnum):
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class AgentRunTrigger(StrEnum):
    MANUAL = "manual"
    ON_NEW_CASE = "on_new_case"
    SCHEDULE = "schedule"


class AgentRun(BaseModel):
    id: str
    production_id: str
    kind: str
    trigger: AgentRunTrigger
    status: AgentRunStatus
    summary: str = ""
    created_at: datetime
    completed_at: datetime | None = None
