from datetime import UTC, datetime

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


def test_uploading_a_text_asset_returns_metadata_and_lists_it() -> None:
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

    assert upload.status_code == 201
    assert upload.json()["byte_size"] == len(b"Keep the fictional brand.")
    assert "storage_reference" in upload.json()

    listed = client.get(f"/api/cases/{case['id']}/assets")
    assert listed.status_code == 200
    assert [asset["filename"] for asset in listed.json()] == ["production-note.txt"]
    assert "content" not in listed.json()[0]


def test_upload_rejects_unsupported_content_and_oversized_files() -> None:
    from app.main import create_app

    client = TestClient(create_app())
    case_id = client.post("/api/cases", json={"script_text": "A scene."}).json()["id"]

    invalid_type = client.post(
        f"/api/cases/{case_id}/assets",
        files={"file": ("poster.jpg", b"image", "image/jpeg")},
    )
    oversized = client.post(
        f"/api/cases/{case_id}/assets",
        files={"file": ("long.txt", b"x" * (256 * 1024 + 1), "text/plain")},
    )

    assert invalid_type.status_code == 422
    assert oversized.status_code == 422


def test_asset_routes_return_not_found_for_an_unknown_case() -> None:
    from app.main import create_app

    client = TestClient(create_app())

    upload = client.post(
        "/api/cases/missing/assets",
        files={"file": ("production-note.txt", b"note", "text/plain")},
    )
    listed = client.get("/api/cases/missing/assets")

    assert upload.status_code == 404
    assert upload.json()["detail"] == "Case not found"
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
