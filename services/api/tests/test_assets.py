from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

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
    assert repository.get_content("case-1", asset.id) == b"note"


def test_in_memory_asset_repository_deletes_metadata_and_content() -> None:
    repository = InMemoryAssetRepository()
    asset = repository.store(
        "case-1",
        AssetUpload(filename="production-note.txt", content_type="text/plain", content=b"note"),
    )

    repository.delete(asset)

    assert repository.list_for_case("case-1") == []
    with pytest.raises(KeyError):
        repository.get_content("case-1", asset.id)


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


def test_plain_text_asset_uploads_are_gone() -> None:
    from app.main import create_app

    client = TestClient(create_app())
    case = client.post("/api/cases", json={"script_text": "Nimbus Soda appears."}).json()

    upload = client.post(
        f"/api/cases/{case['id']}/assets",
        files={
            "file": (
                "production-note.txt",
                b"Keep the fictional brand.",
                "text/plain",
            )
        },
    )

    assert upload.status_code == 410
    listed = client.get(f"/api/cases/{case['id']}/assets")
    assert listed.status_code == 200
    assert listed.json() == []


def test_listing_assets_returns_not_found_for_an_unknown_case() -> None:
    from app.main import create_app

    client = TestClient(create_app())
    listed = client.get("/api/cases/missing/assets")

    assert listed.status_code == 404
    assert listed.json()["detail"] == "Case not found"


def test_listing_cases_returns_recent_case_summaries() -> None:
    from app.main import create_app

    client = TestClient(create_app())
    created = client.post("/api/cases", json={"script_text": "A first scene."}).json()

    response = client.get("/api/cases?limit=10")

    assert response.status_code == 200
    assert response.json()[0] == {
        "id": created["id"],
        "created_at": created["created_at"],
        "script_excerpt": "A first scene.",
        "finding_count": 0,
        "asset_count": 0,
    }
