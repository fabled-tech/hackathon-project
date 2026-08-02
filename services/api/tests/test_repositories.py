from __future__ import annotations

from collections.abc import Callable, Mapping
from datetime import UTC, datetime
from typing import Any

import pytest

from app.models import AssetUpload, Case, Finding, ReviewerStatus
from app.repositories.assets import CloudStorageAssetRepository
from app.repositories.cases import CaseRepositoryNotFound, FirestoreCaseRepository


class FakeSnapshot:
    def __init__(self, document: Mapping[str, Any] | None) -> None:
        self._document = dict(document) if document is not None else None

    @property
    def exists(self) -> bool:
        return self._document is not None

    def to_dict(self) -> dict[str, Any] | None:
        return dict(self._document) if self._document is not None else None


class FakeQuery:
    def __init__(self, client: FakeFirestoreClient, path: tuple[str, ...]) -> None:
        self._client = client
        self._path = path
        self._descending = False
        self._limit: int | None = None
        self._matching_asset_id: str | None = None

    def order_by(self, _field: str, *, direction: str) -> FakeQuery:
        self._descending = direction == "DESCENDING"
        return self

    def limit(self, value: int) -> FakeQuery:
        self._limit = value
        return self

    def where(self, field: str, _operator: str, value: str) -> FakeQuery:
        if field == "id":
            self._matching_asset_id = value
        return self

    def stream(self) -> list[FakeSnapshot]:
        if self._path == ("assets",):
            documents = [
                document
                for path, document in self._client.documents.items()
                if len(path) == 4
                and path[0] == self._client.case_collection
                and path[2] == "assets"
                and document.get("id") == self._matching_asset_id
            ]
        else:
            documents = [
                document
                for path, document in self._client.documents.items()
                if path[:-1] == self._path
            ]
        documents.sort(
            key=lambda document: document.get("created_at", ""),
            reverse=self._descending,
        )
        if self._limit is not None:
            documents = documents[: self._limit]
        return [FakeSnapshot(document) for document in documents]


class FakeDocument:
    def __init__(self, client: FakeFirestoreClient, path: tuple[str, ...]) -> None:
        self._client = client
        self._path = path

    def set(self, document: Mapping[str, Any]) -> None:
        if self._client.fail_next_set:
            self._client.fail_next_set = False
            raise RuntimeError("Firestore is unavailable")
        self._client.documents[self._path] = dict(document)

    def get(self) -> FakeSnapshot:
        snapshot = FakeSnapshot(self._client.documents.get(self._path))
        if self._client.after_next_get is not None:
            after_next_get = self._client.after_next_get
            self._client.after_next_get = None
            after_next_get()
        return snapshot

    def update(self, values: Mapping[str, Any]) -> None:
        document = self._client.documents[self._path]
        for key, value in values.items():
            if isinstance(value, FakeIncrement):
                document[key] = int(document.get(key, 0)) + value.amount
            else:
                document[key] = value

    def delete(self) -> None:
        self._client.deleted_documents.append(self._path)
        if self._client.fail_next_delete:
            self._client.fail_next_delete = False
            raise RuntimeError("Firestore delete is unavailable")
        self._client.documents.pop(self._path, None)

    def collection(self, name: str) -> FakeCollection:
        return FakeCollection(self._client, (*self._path, name))


class FakeCollection(FakeQuery):
    def document(self, identifier: str) -> FakeDocument:
        return FakeDocument(self._client, (*self._path, identifier))


class FakeIncrement:
    def __init__(self, amount: int) -> None:
        self.amount = amount


class FakeFirestoreClient:
    def __init__(self, case_collection: str = "cases") -> None:
        self.case_collection = case_collection
        self.documents: dict[tuple[str, ...], dict[str, Any]] = {}
        self.fail_next_set = False
        self.fail_next_delete = False
        self.after_next_get: Callable[[], None] | None = None
        self.deleted_documents: list[tuple[str, ...]] = []

    def collection(self, name: str) -> FakeCollection:
        return FakeCollection(self, (name,))

    def collection_group(self, name: str) -> FakeQuery:
        return FakeQuery(self, (name,))

    @staticmethod
    def Increment(amount: int) -> FakeIncrement:
        return FakeIncrement(amount)


class FakeBlob:
    def __init__(self, client: FakeStorageClient, name: str) -> None:
        self._client = client
        self.name = name

    def upload_from_string(self, content: bytes, *, content_type: str) -> None:
        self._client.uploads[self.name] = (content, content_type)

    def download_as_bytes(self) -> bytes:
        return self._client.uploads[self.name][0]

    def delete(self) -> None:
        self._client.deleted.append(self.name)
        if self._client.fail_next_delete:
            self._client.fail_next_delete = False
            raise RuntimeError("Cloud Storage delete is unavailable")
        self._client.uploads.pop(self.name, None)


