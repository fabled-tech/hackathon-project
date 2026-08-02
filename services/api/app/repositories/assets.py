from datetime import UTC, datetime
from typing import Any, Protocol, cast
from uuid import uuid4

from app.models import Asset, AssetUpload


class AssetRepository(Protocol):
    def store(self, case_id: str, upload: AssetUpload) -> Asset: ...

    def delete(self, asset: Asset) -> None: ...

    def list_for_case(self, case_id: str) -> list[Asset]: ...

    def get_content(self, asset_id: str) -> bytes: ...


class InMemoryAssetRepository:
    def __init__(self) -> None:
        self._assets: dict[str, Asset] = {}
        self._content: dict[str, bytes] = {}

    def store(self, case_id: str, upload: AssetUpload) -> Asset:
        asset_id = str(uuid4())
        asset = Asset(
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

    def delete(self, asset: Asset) -> None:
        self._assets.pop(asset.id, None)
        self._content.pop(asset.id, None)

    def list_for_case(self, case_id: str) -> list[Asset]:
        return [
            asset.model_copy(deep=True)
            for asset in self._assets.values()
            if asset.case_id == case_id
        ]

    def get_content(self, asset_id: str) -> bytes:
        return self._content[asset_id]


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

    def store(self, case_id: str, upload: AssetUpload) -> Asset:
        asset_id = str(uuid4())
        storage_reference = f"cases/{case_id}/assets/{asset_id}"
        blob = self._bucket.blob(storage_reference)
        blob.upload_from_string(upload.content, content_type=upload.content_type)
        asset = Asset(
            id=asset_id,
            case_id=case_id,
            filename=upload.filename,
            content_type=upload.content_type,
            byte_size=len(upload.content),
            storage_reference=storage_reference,
            created_at=datetime.now(UTC),
        )
        try:
            self._case_collection.document(case_id).collection("assets").document(asset.id).set(
                asset.model_dump(mode="json")
            )
        except Exception:
            blob.delete()
            raise
        return asset.model_copy(deep=True)

    def delete(self, asset: Asset) -> None:
        self._bucket.blob(asset.storage_reference).delete()
        self._case_collection.document(asset.case_id).collection("assets").document(
            asset.id
        ).delete()

    def list_for_case(self, case_id: str) -> list[Asset]:
        return [
            Asset.model_validate(document)
            for snapshot in (
                self._case_collection.document(case_id)
                .collection("assets")
                .order_by("created_at", direction="DESCENDING")
                .stream()
            )
            if isinstance((document := snapshot.to_dict()), dict)
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
        asset = Asset.model_validate(document)
        return cast(bytes, self._bucket.blob(asset.storage_reference).download_as_bytes())
