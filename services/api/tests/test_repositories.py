from __future__ import annotations

from collections.abc import Callable, Mapping
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from app.models import (
    AssetLifecycle,
    AssetUpload,
    Case,
    Finding,
    Production,
    ReviewerStatus,
    StoredAsset,
)
from app.repositories.assets import CloudStorageAssetRepository as CloudStorageAssetRepositoryImpl
from app.repositories.cases import (
    CaseRepositoryNotFound,
    FindingNotFound,
    FirestoreCaseRepository,
    InMemoryCaseRepository,
)
from app.repositories.production_icons import CloudStorageProductionIconRepository
from app.repositories.productions import (
    FirestoreProductionRepository,
    InMemoryProductionRepository,
)


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
        self._matching_lifecycles: list[str] | None = None
        self._matching_production_id: str | None = None

    def order_by(self, _field: str, *, direction: str) -> FakeQuery:
        self._descending = direction == "DESCENDING"
        return self

    def limit(self, value: int) -> FakeQuery:
        self._limit = value
        return self

    def where(self, field: str, _operator: str, value: Any) -> FakeQuery:
        if field == "id":
            self._matching_asset_id = value
        if field == "lifecycle":
            self._matching_lifecycles = list(value)
        if field == "production_id":
            self._matching_production_id = value
        return self

    def stream(self) -> list[FakeSnapshot]:
        if self._path == ("assets",):
            documents = [
                document
                for path, document in self._client.documents.items()
                if len(path) == 4
                and path[0] == self._client.case_collection
                and path[2] == "assets"
                and (
                    self._matching_asset_id is None
                    or document.get("id") == self._matching_asset_id
                )
                and (
                    self._matching_lifecycles is None
                    or document.get("lifecycle") in self._matching_lifecycles
                )
            ]
        else:
            documents = [
                document
                for path, document in self._client.documents.items()
                if path[:-1] == self._path
                and (
                    self._matching_production_id is None
                    or document.get("production_id") == self._matching_production_id
                )
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

    def get(self, *, transaction: FakeTransaction | None = None) -> FakeSnapshot:
        if transaction is not None:
            transaction.reads.append(self._path)
        snapshot = FakeSnapshot(self._client.documents.get(self._path))
        if self._client.after_next_get is not None:
            after_next_get = self._client.after_next_get
            self._client.after_next_get = None
            after_next_get()
        return snapshot

    def update(self, values: Mapping[str, Any]) -> None:
        self._client.direct_updates.append(self._path)
        if self._client.fail_next_update:
            self._client.fail_next_update = False
            raise RuntimeError("Firestore update is unavailable")
        self._apply_update(values)

    def _apply_update(self, values: Mapping[str, Any]) -> None:
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


class FakeTransaction:
    def __init__(self) -> None:
        self.reads: list[tuple[str, ...]] = []
        self.updates: list[tuple[tuple[str, ...], Mapping[str, Any]]] = []

    def update(self, document: FakeDocument, values: Mapping[str, Any]) -> None:
        self.updates.append((document._path, dict(values)))
        if document._client.fail_next_update:
            document._client.fail_next_update = False
            raise RuntimeError("Firestore update is unavailable")
        document._apply_update(values)

    def delete(self, document: FakeDocument) -> None:
        document.delete()

    def set(self, document: FakeDocument, values: Mapping[str, Any]) -> None:
        document.set(values)


class FakeIncrement:
    def __init__(self, amount: int) -> None:
        self.amount = amount


class FakeFirestoreClient:
    def __init__(self, case_collection: str = "cases") -> None:
        self.case_collection = case_collection
        self.documents: dict[tuple[str, ...], dict[str, Any]] = {}
        self.fail_next_set = False
        self.fail_next_batch = False
        self.batch_commits_then_fails = False
        self.fail_next_update = False
        self.fail_next_delete = False
        self.after_next_get: Callable[[], None] | None = None
        self.deleted_documents: list[tuple[str, ...]] = []
        self.direct_updates: list[tuple[str, ...]] = []
        self.transactions: list[FakeTransaction] = []

    def collection(self, name: str) -> FakeCollection:
        return FakeCollection(self, (name,))

    def collection_group(self, name: str) -> FakeQuery:
        return FakeQuery(self, (name,))

    def transaction(self) -> FakeTransaction:
        transaction = FakeTransaction()
        self.transactions.append(transaction)
        return transaction

    def batch(self) -> FakeBatch:
        return FakeBatch(self)

def run_fake_transaction(
    firestore: FakeFirestoreClient,
) -> Callable[[Callable[[FakeTransaction], Finding]], Finding]:
    return lambda operation: operation(firestore.transaction())


def fake_transactional(
    operation: Callable[[FakeTransaction], Finding],
) -> Callable[[FakeTransaction], Finding]:
    return operation


def CloudStorageAssetRepository(*args: Any, **kwargs: Any) -> CloudStorageAssetRepositoryImpl:
    kwargs.setdefault("transactional_decorator", fake_transactional)
    return CloudStorageAssetRepositoryImpl(*args, **kwargs)


def fake_case_repository(
    firestore: FakeFirestoreClient,
    *,
    transaction_runner: Callable[[Callable[[FakeTransaction], Finding]], Finding] | None = None,
) -> FirestoreCaseRepository:
    return FirestoreCaseRepository(
        "test-project",
        "cases",
        client=firestore,
        increment_factory=FakeIncrement,
        transactional_decorator=fake_transactional,
        transaction_runner=transaction_runner,
    )


class FakeStorageNotFound(Exception):
    pass


class FakeStoragePreconditionFailed(Exception):
    pass


class FakeBlob:
    def __init__(self, client: FakeStorageClient, name: str) -> None:
        self._client = client
        self.name = name
        self.metadata: dict[str, str] | None = client.metadata.get(name)

    @property
    def generation(self) -> int | None:
        return self._client.generations.get(self.name)

    def reload(self) -> None:
        self.metadata = self._client.metadata.get(self.name)

    def upload_from_string(
        self,
        content: bytes,
        *,
        content_type: str,
        if_generation_match: int | None = None,
    ) -> None:
        if content and self._client.before_content_upload is not None:
            before_content_upload = self._client.before_content_upload
            self._client.before_content_upload = None
            before_content_upload()
        generation = self._client.generations.get(self.name)
        if if_generation_match == 0 and generation is not None:
            raise FakeStoragePreconditionFailed(self.name)
        if if_generation_match not in (None, 0) and generation != if_generation_match:
            raise FakeStoragePreconditionFailed(self.name)
        self._client.uploads[self.name] = (content, content_type)
        self._client.generations[self.name] = (generation or 0) + 1
        self._client.metadata[self.name] = dict(self.metadata or {})

    def download_as_bytes(self) -> bytes:
        return self._client.uploads[self.name][0]

    def delete(self, *, if_generation_match: int | None = None) -> None:
        self._client.deleted.append(self.name)
        self._client.delete_generation_matches.append(if_generation_match)
        if if_generation_match is not None and self._client.before_conditional_delete is not None:
            before_conditional_delete = self._client.before_conditional_delete
            self._client.before_conditional_delete = None
            before_conditional_delete()
        if self._client.fail_next_delete:
            self._client.fail_next_delete = False
            raise RuntimeError("Cloud Storage delete is unavailable")
        if self.name not in self._client.uploads and self._client.missing_raises_not_found:
            raise FakeStorageNotFound(self.name)
        if self.name not in self._client.uploads:
            return
        if (
            if_generation_match is not None
            and self._client.generations.get(self.name) != if_generation_match
        ):
            raise FakeStoragePreconditionFailed(self.name)
        self._client.uploads.pop(self.name, None)
        self._client.generations.pop(self.name, None)
        self._client.metadata.pop(self.name, None)


class FakeBucket:
    def __init__(self, client: FakeStorageClient, name: str) -> None:
        self._client = client
        self.name = name

    def blob(self, name: str) -> FakeBlob:
        return FakeBlob(self._client, name)

    def list_blobs(self, *, prefix: str) -> list[FakeBlob]:
        return [
            FakeBlob(self._client, name)
            for name in self._client.uploads
            if name.startswith(prefix)
        ]


class FakeBatch:
    def __init__(self, client: FakeFirestoreClient) -> None:
        self._client = client
        self._sets: list[tuple[FakeDocument, Mapping[str, Any]]] = []

    def set(self, document: FakeDocument, values: Mapping[str, Any]) -> None:
        self._sets.append((document, values))

    def commit(self) -> None:
        if self._client.fail_next_batch:
            self._client.fail_next_batch = False
            raise RuntimeError("Firestore batch is unavailable")
        for document, values in self._sets:
            document.set(values)
        if self._client.batch_commits_then_fails:
            self._client.batch_commits_then_fails = False
            raise RuntimeError("Firestore batch outcome is unknown")


class FakeStorageClient:
    def __init__(self) -> None:
        self.uploads: dict[str, tuple[bytes, str]] = {}
        self.generations: dict[str, int] = {}
        self.metadata: dict[str, dict[str, str]] = {}
        self.deleted: list[str] = []
        self.delete_generation_matches: list[int | None] = []
        self.fail_next_delete = False
        self.missing_raises_not_found = False
        self.before_content_upload: Callable[[], None] | None = None
        self.before_conditional_delete: Callable[[], None] | None = None

    def bucket(self, name: str) -> FakeBucket:
        return FakeBucket(self, name)


def make_case(case_id: str, *, created_at: datetime) -> Case:
    return Case(
        id=case_id,
        script_text=f"Script for {case_id}",
        created_at=created_at,
        findings=[],
    )


def test_legacy_stored_asset_metadata_defaults_to_ready() -> None:
    asset = StoredAsset.model_validate(
        {
            "id": "asset-1",
            "case_id": "case-1",
            "filename": "note.txt",
            "content_type": "text/plain",
            "byte_size": 4,
            "created_at": datetime(2026, 8, 2, tzinfo=UTC),
            "storage_reference": "rightsrader-assets/case-1/asset-1",
        }
    )

    assert asset.lifecycle is AssetLifecycle.READY


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
    assert (
        firestore.documents[("cases", "case-1", "assets", asset.id)]["lifecycle"]
        == AssetLifecycle.READY
    )


def test_asset_repository_uses_injected_transactional_decorator_for_ready_promotion() -> None:
    storage = FakeStorageClient()
    firestore = FakeFirestoreClient()
    decorated_transactions: list[FakeTransaction] = []

    def deferred_transactional(
        operation: Callable[[FakeTransaction], Any],
    ) -> Callable[[FakeTransaction], Any]:
        def execute(transaction: FakeTransaction) -> Any:
            decorated_transactions.append(transaction)
            return operation(transaction)

        return execute

    repository = CloudStorageAssetRepositoryImpl(
        project="test-project",
        bucket_name="asset-bucket",
        case_collection="cases",
        storage_client=storage,
        firestore_client=firestore,
        transactional_decorator=deferred_transactional,
    )

    asset = repository.store(
        "case-1",
        AssetUpload(filename="note.txt", content_type="text/plain", content=b"rights note"),
    )

    assert decorated_transactions
    assert firestore.documents[("cases", "case-1", "assets", asset.id)]["lifecycle"] == "ready"
    assert ("cases_asset_lifecycle", asset.id) not in firestore.documents


def test_cloud_asset_store_retains_cleanup_pending_metadata_after_dual_failure() -> None:
    storage = FakeStorageClient()
    storage.fail_next_delete = True
    firestore = FakeFirestoreClient()
    firestore.fail_next_update = True
    repository = CloudStorageAssetRepository(
        project="test-project",
        bucket_name="asset-bucket",
        case_collection="cases",
        storage_client=storage,
        firestore_client=firestore,
    )

    with pytest.raises(RuntimeError, match="Firestore update is unavailable") as error:
        repository.store(
            "case-1",
            AssetUpload(filename="note.txt", content_type="text/plain", content=b"rights note"),
        )

    assert isinstance(error.value.__cause__, RuntimeError)
    assert str(error.value.__cause__) == "Cloud Storage delete is unavailable"
    assert len(firestore.documents) == 2
    document = next(
        document
        for path, document in firestore.documents.items()
        if path[:3] == ("cases", "case-1", "assets")
    )
    assert document["storage_reference"].startswith("rightsrader-assets/case-1/")
    assert document["lifecycle"] == AssetLifecycle.CLEANUP_PENDING
    assert repository.list_for_case("case-1") == []


def test_cloud_asset_reconciliation_treats_missing_object_as_removed() -> None:
    storage = FakeStorageClient()
    storage.missing_raises_not_found = True
    firestore = FakeFirestoreClient()
    repository = CloudStorageAssetRepository(
        project="test-project",
        bucket_name="asset-bucket",
        case_collection="cases",
        storage_client=storage,
        firestore_client=firestore,
        not_found_exception=FakeStorageNotFound,
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
    assert firestore.documents[document_path]["lifecycle"] == AssetLifecycle.CLEANUP_PENDING
    assert repository.reconcile_pending(limit=10).reconciled == 1
    assert document_path not in firestore.documents


def test_reconciliation_fences_an_expired_pending_writer_before_upload() -> None:
    storage = FakeStorageClient()
    firestore = FakeFirestoreClient()
    now = datetime(2026, 8, 2, tzinfo=UTC)

    def clock() -> datetime:
        return now

    repository: CloudStorageAssetRepository

    def reconcile_before_writer_checks_lease() -> None:
        nonlocal now
        now += timedelta(minutes=6)
        assert repository.reconcile_pending(limit=10).reconciled == 1

    repository = CloudStorageAssetRepository(
        project="test-project",
        bucket_name="asset-bucket",
        case_collection="cases",
        storage_client=storage,
        firestore_client=firestore,
        clock=clock,
        before_upload=reconcile_before_writer_checks_lease,
    )

    with pytest.raises(RuntimeError, match="Asset write lease was lost"):
        repository.store(
            "case-1",
            AssetUpload(filename="note.txt", content_type="text/plain", content=b"rights note"),
        )

    assert storage.uploads == {}
    assert firestore.documents == {}
    assert repository.list_for_case("case-1") == []


def test_generation_fence_blocks_writer_after_cleanup_wins_between_lease_check_and_upload() -> None:
    storage = FakeStorageClient()
    firestore = FakeFirestoreClient()
    now = datetime(2026, 8, 2, tzinfo=UTC)

    def clock() -> datetime:
        return now

    repository: CloudStorageAssetRepository

    def reconcile_after_writer_checks_lease() -> None:
        nonlocal now
        now += timedelta(minutes=6)
        assert repository.reconcile_pending(limit=10).reconciled == 1

    repository = CloudStorageAssetRepository(
        project="test-project",
        bucket_name="asset-bucket",
        case_collection="cases",
        storage_client=storage,
        firestore_client=firestore,
        clock=clock,
    )
    storage.before_content_upload = reconcile_after_writer_checks_lease

    with pytest.raises(FakeStoragePreconditionFailed):
        repository.store(
            "case-1",
            AssetUpload(filename="note.txt", content_type="text/plain", content=b"rights note"),
        )

    assert storage.uploads == {}
    assert firestore.documents == {}
    assert repository.list_for_case("case-1") == []


def test_pending_metadata_batch_failure_cleans_the_marker_without_partial_documents() -> None:
    storage = FakeStorageClient()
    firestore = FakeFirestoreClient()
    firestore.fail_next_batch = True
    repository = CloudStorageAssetRepository(
        project="test-project",
        bucket_name="asset-bucket",
        case_collection="cases",
        storage_client=storage,
        firestore_client=firestore,
    )

    with pytest.raises(RuntimeError, match="Firestore batch is unavailable"):
        repository.store(
            "case-1",
            AssetUpload(filename="note.txt", content_type="text/plain", content=b"rights note"),
        )

    assert firestore.documents == {}
    assert storage.uploads == {}


def test_reconciliation_recovers_a_marker_left_after_persistence_cleanup_failure() -> None:
    storage = FakeStorageClient()
    storage.fail_next_delete = True
    firestore = FakeFirestoreClient()
    firestore.fail_next_batch = True
    repository = CloudStorageAssetRepository(
        project="test-project",
        bucket_name="asset-bucket",
        case_collection="cases",
        storage_client=storage,
        firestore_client=firestore,
    )

    with pytest.raises(RuntimeError, match="Firestore batch is unavailable"):
        repository.store(
            "case-1",
            AssetUpload(filename="note.txt", content_type="text/plain", content=b"rights note"),
        )

    assert len(storage.uploads) == 1
    assert repository.reconcile_pending(limit=10).reconciled == 1
    assert storage.uploads == {}


def test_unknown_pending_batch_outcome_leaves_reconcilable_private_metadata() -> None:
    storage = FakeStorageClient()
    firestore = FakeFirestoreClient()
    firestore.batch_commits_then_fails = True
    now = datetime(2026, 8, 2, tzinfo=UTC)

    def clock() -> datetime:
        return now

    repository = CloudStorageAssetRepository(
        project="test-project",
        bucket_name="asset-bucket",
        case_collection="cases",
        storage_client=storage,
        firestore_client=firestore,
        clock=clock,
    )

    with pytest.raises(RuntimeError, match="Firestore batch outcome is unknown"):
        repository.store(
            "case-1",
            AssetUpload(filename="note.txt", content_type="text/plain", content=b"rights note"),
        )

    assert len(firestore.documents) == 2
    assert storage.uploads == {}
    now += timedelta(minutes=6)
    assert repository.reconcile_pending(limit=10).reconciled == 1
    assert firestore.documents == {}


def test_reconciliation_counts_a_malformed_lifecycle_record_and_continues() -> None:
    storage = FakeStorageClient()
    firestore = FakeFirestoreClient()
    firestore.documents[("cases_asset_lifecycle", "malformed")] = {"lifecycle": "pending"}
    repository = CloudStorageAssetRepository(
        project="test-project",
        bucket_name="asset-bucket",
        case_collection="cases",
        storage_client=storage,
        firestore_client=firestore,
    )

    result = repository.reconcile_pending(limit=10)

    assert result == type(result)(reconciled=0, failed=1)


def test_delete_hides_ready_metadata_before_object_cleanup_and_reconciles_failure() -> None:
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
    assert firestore.documents[document_path]["lifecycle"] == AssetLifecycle.CLEANUP_PENDING
    assert repository.list_for_case("case-1") == []
    assert repository.reconcile_pending(limit=10).reconciled == 1
    assert document_path not in firestore.documents


def test_cleanup_keeps_later_owned_generation_after_content_generation_is_persisted() -> None:
    storage = FakeStorageClient()
    firestore = FakeFirestoreClient()
    repository = CloudStorageAssetRepository(
        project="test-project",
        bucket_name="asset-bucket",
        case_collection="cases",
        storage_client=storage,
        firestore_client=firestore,
        precondition_failed_exception=FakeStoragePreconditionFailed,
    )
    asset = repository.store(
        "case-1",
        AssetUpload(filename="note.txt", content_type="text/plain", content=b"rights note"),
    )
    blob = storage.bucket("asset-bucket").blob(asset.storage_reference)
    blob.metadata = {
        "rightsrader_asset_state": "content",
        "rightsrader_case_id": asset.case_id,
        "rightsrader_asset_id": asset.id,
        "rightsrader_writer_id": asset.writer_id,
    }
    blob.upload_from_string(b"replacement", content_type="text/plain", if_generation_match=2)

    with pytest.raises(FakeStoragePreconditionFailed):
        repository.delete(asset)

    assert storage.generations[asset.storage_reference] == 3
    assert storage.metadata[asset.storage_reference]["rightsrader_writer_id"] == asset.writer_id
    assert storage.delete_generation_matches == [2]
    assert all(match is not None for match in storage.delete_generation_matches)


def test_cleanup_precondition_race_keeps_private_records_when_replacement_is_not_owned() -> None:
    storage = FakeStorageClient()
    firestore = FakeFirestoreClient()
    repository = CloudStorageAssetRepository(
        project="test-project",
        bucket_name="asset-bucket",
        case_collection="cases",
        storage_client=storage,
        firestore_client=firestore,
        precondition_failed_exception=FakeStoragePreconditionFailed,
    )
    asset = repository.store(
        "case-1",
        AssetUpload(filename="note.txt", content_type="text/plain", content=b"rights note"),
    )
    document_path = ("cases", "case-1", "assets", asset.id)

    def replace_with_foreign_generation() -> None:
        storage.generations[asset.storage_reference] = 3
        storage.metadata[asset.storage_reference] = {"rightsrader_asset_state": "content"}

    storage.before_conditional_delete = replace_with_foreign_generation

    with pytest.raises(FakeStoragePreconditionFailed):
        repository.delete(asset)

    assert storage.generations[asset.storage_reference] == 3
    assert document_path in firestore.documents
    assert firestore.documents[document_path]["lifecycle"] == AssetLifecycle.CLEANUP_PENDING
    assert storage.delete_generation_matches == [2]


def test_cleanup_recovers_failed_promotion_by_persisting_verified_content_generation() -> None:
    storage = FakeStorageClient()
    firestore = FakeFirestoreClient()
    repository = CloudStorageAssetRepository(
        project="test-project",
        bucket_name="asset-bucket",
        case_collection="cases",
        storage_client=storage,
        firestore_client=firestore,
        precondition_failed_exception=FakeStoragePreconditionFailed,
    )
    asset = repository.store(
        "case-1",
        AssetUpload(filename="note.txt", content_type="text/plain", content=b"rights note"),
    )
    recovering = asset.model_copy(
        update={
            "lifecycle": AssetLifecycle.CLEANUP_PENDING,
            "lease_token": "recovery-lease",
            "content_generation": None,
        }
    )
    firestore.documents[("cases", asset.case_id, "assets", asset.id)] = recovering.model_dump(
        mode="json"
    )
    firestore.documents[("cases_asset_lifecycle", asset.id)] = recovering.model_dump(mode="json")

    assert repository.reconcile_pending(limit=10).reconciled == 1
    assert asset.storage_reference not in storage.uploads
    assert storage.delete_generation_matches[-1] == 2


def test_delete_aborts_before_touching_bytes_when_private_transition_fails() -> None:
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
    firestore.fail_next_update = True

    with pytest.raises(RuntimeError, match="Firestore update is unavailable"):
        repository.delete(asset)

    assert asset.storage_reference in storage.uploads
    assert repository.list_for_case("case-1") == [asset]


def test_reconciliation_uses_only_its_configured_lifecycle_namespace() -> None:
    storage = FakeStorageClient()
    firestore = FakeFirestoreClient()
    repository = CloudStorageAssetRepository(
        project="test-project",
        bucket_name="asset-bucket",
        case_collection="cases",
        storage_client=storage,
        firestore_client=firestore,
    )
    foreign_path = ("other_app_asset_lifecycle", "asset-foreign")
    firestore.documents[foreign_path] = {
        "id": "asset-foreign",
        "case_id": "case-foreign",
        "filename": "foreign.txt",
        "content_type": "text/plain",
        "byte_size": 1,
        "created_at": datetime(2026, 8, 2, tzinfo=UTC),
        "storage_reference": "foreign/object",
        "lifecycle": AssetLifecycle.CLEANUP_PENDING,
    }

    assert repository.reconcile_pending(limit=10).reconciled == 0
    assert foreign_path in firestore.documents


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
    assert repository.get_content("case-1", asset.id) == b"rights note"


def test_cloud_asset_repository_reads_content_from_the_case_scoped_document() -> None:
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

    def reject_global_asset_lookup(_name: str) -> FakeQuery:
        raise AssertionError("content reads must not use a collection-group lookup")

    firestore.collection_group = reject_global_asset_lookup  # type: ignore[assignment]

    assert repository.get_content("case-1", asset.id) == b"rights note"


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("id", "different-asset"),
        ("case_id", "different-case"),
        ("lifecycle", AssetLifecycle.CLEANUP_PENDING),
    ],
    ids=["different-id", "different-case", "not-ready"],
)
def test_cloud_asset_repository_rejects_content_with_untrusted_metadata(
    field: str, value: str | AssetLifecycle
) -> None:
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
    firestore.documents[("cases", "case-1", "assets", asset.id)][field] = value

    with pytest.raises(KeyError):
        repository.get_content("case-1", asset.id)