class FakeBucket:
    def __init__(self, client: FakeStorageClient, name: str) -> None:
        self._client = client
        self.name = name

    def blob(self, name: str) -> FakeBlob:
        return FakeBlob(self._client, name)


class FakeStorageClient:
    def __init__(self) -> None:
        self.uploads: dict[str, tuple[bytes, str]] = {}
        self.deleted: list[str] = []
        self.fail_next_delete = False

    def bucket(self, name: str) -> FakeBucket:
        return FakeBucket(self, name)


def make_case(case_id: str, *, created_at: datetime) -> Case:
    return Case(
        id=case_id,
        script_text=f"Script for {case_id}",
        created_at=created_at,
        findings=[],
    )


def test_cloud_asset_repository_writes_private_bytes_and_firestore_metadata() -> None:
    storage = FakeStorageClient()
    firestore = FakeFirestoreClient()
    repository = CloudStorageAssetRepository(
        project="test-project",
        bucket_name="asset-bucket",
        case_collection="cases",
        storage_client=storage,
        firestore_client=firestore,
    )

    asset = repository.store(
        "case-1",
        AssetUpload(filename="note.txt", content_type="text/plain", content=b"rights note"),
    )

    assert storage.uploads[asset.storage_reference] == (b"rights note", "text/plain")
    assert firestore.documents[("cases", "case-1", "assets", asset.id)]["filename"] == "note.txt"


def test_cloud_asset_repository_lists_metadata_and_downloads_private_content() -> None:
    storage = FakeStorageClient()
    firestore = FakeFirestoreClient()
    repository = CloudStorageAssetRepository(
        project="test-project",
        bucket_name="asset-bucket",
        case_collection="cases",
        storage_client=storage,
        firestore_client=firestore,
    )
    asset = repository.store(
        "case-1",
        AssetUpload(filename="note.txt", content_type="text/plain", content=b"rights note"),
    )

    assert repository.list_for_case("case-1") == [asset]
    assert repository.get_content(asset.id) == b"rights note"


def test_cloud_asset_repository_removes_bytes_when_metadata_write_fails() -> None:
    storage = FakeStorageClient()
    firestore = FakeFirestoreClient()
    firestore.fail_next_set = True
    repository = CloudStorageAssetRepository(
        project="test-project",
        bucket_name="asset-bucket",
        case_collection="cases",
        storage_client=storage,
        firestore_client=firestore,
    )

    with pytest.raises(RuntimeError, match="Firestore is unavailable"):
        repository.store(
            "case-1",
            AssetUpload(filename="note.txt", content_type="text/plain", content=b"rights note"),
        )

    assert storage.uploads == {}
    assert storage.deleted and storage.deleted[0].startswith("cases/case-1/assets/")


def test_cloud_asset_repository_preserves_metadata_error_when_rollback_fails() -> None:
    storage = FakeStorageClient()
    storage.fail_next_delete = True
    firestore = FakeFirestoreClient()
    firestore.fail_next_set = True
    repository = CloudStorageAssetRepository(
        project="test-project",
        bucket_name="asset-bucket",
        case_collection="cases",
        storage_client=storage,
        firestore_client=firestore,
    )

    with pytest.raises(RuntimeError, match="Firestore is unavailable") as error:
        repository.store(
            "case-1",
            AssetUpload(filename="note.txt", content_type="text/plain", content=b"rights note"),
        )

    assert isinstance(error.value.__cause__, RuntimeError)
    assert str(error.value.__cause__) == "Cloud Storage delete is unavailable"
    assert len(storage.uploads) == 1
    assert storage.deleted and storage.deleted[0].startswith("cases/case-1/assets/")


def test_cloud_asset_repository_deletes_private_bytes_and_metadata() -> None:
    storage = FakeStorageClient()
    firestore = FakeFirestoreClient()
    repository = CloudStorageAssetRepository(
        project="test-project",
        bucket_name="asset-bucket",
        case_collection="cases",
        storage_client=storage,
        firestore_client=firestore,
    )
    asset = repository.store(
        "case-1",
        AssetUpload(filename="note.txt", content_type="text/plain", content=b"rights note"),
    )

    repository.delete(asset)

    assert asset.storage_reference not in storage.uploads
    assert ("cases", "case-1", "assets", asset.id) not in firestore.documents


