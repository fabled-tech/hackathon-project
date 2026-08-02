from datetime import UTC, datetime
from typing import Protocol, cast
from uuid import uuid4

from app.models import Asset, AssetUpload


class AssetRepository(Protocol):
    def store(self, case_id: str, upload: AssetUpload) -> Asset: ...

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

    def list_for_case(self, case_id: str) -> list[Asset]:
        return [
            asset.model_copy(deep=True)
            for asset in self._assets.values()
            if asset.case_id == case_id
        ]

    def get_content(self, asset_id: str) -> bytes:
        return self._content[asset_id]


class CloudStorageAssetRepository:
    def __init__(self, bucket_name: str) -> None:
        from google.cloud.storage import Client

        self._bucket = Client().bucket(bucket_name)
        self._assets: dict[str, Asset] = {}

    def store(self, case_id: str, upload: AssetUpload) -> Asset:
        asset_id = str(uuid4())
        blob = self._bucket.blob(f"assets/{asset_id}")
        blob.upload_from_string(upload.content, content_type=upload.content_type)
        asset = Asset(
            id=asset_id,
            case_id=case_id,
            filename=upload.filename,
            content_type=upload.content_type,
            byte_size=len(upload.content),
            storage_reference=f"gs://{self._bucket.name}/{blob.name}",
            created_at=datetime.now(UTC),
        )
        self._assets[asset_id] = asset
        return asset.model_copy(deep=True)

    def list_for_case(self, case_id: str) -> list[Asset]:
        return [
            asset.model_copy(deep=True)
            for asset in self._assets.values()
            if asset.case_id == case_id
        ]

    def get_content(self, asset_id: str) -> bytes:
        asset = self._assets[asset_id]
        blob_name = asset.storage_reference.removeprefix(f"gs://{self._bucket.name}/")
        return cast(bytes, self._bucket.blob(blob_name).download_as_bytes())
