import pytest


@pytest.fixture(autouse=True)
def use_mock_mode_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RIGHTSRADAR_MODE", "mock")
