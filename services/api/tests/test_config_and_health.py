from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def test_allowed_origins_parses_comma_separated_env(monkeypatch) -> None:
    monkeypatch.setenv(
        "RIGHTSRADAR_ALLOWED_ORIGINS",
        "https://a.example, https://b.example",
    )
    settings = Settings(_env_file=None)
    assert settings.allowed_origins == ["https://a.example", "https://b.example"]


def test_allowed_origins_default_to_localhost() -> None:
    settings = Settings(_env_file=None)
    assert settings.allowed_origins == [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]


def test_health_reports_mode_and_adjudicator() -> None:
    client = TestClient(create_app(Settings(_env_file=None)))
    body = client.get("/health").json()
    assert body == {"status": "ok", "mode": "mock", "adjudicator": "fixture"}


def test_cors_allows_configured_origin() -> None:
    settings = Settings(_env_file=None, allowed_origins=["https://desk.example"])
    client = TestClient(create_app(settings))
    response = client.options(
        "/api/productions",
        headers={
            "Origin": "https://desk.example",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert response.headers.get("access-control-allow-origin") == "https://desk.example"
