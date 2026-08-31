from collections.abc import Sequence

from app.models import ProductionMember, WorkspaceRole

LEGAL_CATEGORIES = frozenset(
    {
        "likeness_reference",
        "quotation",
        "music_reference",
        "character_reference",
    }
)
PRODUCTION_CATEGORIES = frozenset(
    {
        "brand_reference",
        "franchise_reference",
        "location_reference",
        "logo_reference",
        "product_placement",
    }
)


def stakeholders_for_lead(
    category: str, roster: Sequence[ProductionMember]
) -> list[ProductionMember]:
    """Attach roster people whose role matches the lead. Never invent members."""
    selected: list[ProductionMember] = []
    seen: set[str] = set()

    def add_role(role: WorkspaceRole) -> None:
        for member in roster:
            if member.role is role and member.id not in seen:
                selected.append(member)
                seen.add(member.id)

    add_role(WorkspaceRole.CLEARANCE)
    if category in LEGAL_CATEGORIES:
        add_role(WorkspaceRole.LEGAL)
    if category in PRODUCTION_CATEGORIES:
        add_role(WorkspaceRole.PRODUCTION)
    return selected