def test_cloud_asset_repository_removes_marker_when_pending_metadata_batch_fails() -> None:
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
    assert storage.deleted[0].startswith("rightsrader-assets/case-1/")


def test_cloud_asset_repository_preserves_persistence_error_when_marker_cleanup_fails() -> None:
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
    assert storage.deleted[0].startswith("rightsrader-assets/case-1/")


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


def test_cloud_asset_delete_keeps_metadata_when_private_object_deletion_fails() -> None:
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
    assert document_path in firestore.documents
    assert document_path not in firestore.deleted_documents


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


def test_cloud_asset_delete_does_not_attempt_metadata_when_object_deletion_fails() -> None:
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

    with pytest.raises(RuntimeError, match="Cloud Storage delete is unavailable"):
        repository.delete(asset)

    assert storage.deleted == [asset.storage_reference]
    assert document_path in firestore.documents
    assert document_path not in firestore.deleted_documents


def test_firestore_case_repository_increments_asset_count_and_lists_newest() -> None:
    firestore = FakeFirestoreClient()
    repository = fake_case_repository(firestore)
    repository.create(make_case("case-1", created_at=datetime(2026, 8, 1, tzinfo=UTC)))
    repository.create(make_case("case-2", created_at=datetime(2026, 8, 2, tzinfo=UTC)))
    repository.increment_asset_count("case-1")

    summaries = repository.list_recent(limit=10)

    assert [summary.id for summary in summaries] == ["case-2", "case-1"]
    assert summaries[1].asset_count == 1