def test_cloud_asset_delete_attempts_metadata_when_private_object_deletion_fails() -> None:
    storage = FakeStorageClient()
    firestore = FakeFirestoreClient()
    repository = CloudStorageAssetRepository(
        project="test-project",
        bucket_name="asset-bucket",
        case_collection="cases",
        storage_client=storage,
        firestore_client=firestore,
    )
    asset = repository.store(
        "case-1",
        AssetUpload(filename="note.txt", content_type="text/plain", content=b"rights note"),
    )
    document_path = ("cases", "case-1", "assets", asset.id)
    storage.fail_next_delete = True

    with pytest.raises(RuntimeError, match="Cloud Storage delete is unavailable"):
        repository.delete(asset)

    assert asset.storage_reference in storage.uploads
    assert document_path not in firestore.documents
    assert firestore.deleted_documents == [document_path]


def test_cloud_asset_delete_attempts_private_object_when_metadata_deletion_fails() -> None:
    storage = FakeStorageClient()
    firestore = FakeFirestoreClient()
    repository = CloudStorageAssetRepository(
        project="test-project",
        bucket_name="asset-bucket",
        case_collection="cases",
        storage_client=storage,
        firestore_client=firestore,
    )
    asset = repository.store(
        "case-1",
        AssetUpload(filename="note.txt", content_type="text/plain", content=b"rights note"),
    )
    document_path = ("cases", "case-1", "assets", asset.id)
    firestore.fail_next_delete = True

    with pytest.raises(RuntimeError, match="Firestore delete is unavailable"):
        repository.delete(asset)

    assert asset.storage_reference not in storage.uploads
    assert document_path in firestore.documents
    assert storage.deleted == [asset.storage_reference]


def test_cloud_asset_delete_surfaces_both_cleanup_failures_after_attempting_each() -> None:
    storage = FakeStorageClient()
    firestore = FakeFirestoreClient()
    repository = CloudStorageAssetRepository(
        project="test-project",
        bucket_name="asset-bucket",
        case_collection="cases",
        storage_client=storage,
        firestore_client=firestore,
    )
    asset = repository.store(
        "case-1",
        AssetUpload(filename="note.txt", content_type="text/plain", content=b"rights note"),
    )
    document_path = ("cases", "case-1", "assets", asset.id)
    storage.fail_next_delete = True
    firestore.fail_next_delete = True

    with pytest.raises(ExceptionGroup) as error:
        repository.delete(asset)

    assert len(error.value.exceptions) == 2
    assert storage.deleted == [asset.storage_reference]
    assert firestore.deleted_documents == [document_path]


def test_firestore_case_repository_increments_asset_count_and_lists_newest() -> None:
    firestore = FakeFirestoreClient()
    repository = FirestoreCaseRepository("test-project", "cases", client=firestore)
    repository.create(make_case("case-1", created_at=datetime(2026, 8, 1, tzinfo=UTC)))
    repository.create(make_case("case-2", created_at=datetime(2026, 8, 2, tzinfo=UTC)))
    repository.increment_asset_count("case-1")

    summaries = repository.list_recent(limit=10)

    assert [summary.id for summary in summaries] == ["case-2", "case-1"]
    assert summaries[1].asset_count == 1


def test_firestore_case_repository_raises_for_unknown_case_increment() -> None:
    repository = FirestoreCaseRepository("test-project", "cases", client=FakeFirestoreClient())

    with pytest.raises(CaseRepositoryNotFound):
        repository.increment_asset_count("missing")


def test_firestore_finding_updates_do_not_overwrite_a_concurrent_asset_increment() -> None:
    firestore = FakeFirestoreClient()
    repository = FirestoreCaseRepository("test-project", "cases", client=firestore)
    case = make_case("case-1", created_at=datetime(2026, 8, 1, tzinfo=UTC))
    case.findings = [
        Finding(
            id="finding-1",
            case_id=case.id,
            category="brand",
            detected_item="Nimbus Soda",
            explanation="Fictional reference",
            confidence=0.8,
            supporting_evidence=[],
            source_urls=[],
            retrieved_at=datetime(2026, 8, 1, tzinfo=UTC),
            reviewer_status=ReviewerStatus.PENDING,
        )
    ]
    repository.create(case)
    document_path = ("cases", case.id)

    def increment_asset_count_concurrently() -> None:
        firestore.documents[document_path]["asset_count"] = 1

    firestore.after_next_get = increment_asset_count_concurrently

    repository.update_finding_status(case.id, "finding-1", ReviewerStatus.DISMISSED)

    assert firestore.documents[document_path]["asset_count"] == 1
    assert firestore.documents[document_path]["findings"][0]["reviewer_status"] == "dismissed"
