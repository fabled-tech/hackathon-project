from __future__ import annotations

from pytest import CaptureFixture

from app.config import EnvironmentMode, IntegrationMode, Settings
from app.reconcile_assets import main


class FakeAssetRepository:
    def __init__(self) -> None:
        self.limits: list[int] = []

    def reconcile_pending(self, limit: int) -> int:
        self.limits.append(limit)
        return 2


def test_reconciliation_command_skips_without_both_explicit_opt_ins(
    capsys: CaptureFixture[str],
) -> None:
    repository = FakeAssetRepository()
    settings = Settings(
        mode=EnvironmentMode.HYBRID,
        repository_mode=IntegrationMode.REAL,
        enable_reconciliation=False,
    )

    assert main(settings=settings, asset_repository=repository) == 0
    assert repository.limits == []
    assert "Skipped" in capsys.readouterr().out


def test_reconciliation_command_skips_for_mock_repositories(
    capsys: CaptureFixture[str],
) -> None:
    repository = FakeAssetRepository()
    settings = Settings(
        mode=EnvironmentMode.HYBRID,
        repository_mode=IntegrationMode.MOCK,
        enable_reconciliation=True,
    )

    assert main(settings=settings, asset_repository=repository) == 0
    assert repository.limits == []
    assert "Skipped" in capsys.readouterr().out


def test_reconciliation_command_calls_only_injected_real_repository(
    capsys: CaptureFixture[str],
) -> None:
    repository = FakeAssetRepository()
    settings = Settings(
        mode=EnvironmentMode.HYBRID,
        repository_mode=IntegrationMode.REAL,
        enable_reconciliation=True,
    )

    assert main(settings=settings, asset_repository=repository) == 0
    assert repository.limits == [100]
    assert capsys.readouterr().out == "Reconciled 2 private asset record(s).\n"