def test_firestore_case_repository_raises_for_unknown_case_increment() -> None:
    repository = fake_case_repository(FakeFirestoreClient())

    with pytest.raises(CaseRepositoryNotFound):
        repository.increment_asset_count("missing")


def test_firestore_finding_updates_do_not_overwrite_a_concurrent_asset_increment() -> None:
    firestore = FakeFirestoreClient()
    repository = fake_case_repository(
        firestore,
        transaction_runner=run_fake_transaction(firestore),
    )
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


def test_firestore_finding_status_update_reads_and_writes_with_a_transaction() -> None:
    firestore = FakeFirestoreClient()
    repository = fake_case_repository(
        firestore,
        transaction_runner=run_fake_transaction(firestore),
    )
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

    finding = repository.update_finding_status(
        case.id, "finding-1", ReviewerStatus.ESCALATED
    )

    assert finding.reviewer_status is ReviewerStatus.ESCALATED
    assert firestore.transactions[0].reads == [document_path]
    assert firestore.transactions[0].updates == [
        (document_path, {"findings": firestore.documents[document_path]["findings"]})
    ]
    assert firestore.direct_updates == []


def test_injected_actual_client_shape_uses_injected_firestore_primitives() -> None:
    firestore_client = FakeFirestoreClient()
    increment_calls: list[int] = []
    decorated_transactions: list[FakeTransaction] = []

    def increment(amount: int) -> FakeIncrement:
        increment_calls.append(amount)
        return FakeIncrement(amount)

    def transactional(
        operation: Callable[[FakeTransaction], Finding],
    ) -> Callable[[FakeTransaction], Finding]:
        def invoke(transaction: FakeTransaction) -> Finding:
            decorated_transactions.append(transaction)
            return operation(transaction)

        return invoke

    repository = FirestoreCaseRepository(
        "test-project",
        "cases",
        client=firestore_client,
        increment_factory=increment,
        transactional_decorator=transactional,
    )
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
    repository.increment_asset_count(case.id)

    repository.update_finding_status(case.id, "finding-1", ReviewerStatus.DISMISSED)

    assert increment_calls == [1]
    assert decorated_transactions == [firestore_client.transactions[0]]


