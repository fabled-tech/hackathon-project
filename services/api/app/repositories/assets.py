from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class AssetReference:
    asset_id: str
    content_type: str
    content: bytes


class AssetRepository(Protocol):
    def store(self, asset: AssetReference) -> str: ...


class InMemoryAssetRepository:
    def __init__(self) -> None:
        self._assets: dict[str, AssetReference] = {}

    def store(self, asset: AssetReference) -> str:
        self._assets[asset.asset_id] = asset
        return asset.asset_id


class CloudStorageAssetRepository:
    def __init__(self, bucket_name: str) -> None:
        from google.cloud.storage import Client

        self._bucket = Client().bucket(bucket_name)

    def store(self, asset: AssetReference) -> str:
        blob = self._bucket.blob(f"assets/{asset.asset_id}")
        blob.upload_from_string(asset.content, content_type=asset.content_type)
        return f"gs://{self._bucket.name}/{blob.name}"
