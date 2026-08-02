import asyncio

import pytest
from fastapi import FastAPI, HTTPException
from starlette.requests import Request

from app.dependencies import ApplicationServices
from app.models import Asset, Case, Finding
from app.models.requests import MAX_ASSET_BYTES
from app.repositories.assets import InMemoryAssetRepository
from app.repositories.cases import InMemoryCaseRepository
from app.routes.cases import upload_asset


class EmptyAgentService:
    def analyze(self, case_id: str, script_text: str) -> list[Finding]:
        return []


class TrackingUpload:
    def __init__(self, content: bytes, content_type: str = "text/plain") -> None:
        self.content = content
        self.content_type = content_type
        self.filename = "production-note.txt"
        self.read_sizes: list[int] = []

    async def read(self, size: int = -1) -> bytes:
        self.read_sizes.append(size)
        return self.content if size < 0 else self.content[:size]


class FailingIncrementCaseRepository(InMemoryCaseRepository):
    def increment_asset_count(self, case_id: str) -> None:
        raise RuntimeError("asset count update failed")


class CleanupFailingAssetRepository(InMemoryAssetRepository):
    def delete(self, asset: Asset) -> None:
        super().delete(asset)
        raise RuntimeError("asset cleanup failed")


def make_request(
    case_repository: InMemoryCaseRepository, asset_repository: InMemoryAssetRepository
) -> Request:
    app = FastAPI()
    app.state.services = ApplicationServices(
        case_repository=case_repository,
        asset_repository=asset_repository,
        agent_service=EmptyAgentService(),
    )
    return Request({"type": "http", "app": app, "headers": []})


def create_case(repository: InMemoryCaseRepository) -> Case:
    return repository.create(
        Case(
            id="case-1",
            script_text="A scene.",
            created_at="2026-08-01T00:00:00Z",
            findings=[],
        )
    )


def test_upload_validates_content_type_without_reading_the_file() -> None:
    case_repository = InMemoryCaseRepository()
    case = create_case(case_repository)
    upload = TrackingUpload(b"not an image", content_type="image/jpeg")

    with pytest.raises(HTTPException) as error:
        asyncio.run(
            upload_asset(
                case.id,
                upload,
                make_request(case_repository, InMemoryAssetRepository()),
            )
        )

    assert error.value.status_code == 422
    assert upload.read_sizes == []


def test_upload_reads_only_the_validation_limit_before_rejecting_an_oversize_file() -> None:
    case_repository = InMemoryCaseRepository()
    case = create_case(case_repository)
    assets = InMemoryAssetRepository()
    upload = TrackingUpload(b"x" * (MAX_ASSET_BYTES + 20))

    with pytest.raises(HTTPException) as error:
        asyncio.run(upload_asset(case.id, upload, make_request(case_repository, assets)))

    assert error.value.status_code == 422
    assert upload.read_sizes == [MAX_ASSET_BYTES + 1]
    assert assets.list_for_case(case.id) == []


def test_upload_removes_the_asset_and_preserves_the_increment_error_when_cleanup_fails() -> None:
    case_repository = FailingIncrementCaseRepository()
    case = create_case(case_repository)
    assets = CleanupFailingAssetRepository()
    upload = TrackingUpload(b"production note")

    with pytest.raises(RuntimeError, match="asset count update failed"):
        asyncio.run(upload_asset(case.id, upload, make_request(case_repository, assets)))

    assert assets.list_for_case(case.id) == []
