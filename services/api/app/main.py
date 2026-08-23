from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import Settings
from app.dependencies import build_services
from app.routes import cases_router, productions_router


def create_app(settings: Settings | None = None) -> FastAPI:
    app_settings = settings or Settings()
    app_services = build_services(app_settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        del app
        yield
        close = getattr(app_services.agent_service, "aclose", None)
        if close is not None:
            await close()

    app = FastAPI(title="RightsRadar API", version="0.1.0", lifespan=lifespan)
    app.state.services = app_services
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
        allow_methods=["GET", "POST", "PATCH"],
        allow_headers=["Content-Type"],
    )
    app.include_router(cases_router)
    app.include_router(productions_router)

    @app.get("/health", tags=["health"])
    def health() -> dict[str, str]:
        return {"status": "ok", "mode": app_settings.mode.value}

    return app


app = create_app()