def test_firestore_finding_status_retry_preserves_an_independent_reviewer_update() -> None:
    firestore = FakeFirestoreClient()
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
        ),
        Finding(
            id="finding-2",
            case_id=case.id,
            category="quotation",
            detected_item="A fictional quotation",
            explanation="Fictional reference",
            confidence=0.8,
            supporting_evidence=[],
            source_urls=[],
            retrieved_at=datetime(2026, 8, 1, tzinfo=UTC),
            reviewer_status=ReviewerStatus.PENDING,
        ),
    ]
    document_path = ("cases", case.id)

    def retry_after_independent_update(
        operation: Callable[[FakeTransaction], Finding],
    ) -> Finding:
        operation(firestore.transaction())
        firestore.documents[document_path]["findings"][1]["reviewer_status"] = "escalated"
        return operation(firestore.transaction())

    repository = fake_case_repository(
        firestore,
        transaction_runner=retry_after_independent_update,
    )
    repository.create(case)

    finding = repository.update_finding_status(
        case.id, "finding-1", ReviewerStatus.DISMISSED
    )

    assert finding.reviewer_status is ReviewerStatus.DISMISSED
    assert [
        stored_finding["reviewer_status"]
        for stored_finding in firestore.documents[document_path]["findings"]
    ] == ["dismissed", "escalated"]
    assert len(firestore.transactions) == 2


