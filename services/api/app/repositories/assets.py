from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol, TypeVar, cast
from uuid import uuid4

from app.models import AssetLifecycle, AssetUpload, StoredAsset

_LEASE_DURATION = timedelta(minutes=5)
Result = TypeVar("Result")


class AssetWriteLeaseLost(RuntimeError):
    pass


@dataclass(frozen=True)
class ReconciliationResult:
    reconciled: int
    failed: int


class AssetRepository(Protocol):
    def store(self, case_id: str, upload: AssetUpload) -> StoredAsset: ...

    def delete(self, asset: StoredAsset) -> None: ...

    def list_for_case(self, case_id: str) -> list[StoredAsset]: ...

    def get_content(self, asset_id: str) -> bytes: ...

    def reconcile_pending(self, limit: int) -> ReconciliationResult: ...


class InMemoryAssetRepository:
    def __init__(self) -> None:
        self._assets: dict[str, StoredAsset] = {}
        self._content: dict[str, bytes] = {}

    def store(self, case_id: str, upload: AssetUpload) -> StoredAsset:
        asset_id = str(uuid4())
        asset = StoredAsset(
            id=asset_id,
            case_id=case_id,
            filename=upload.filename,
            content_type=upload.content_type,
            byte_size=len(upload.content),
            storage_reference=f"memory://assets/{asset_id}",
            created_at=datetime.now(UTC),
        )
        self._assets[asset_id] = asset
        self._content[asset_id] = upload.content
        return asset.model_copy(deep=True)

    def delete(self, asset: StoredAsset) -> None:
        self._assets.pop(asset.id, None)
        self._content.pop(asset.id, None)

    def list_for_case(self, case_id: str) -> list[StoredAsset]:
        return [
            asset.model_copy(deep=True)
            for asset in self._assets.values()
            if asset.case_id == case_id and asset.lifecycle is AssetLifecycle.READY
        ]

    def get_content(self, asset_id: str) -> bytes:
        asset = self._assets.get(asset_id)
        if asset is None or asset.lifecycle is not AssetLifecycle.READY:
            raise KeyError(asset_id)
        return self._content[asset_id]

    def reconcile_pending(self, limit: int) -> ReconciliationResult:
        reconciled = 0
        for asset in list(self._assets.values()):
            if reconciled >= limit:
                break
            if asset.lifecycle is AssetLifecycle.READY:
                continue
            self.delete(asset)
            reconciled += 1
        return ReconciliationResult(reconciled=reconciled, failed=0)


