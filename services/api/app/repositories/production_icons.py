from typing import Any, Protocol


class ProductionIconNotFound(Exception):
    pass


class ProductionIconRepository(Protocol):
    def store(
        self,
        production_id: str,
        version: str,
        content_type: str,
        content: bytes,
    ) -> None: ...

    def get(self, production_id: str, version: str) -> bytes: ...

    def delete(self, production_id: str, version: str) -> None: ...


class InMemoryProductionIconRepository:
    def __init__(self) -> None:
        self._icons: dict[tuple[str, str], bytes] = {}

    def store(
        self,
        production_id: str,
        version: str,
        content_type: str,
        content: bytes,
    ) -> None:
        del content_type
        self._icons[(production_id, version)] = content

    def get(self, production_id: str, version: str) -> bytes:
        try:
            return self._icons[(production_id, version)]
        except KeyError as error:
            raise ProductionIconNotFound(production_id) from error

    def delete(self, production_id: str, version: str) -> None:
        self._icons.pop((production_id, version), None)


class CloudStorageProductionIconRepository:
    def __init__(
        self,
        project: str,
        bucket_name: str,
        *,
        client: Any | None = None,
    ) -> None:
        if client is None:
            from google.cloud import storage

            client = storage.Client(project=project)
        self._bucket = client.bucket(bucket_name)

    @staticmethod
    def _object_name(production_id: str, version: str) -> str:
        return f"rightsrader-production-icons/{production_id}/{version}"

    def store(
        self,
        production_id: str,
        version: str,
        content_type: str,
        content: bytes,
    ) -> None:
        self._bucket.blob(self._object_name(production_id, version)).upload_from_string(
            content,
            content_type=content_type,
            if_generation_match=0,
        )

    def get(self, production_id: str, version: str) -> bytes:
        from google.api_core.exceptions import NotFound

        try:
            return bytes(
                self._bucket.blob(
                    self._object_name(production_id, version)
                ).download_as_bytes()
            )
        except NotFound as error:
            raise ProductionIconNotFound(production_id) from error

    def delete(self, production_id: str, version: str) -> None:
        from google.api_core.exceptions import NotFound

        try:
            self._bucket.blob(self._object_name(production_id, version)).delete()
        except NotFound:
            return
