from datetime import UTC, datetime
from typing import Any, Protocol, cast
from uuid import uuid4

from app.models import AssetLifecycle, AssetUpload, StoredAsset


class AssetRepository(Protocol):
    def store(self, case_id: str, upload: AssetUpload) -> StoredAsset: ...

    def delete(self, asset: StoredAsset) -> None: ...

    def list_for_case(self, case_id: str) -> list[StoredAsset]: ...

    def get_content(self, asset_id: str) -> bytes: ...

    def reconcile_pending(self, limit: int) -> int: ...


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

    def reconcile_pending(self, limit: int) -> int:
        reconciled = 0
        for asset in list(self._assets.values()):
            if reconciled >= limit:
                break
            if asset.lifecycle is AssetLifecycle.READY:
                continue
            self.delete(asset)
            reconciled += 1
        return reconciled


class CloudStorageAssetRepository:
    """Stores private asset bytes in Cloud Storage and metadata in Firestore."""

    def __init__(
        self,
        project: str,
        bucket_name: str,
        case_collection: str,
        *,
        storage_client: Any | None = None,
        firestore_client: Any | None = None,
        not_found_exception: type[Exception] | None = None,
    ) -> None:
        if storage_client is None:
            from google.cloud.storage import Client

            storage_client = Client(project=project)
        if firestore_client is None:
            from google.cloud import firestore

            firestore_client = firestore.Client(project=project)

        self._bucket = storage_client.bucket(bucket_name)
        self._case_collection = firestore_client.collection(case_collection)
        self._firestore_client = firestore_client
        self._not_found_exception = not_found_exception

    def _document(self, asset: StoredAsset) -> Any:
        return self._case_collection.document(asset.case_id).collection("assets").document(asset.id)

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

    def _mark_cleanup_pending(self, asset: StoredAsset) -> None:
        self._document(asset).update({"lifecycle": AssetLifecycle.CLEANUP_PENDING})

    def store(self, case_id: str, upload: AssetUpload) -> StoredAsset:
        asset_id = str(uuid4())
        asset = StoredAsset(
            id=asset_id,
            case_id=case_id,
            filename=upload.filename,
            content_type=upload.content_type,
            byte_size=len(upload.content),
            storage_reference=f"cases/{case_id}/assets/{asset_id}",
            created_at=datetime.now(UTC),
            lifecycle=AssetLifecycle.PENDING,
        )
        document = self._document(asset)
        document.set(asset.model_dump(mode="json"))
        try:
            self._bucket.blob(asset.storage_reference).upload_from_string(
                upload.content, content_type=upload.content_type
            )
            document.update({"lifecycle": AssetLifecycle.READY})
        except Exception as primary_error:
            try:
                self.delete(asset)
            except Exception as cleanup_error:
                try:
                    self._mark_cleanup_pending(asset)
                except Exception:
                    pass
                raise primary_error from cleanup_error
            raise
        return asset.model_copy(update={"lifecycle": AssetLifecycle.READY}, deep=True)

    def delete(self, asset: StoredAsset) -> None:
        try:
            self._delete_storage_object(asset)
        except Exception as object_error:
            try:
                self._mark_cleanup_pending(asset)
            except Exception as state_error:
                raise object_error from state_error
            raise

        try:
            self._document(asset).delete()
        except Exception as metadata_error:
            try:
                self._mark_cleanup_pending(asset)
            except Exception as state_error:
                raise metadata_error from state_error
            raise

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

    def reconcile_pending(self, limit: int) -> int:
        if limit < 1:
            return 0
        snapshots = (
            self._firestore_client.collection_group("assets")
            .where("lifecycle", "in", [
                AssetLifecycle.PENDING,
                AssetLifecycle.CLEANUP_PENDING,
            ])
            .limit(limit)
            .stream()
        )
        reconciled = 0
        for snapshot in snapshots:
            document = snapshot.to_dict()
            if not isinstance(document, dict):
                continue
            asset = StoredAsset.model_validate(document)
            try:
                self.delete(asset)
            except Exception:
                continue
            reconciled += 1
        return reconciled
