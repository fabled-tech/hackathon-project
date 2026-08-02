from __future__ import annotations

from pytest import CaptureFixture

from app.config import EnvironmentMode, IntegrationMode, Settings
from app.reconcile_assets import main


class FakeAssetRepository:
    def __init__(self, *, reconciled: int = 2, failed: int = 0) -> None:
        self.limits: list[int] = []
        self.reconciled = reconciled
        self.failed = failed

    def reconcile_pending(self, limit: int) -> object:
        self.limits.append(limit)
        return type("Report", (), {"reconciled": self.reconciled, "failed": self.failed})()


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


def test_reconciliation_command_reports_sanitized_partial_failures(
    capsys: CaptureFixture[str],
) -> None:
    repository = FakeAssetRepository(reconciled=1, failed=2)
    settings = Settings(
        mode=EnvironmentMode.HYBRID,
        repository_mode=IntegrationMode.REAL,
        enable_reconciliation=True,
    )

    assert main(settings=settings, asset_repository=repository) == 1
    assert repository.limits == [100]
    captured = capsys.readouterr()
    assert captured.out == "Reconciled 1 private asset record(s).\n"
    assert captured.err == "Private asset reconciliation had 2 failed record(s).\n"


def test_reconciliation_command_reports_sanitized_total_failures(
    capsys: CaptureFixture[str],
) -> None:
    repository = FakeAssetRepository(reconciled=0, failed=3)
    settings = Settings(
        mode=EnvironmentMode.HYBRID,
        repository_mode=IntegrationMode.REAL,
        enable_reconciliation=True,
    )

    assert main(settings=settings, asset_repository=repository) == 1
    captured = capsys.readouterr()
    assert captured.out == "Reconciled 0 private asset record(s).\n"
    assert captured.err == "Private asset reconciliation had 3 failed record(s).\n"
