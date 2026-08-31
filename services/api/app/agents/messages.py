from datetime import UTC, datetime
from uuid import uuid4

from app.models import CaseThreadMessage, ThreadAuthorKind


def agent_message(
    case_id: str,
    agent_name: str,
    body: str,
    *,
    finding_id: str | None = None,
    mentions: list[str] | None = None,
) -> CaseThreadMessage:
    return CaseThreadMessage(
        id=str(uuid4()),
        case_id=case_id,
        author_kind=ThreadAuthorKind.AGENT,
        agent_name=agent_name,
        body=body,
        finding_id=finding_id,
        mentions=mentions or [],
        created_at=datetime.now(UTC),
    )


def human_message(
    case_id: str,
    member_id: str,
    body: str,
    *,
    finding_id: str | None = None,
    mentions: list[str] | None = None,
) -> CaseThreadMessage:
    return CaseThreadMessage(
        id=str(uuid4()),
        case_id=case_id,
        author_kind=ThreadAuthorKind.HUMAN,
        member_id=member_id,
        body=body,
        finding_id=finding_id,
        mentions=mentions or [],
        created_at=datetime.now(UTC),
    )
