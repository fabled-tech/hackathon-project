from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime
from uuid import UUID

from pytest import CaptureFixture

from app.config import EnvironmentMode, IntegrationMode, Settings
from app.dependencies import ApplicationServices
from app.models import AssetUpload, Case, StoredAsset
from app.smoke_real import main


class FakeCaseRepository:
    def __init__(self, events: list[str] | None = None) -> None:
        self.cases: dict[str, Case] = {}
        self.calls: list[str] = []
        self.created_ids: list[str] = []
        self._events = events

    def create(self, case: Case) -> Case:
        self.calls.append("create_case")
        if self._events is not None:
            self._events.append("create_case")
        self.created_ids.append(case.id)
        self.cases[case.id] = case.model_copy(deep=True)
        return case

    def get(self, case_id: str) -> Case:
        self.calls.append("get_case")
        if self._events is not None:
            self._events.append("get_case")
        return self.cases[case_id].model_copy(deep=True)

    def increment_asset_count(self, case_id: str) -> None:
        self.calls.append("increment_asset_count")
        if self._events is not None:
            self._events.append("increment_asset_count")
        self.cases[case_id].asset_count += 1

    def delete(self, case_id: str) -> None:
        self.calls.append("delete_case")
        if self._events is not None:
            self._events.append("delete_case")
        del self.cases[case_id]


class FakeAssetRepository:
    def __init__(
        self,
        events: list[str] | None = None,
        *,
        content_reader: Callable[[str], bytes] | None = None,
    ) -> None:
        self.assets: dict[str, StoredAsset] = {}
        self.content: dict[str, bytes] = {}
        self.calls: list[str] = []
        self.uploads: list[AssetUpload] = []
        self._content_reader = content_reader
        self._events = events

    def store(self, case_id: str, upload: AssetUpload) -> StoredAsset:
        self.calls.append("store_asset")
        if self._events is not None:
            self._events.append("store_asset")
        self.uploads.append(upload)
        asset = StoredAsset(
            id="smoke-asset",
            case_id=case_id,
            filename=upload.filename,
            content_type=upload.content_type,
            byte_size=len(upload.content),
            storage_reference="fake://smoke-asset",
            created_at=datetime.now(UTC),
        )
        self.assets[asset.id] = asset
        self.content[asset.id] = upload.content
        return asset

    def list_for_case(self, case_id: str) -> list[StoredAsset]:
        self.calls.append("list_assets")
        if self._events is not None:
            self._events.append("list_assets")
        return [asset for asset in self.assets.values() if asset.case_id == case_id]

    def get_content(self, asset_id: str) -> bytes:
        self.calls.append("get_content")
        if self._events is not None:
            self._events.append("get_content")
        if self._content_reader is not None:
            return self._content_reader(asset_id)
        return self.content[asset_id]

    def delete(self, asset: StoredAsset) -> None:
        self.calls.append("delete_asset")
        if self._events is not None:
            self._events.append("delete_asset")
        del self.assets[asset.id]
        del self.content[asset.id]


class FailingDeleteAssetRepository(FakeAssetRepository):
    def delete(self, asset: StoredAsset) -> None:
        self.calls.append("delete_asset")
        if self._events is not None:
            self._events.append("delete_asset")
        raise RuntimeError("asset cleanup failed")


class UnusedAgentService:
    def analyze(self, _case_id: str, _script_text: str) -> list[object]:
        raise AssertionError("The repository smoke must not invoke the agent service")


def real_repository_settings() -> Settings:
    return Settings(
        mode=EnvironmentMode.HYBRID,
        repository_mode=IntegrationMode.REAL,
        enable_real_smoke=True,
    )


def fake_services(
    case_repository: FakeCaseRepository, asset_repository: FakeAssetRepository
) -> ApplicationServices:
    return ApplicationServices(
        case_repository=case_repository,  # type: ignore[arg-type]
        asset_repository=asset_repository,  # type: ignore[arg-type]
        agent_service=UnusedAgentService(),  # type: ignore[arg-type]
    )


def test_real_smoke_exercises_disposable_repositories_without_agents(
    capsys: CaptureFixture[str],
) -> None:
    case_repository = FakeCaseRepository()
    asset_repository = FakeAssetRepository()

    result = main(real_repository_settings(), fake_services(case_repository, asset_repository))

    assert result == 0
    assert case_repository.calls == [
        "create_case",
        "increment_asset_count",
        "get_case",
        "delete_case",
    ]
    assert asset_repository.calls == ["store_asset", "list_assets", "get_content", "delete_asset"]
    assert case_repository.cases == {}
    assert asset_repository.assets == {}
    assert asset_repository.content == {}
    assert len(case_repository.created_ids) == 1
    UUID(case_repository.created_ids[0])
    assert "completed" in capsys.readouterr().out


def test_real_smoke_stores_and_reads_original_short_text_asset() -> None:
    case_repository = FakeCaseRepository()
    asset_repository = FakeAssetRepository()

    assert main(real_repository_settings(), fake_services(case_repository, asset_repository)) == 0
    assert asset_repository.content == {}
    assert asset_repository.calls[:3] == ["store_asset", "list_assets", "get_content"]
    assert asset_repository.uploads == [
        AssetUpload(filename="smoke-test.txt", content_type="text/plain", content=b"smoke test")
    ]


def test_real_smoke_cleans_assets_then_case_after_verification_failure(
    capsys: CaptureFixture[str],
) -> None:
    events: list[str] = []
    case_repository = FakeCaseRepository(events)
    asset_repository = FakeAssetRepository(events, content_reader=lambda _asset_id: b"unexpected")

    result = main(real_repository_settings(), fake_services(case_repository, asset_repository))

    assert result == 1
    assert asset_repository.calls[-1] == "delete_asset"
    assert case_repository.calls[-1] == "delete_case"
    assert case_repository.cases == {}
    assert asset_repository.assets == {}
    assert events[-2:] == ["delete_asset", "delete_case"]
    assert "failed" in capsys.readouterr().err


def test_real_smoke_reports_cleanup_error_without_hiding_verification_failure(
    capsys: CaptureFixture[str],
) -> None:
    events: list[str] = []
    case_repository = FakeCaseRepository(events)
    asset_repository = FailingDeleteAssetRepository(
        events, content_reader=lambda _asset_id: b"unexpected"
    )

    assert main(real_repository_settings(), fake_services(case_repository, asset_repository)) == 1

    assert events[-2:] == ["delete_asset", "delete_case"]
    output = capsys.readouterr().err
    assert "Smoke asset content did not match the stored text" in output
    assert "cleanup failed: asset cleanup failed" in output


def test_real_smoke_skips_without_opt_in_or_real_repositories() -> None:
    settings_without_opt_in = Settings(
        mode=EnvironmentMode.HYBRID,
        repository_mode=IntegrationMode.REAL,
        enable_real_smoke=False,
    )
    settings_without_real_repository = Settings(
        mode=EnvironmentMode.HYBRID,
        repository_mode=IntegrationMode.MOCK,
        enable_real_smoke=True,
    )

    assert main(settings_without_opt_in) == 0
    assert main(settings_without_real_repository) == 0