class CloudStorageAssetRepository:
    """Stores private asset bytes in Cloud Storage and fenced metadata in Firestore."""

    def __init__(
        self,
        project: str,
        bucket_name: str,
        case_collection: str,
        *,
        storage_client: Any | None = None,
        firestore_client: Any | None = None,
        not_found_exception: type[Exception] | None = None,
        clock: Callable[[], datetime] | None = None,
        before_upload: Callable[[], None] | None = None,
    ) -> None:
        supplied_firestore_client = firestore_client is not None
        if storage_client is None:
            from google.cloud.storage import Client

            storage_client = Client(project=project)
        if firestore_client is None:
            from google.cloud import firestore

            firestore_client = firestore.Client(project=project)

        self._bucket = storage_client.bucket(bucket_name)
        self._case_collection = firestore_client.collection(case_collection)
        lifecycle_collection = f"{case_collection}_asset_lifecycle"
        self._lifecycle_collection = firestore_client.collection(lifecycle_collection)
        self._firestore_client = firestore_client
        self._not_found_exception = not_found_exception
        self._clock = clock or (lambda: datetime.now(UTC))
        self._before_upload = before_upload
        if supplied_firestore_client:
            self._transactional: Callable[[Callable[[Any], Result]], Callable[[Any], Result]] = (
                lambda operation: operation
            )
        else:
            from google.cloud import firestore

            self._transactional = firestore.transactional

    def _document(self, asset: StoredAsset) -> Any:
        return self._case_collection.document(asset.case_id).collection("assets").document(asset.id)

    def _lifecycle_document(self, asset: StoredAsset) -> Any:
        return self._lifecycle_collection.document(asset.id)

    def _run_transaction(self, operation: Callable[[Any], Result]) -> Result:
        transaction = self._firestore_client.transaction()
        return self._transactional(operation)(transaction)

    def _read_asset(self, document: Any, transaction: Any) -> StoredAsset | None:
        snapshot = document.get(transaction=transaction)
        if not snapshot.exists:
            return None
        values = snapshot.to_dict()
        return StoredAsset.model_validate(values) if isinstance(values, dict) else None

    def _is_not_found(self, error: Exception) -> bool:
        if self._not_found_exception is not None:
            return isinstance(error, self._not_found_exception)
        try:
            from google.api_core.exceptions import NotFound
        except ImportError:
            return False
        return isinstance(error, NotFound)

    def _delete_storage_object(self, asset: StoredAsset) -> None:
        try:
            self._bucket.blob(asset.storage_reference).delete()
        except Exception as error:
            if not self._is_not_found(error):
                raise

    def _writer_owns_lease(self, asset: StoredAsset) -> bool:
        def check(transaction: Any) -> bool:
            current = self._read_asset(self._document(asset), transaction)
            return bool(
                current
                and current.lifecycle is AssetLifecycle.PENDING
                and current.lease_token == asset.lease_token
                and current.lease_expires_at is not None
                and current.lease_expires_at > self._clock()
            )

        return self._run_transaction(check)

    def _promote_ready(self, asset: StoredAsset) -> bool:
        def promote(transaction: Any) -> bool:
            document = self._document(asset)
            current = self._read_asset(document, transaction)
            if not current or not self._is_writer_current(current, asset):
                return False
            transaction.update(
                document,
                {
                    "lifecycle": AssetLifecycle.READY,
                    "lease_token": None,
                    "lease_expires_at": None,
                },
            )
            transaction.delete(self._lifecycle_document(asset))
            return True

        return self._run_transaction(promote)

    def _is_writer_current(self, current: StoredAsset, asset: StoredAsset) -> bool:
        return bool(
            current.lifecycle is AssetLifecycle.PENDING
            and current.lease_token == asset.lease_token
            and current.lease_expires_at is not None
            and current.lease_expires_at > self._clock()
        )

    def _claim_cleanup(
        self,
        asset: StoredAsset,
        *,
        reconcile: bool,
        writer_token: str | None = None,
        lifecycle_document: Any | None = None,
    ) -> StoredAsset | None:
        claim_token = str(uuid4())

        def claim(transaction: Any) -> StoredAsset | None:
            document = self._document(asset)
            current = self._read_asset(document, transaction)
            selected_lifecycle_document = lifecycle_document or self._lifecycle_document(asset)
            if current is None:
                transaction.delete(selected_lifecycle_document)
                return None
            if current.lifecycle is AssetLifecycle.READY:
                if reconcile:
                    transaction.delete(selected_lifecycle_document)
                    return None
            elif current.lifecycle is AssetLifecycle.PENDING:
                if (
                    current.lease_expires_at is not None
                    and current.lease_expires_at > self._clock()
                    and current.lease_token != writer_token
                ):
                    return None
            elif current.lifecycle is not AssetLifecycle.CLEANUP_PENDING:
                return None

            claimed = current.model_copy(
                update={
                    "lifecycle": AssetLifecycle.CLEANUP_PENDING,
                    "lease_token": claim_token,
                    "lease_expires_at": self._clock(),
                }
            )
            values = {
                "lifecycle": claimed.lifecycle,
                "lease_token": claimed.lease_token,
                "lease_expires_at": claimed.lease_expires_at,
            }
            transaction.update(document, values)
            if current.lifecycle is AssetLifecycle.READY:
                transaction.set(selected_lifecycle_document, claimed.model_dump(mode="json"))
            else:
                transaction.update(selected_lifecycle_document, values)
            return claimed

        return self._run_transaction(claim)

    def _cleanup_claim_is_current(self, asset: StoredAsset) -> bool:
        def check(transaction: Any) -> bool:
            current = self._read_asset(self._document(asset), transaction)
            return bool(
                current
                and current.lifecycle is AssetLifecycle.CLEANUP_PENDING
                and current.lease_token == asset.lease_token
            )

        return self._run_transaction(check)

    def _remove_claimed_asset(self, asset: StoredAsset) -> None:
        if not self._cleanup_claim_is_current(asset):
            raise AssetWriteLeaseLost("Asset cleanup lease was lost")
        self._delete_storage_object(asset)

        def remove(transaction: Any) -> None:
            current = self._read_asset(self._document(asset), transaction)
            if not current or current.lease_token != asset.lease_token:
                raise AssetWriteLeaseLost("Asset cleanup lease was lost")
            transaction.delete(self._document(asset))
            transaction.delete(self._lifecycle_document(asset))

        self._run_transaction(remove)

    def _cleanup_failed_write(self, asset: StoredAsset) -> None:
        claimed = self._claim_cleanup(asset, reconcile=True, writer_token=asset.lease_token)
        if claimed is not None:
            self._remove_claimed_asset(claimed)

    def store(self, case_id: str, upload: AssetUpload) -> StoredAsset:
        asset_id = str(uuid4())
        asset = StoredAsset(
            id=asset_id,
            case_id=case_id,
            filename=upload.filename,
            content_type=upload.content_type,
            byte_size=len(upload.content),
            storage_reference=f"cases/{case_id}/assets/{asset_id}",
            created_at=self._clock(),
            lifecycle=AssetLifecycle.PENDING,
            lease_token=str(uuid4()),
            lease_expires_at=self._clock() + _LEASE_DURATION,
        )
        document = self._document(asset)
        lifecycle_document = self._lifecycle_document(asset)
        document.set(asset.model_dump(mode="json"))
        try:
            lifecycle_document.set(asset.model_dump(mode="json"))
        except Exception:
            document.delete()
            raise
        try:
            if self._before_upload is not None:
                self._before_upload()
            if not self._writer_owns_lease(asset):
                raise AssetWriteLeaseLost("Asset write lease was lost")
            self._bucket.blob(asset.storage_reference).upload_from_string(
                upload.content, content_type=upload.content_type
            )
            if not self._promote_ready(asset):
                raise AssetWriteLeaseLost("Asset write lease was lost")
        except Exception as primary_error:
            try:
                self._cleanup_failed_write(asset)
            except Exception as cleanup_error:
                raise primary_error from cleanup_error
            raise
        return asset.model_copy(
            update={
                "lifecycle": AssetLifecycle.READY,
                "lease_token": None,
                "lease_expires_at": None,
            },
            deep=True,
        )

    def delete(self, asset: StoredAsset) -> None:
        claimed = self._claim_cleanup(asset, reconcile=False)
        if claimed is None:
            raise AssetWriteLeaseLost("Asset cleanup transition was not available")
        self._remove_claimed_asset(claimed)

    def list_for_case(self, case_id: str) -> list[StoredAsset]:
        return [
            asset
            for snapshot in (
                self._case_collection.document(case_id)
                .collection("assets")
                .order_by("created_at", direction="DESCENDING")
                .stream()
            )
            if isinstance((document := snapshot.to_dict()), dict)
            and (asset := StoredAsset.model_validate(document)).lifecycle is AssetLifecycle.READY
        ]

    def get_content(self, asset_id: str) -> bytes:
        snapshots = (
            self._firestore_client.collection_group("assets")
            .where("id", "==", asset_id)
            .limit(1)
            .stream()
        )
        snapshot = next(iter(snapshots), None)
        if snapshot is None:
            raise KeyError(asset_id)
        document = snapshot.to_dict()
        if not isinstance(document, dict):
            raise KeyError(asset_id)
        asset = StoredAsset.model_validate(document)
        if asset.lifecycle is not AssetLifecycle.READY:
            raise KeyError(asset_id)
        return cast(bytes, self._bucket.blob(asset.storage_reference).download_as_bytes())

    def reconcile_pending(self, limit: int) -> ReconciliationResult:
        if limit < 1:
            return ReconciliationResult(reconciled=0, failed=0)
        snapshots = (
            self._lifecycle_collection.where(
                "lifecycle", "in", [AssetLifecycle.PENDING, AssetLifecycle.CLEANUP_PENDING]
            )
            .limit(limit)
            .stream()
        )
        reconciled = 0
        failed = 0
        for snapshot in snapshots:
            values = snapshot.to_dict()
            if not isinstance(values, dict):
                continue
            asset = StoredAsset.model_validate(values)
            try:
                lifecycle_document = getattr(snapshot, "reference", self._lifecycle_document(asset))
                claimed = self._claim_cleanup(
                    asset,
                    reconcile=True,
                    lifecycle_document=lifecycle_document,
                )
                if claimed is not None:
                    self._remove_claimed_asset(claimed)
                    reconciled += 1
            except Exception:
                failed += 1
        return ReconciliationResult(reconciled=reconciled, failed=failed)
