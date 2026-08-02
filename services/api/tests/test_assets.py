from datetime import UTC, datetime

from app.models import Case
from app.models.assets import AssetUpload
from app.repositories.assets import InMemoryAssetRepository
from app.repositories.cases import InMemoryCaseRepository


def make_case(case_id: str, *, created_at: datetime) -> Case:
    return Case(
        id=case_id,
        script_text=f"Script for {case_id}",
        created_at=created_at,
        findings=[],
    )


def test_in_memory_asset_repository_keeps_case_metadata_and_content() -> None:
    repository = InMemoryAssetRepository()
    asset = repository.store(
        "case-1",
        AssetUpload(filename="production-note.txt", content_type="text/plain", content=b"note"),
    )

    assert asset.case_id == "case-1"
    assert asset.filename == "production-note.txt"
    assert asset.byte_size == 4
    assert repository.list_for_case("case-1") == [asset]
    assert repository.get_content(asset.id) == b"note"


def test_in_memory_case_repository_returns_newest_case_summaries() -> None:
    repository = InMemoryCaseRepository()
    first = make_case("case-1", created_at=datetime(2026, 8, 1, tzinfo=UTC))
    second = make_case("case-2", created_at=datetime(2026, 8, 2, tzinfo=UTC))
    repository.create(first)
    repository.create(second)
    repository.increment_asset_count("case-2")

    summary = repository.list_recent(limit=1)[0]
    assert summary.id == "case-2"
    assert summary.finding_count == len(second.findings)
    assert summary.asset_count == 1