def test_firestore_finding_status_update_raises_for_missing_case_in_transaction() -> None:
    firestore = FakeFirestoreClient()
    repository = fake_case_repository(
        firestore,
        transaction_runner=run_fake_transaction(firestore),
    )

    with pytest.raises(CaseRepositoryNotFound):
        repository.update_finding_status("missing", "finding-1", ReviewerStatus.DISMISSED)

    assert firestore.transactions[0].reads == [("cases", "missing")]


def test_firestore_finding_status_update_raises_for_missing_finding_in_transaction() -> None:
    firestore = FakeFirestoreClient()
    repository = fake_case_repository(
        firestore,
        transaction_runner=run_fake_transaction(firestore),
    )
    repository.create(make_case("case-1", created_at=datetime(2026, 8, 1, tzinfo=UTC)))

    with pytest.raises(FindingNotFound, match="finding-1"):
        repository.update_finding_status("case-1", "finding-1", ReviewerStatus.DISMISSED)

    assert firestore.transactions[0].reads == [("cases", "case-1")]


def test_in_memory_case_repository_deletes_a_disposable_case() -> None:
    repository = InMemoryCaseRepository()
    case = make_case("case-1", created_at=datetime(2026, 8, 1, tzinfo=UTC))
    repository.create(case)

    repository.delete(case.id)

    with pytest.raises(CaseRepositoryNotFound):
        repository.get(case.id)


