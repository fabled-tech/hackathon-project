from datetime import datetime

from pydantic import BaseModel, Field

from .cases import ReviewerStatus
from .productions import WorkspaceRole


class WorkspaceMember(BaseModel):
    id: str
    name: str = Field(min_length=1, max_length=120)
    email: str = Field(min_length=1, max_length=254)
    role: WorkspaceRole = WorkspaceRole.CLEARANCE
    created_at: datetime


class OrganizationIssue(BaseModel):
    finding_id: str
    case_id: str
    production_id: str
    production_title: str
    case_excerpt: str
    category: str
    detected_item: str
    confidence: float = Field(ge=0, le=1)
    retrieved_at: datetime
    reviewer_status: ReviewerStatus
    assignee: str | None = None
    due_date: str | None = None
    comment_count: int = Field(ge=0)