def test_firestore_case_repository_deletes_a_disposable_case() -> None:
    firestore = FakeFirestoreClient()
    repository = fake_case_repository(firestore)
    case = make_case("case-1", created_at=datetime(2026, 8, 1, tzinfo=UTC))
    repository.create(case)

    repository.delete(case.id)

    assert ("cases", case.id) not in firestore.documents
    assert firestore.deleted_documents == [("cases", case.id)]


@pytest.mark.parametrize(
    "repository_factory",
    [
        InMemoryCaseRepository,
        lambda: fake_case_repository(FakeFirestoreClient()),
    ],
)
def test_case_repository_delete_raises_for_a_missing_case(
    repository_factory: Callable[[], Any],
) -> None:
    repository = repository_factory()

    with pytest.raises(CaseRepositoryNotFound):
        repository.delete("missing")


def test_in_memory_production_repository_updates_ignore_keywords() -> None:
    repository = InMemoryProductionRepository()
    production = Production(
        id="production-1",
        title="Studio Feature",
        created_at=datetime(2026, 8, 30, tzinfo=UTC),
    )
    repository.create(production)

    updated = repository.update(
        production.id,
        ignore_keywords=["Universal Studios", "NBC peacock"],
    )

    assert updated.ignore_keywords == ["Universal Studios", "NBC peacock"]
    assert repository.get(production.id).ignore_keywords == updated.ignore_keywords


def test_firestore_production_repository_persists_ignore_keywords() -> None:
    firestore = FakeFirestoreClient()
    repository = FirestoreProductionRepository(
        "test-project",
        "productions",
        client=firestore,
    )
    production = Production(
        id="production-1",
        title="Studio Feature",
        created_at=datetime(2026, 8, 30, tzinfo=UTC),
    )
    repository.create(production)

    updated = repository.update(
        production.id,
        ignore_keywords=["Universal Studios"],
    )

    assert updated.ignore_keywords == ["Universal Studios"]
    assert firestore.documents[("productions", production.id)]["ignore_keywords"] == [
        "Universal Studios"
    ]


def test_cloud_production_icon_repository_uses_private_versioned_objects() -> None:
    storage = FakeStorageClient()
    repository = CloudStorageProductionIconRepository(
        project="test-project",
        bucket_name="asset-bucket",
        client=storage,
    )

    repository.store(
        "production-1",
        "version-1",
        "image/png",
        b"\x89PNG\r\n\x1a\nicon",
    )

    object_name = "rightsrader-production-icons/production-1/version-1"
    assert storage.uploads[object_name] == (b"\x89PNG\r\n\x1a\nicon", "image/png")
    assert repository.get("production-1", "version-1") == b"\x89PNG\r\n\x1a\nicon"

    repository.delete("production-1", "version-1")

    assert object_name not in storage.uploads
