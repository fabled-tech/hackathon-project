import builtins
from collections.abc import Mapping
from typing import Any, Protocol

from app.models import (
    AgentRun,
    Case,
    Production,
    ProductionStatus,
    ProductionSummary,
    ReviewerStatus,
)


class ProductionRepositoryNotFound(Exception):
    pass


class ProductionRepository(Protocol):
    def create(self, production: Production) -> Production: ...

    def get(self, production_id: str) -> Production: ...

    def list(self) -> "builtins.list[ProductionSummary]": ...

    def update(
        self,
        production_id: str,
        *,
        title: str | None = None,
        studio: str | None = None,
        status: ProductionStatus | None = None,
        icon: str | None = None,
    ) -> Production: ...

    def delete(self, production_id: str) -> None: ...

    def summarize(
        self, production: Production, cases: "builtins.list[Case]"
    ) -> ProductionSummary: ...


def summarize_production(production: Production, cases: list[Case]) -> ProductionSummary:
    production_cases = [case for case in cases if case.production_id == production.id]
    open_statuses = {ReviewerStatus.PENDING, ReviewerStatus.ESCALATED}
    open_findings = [
        finding
        for case in production_cases
        for finding in case.findings
        if finding.reviewer_status in open_statuses
    ]
    escalated = [
        finding
        for case in production_cases
        for finding in case.findings
        if finding.reviewer_status is ReviewerStatus.ESCALATED
    ]
    return ProductionSummary(
        **production.model_dump(
            include={"id", "title", "studio", "status", "icon", "created_at"}
        ),
        case_count=len(production_cases),
        open_finding_count=len(open_findings),
        escalated_finding_count=len(escalated),
    )


class InMemoryProductionRepository:
    def __init__(self) -> None:
        self._productions: dict[str, Production] = {}

    def create(self, production: Production) -> Production:
        self._productions[production.id] = production.model_copy(deep=True)
        return production

    def get(self, production_id: str) -> Production:
        production = self._productions.get(production_id)
        if production is None:
            raise ProductionRepositoryNotFound(production_id)
        return production.model_copy(deep=True)

    def list(self) -> list[ProductionSummary]:
        return [
            ProductionSummary(**production.model_dump())
            for production in sorted(
                self._productions.values(), key=lambda item: item.created_at, reverse=True
            )
        ]

    def update(
        self,
        production_id: str,
        *,
        title: str | None = None,
        studio: str | None = None,
        status: ProductionStatus | None = None,
        icon: str | None = None,
    ) -> Production:
        production = self._productions.get(production_id)
        if production is None:
            raise ProductionRepositoryNotFound(production_id)
        if title is not None:
            production.title = title
        if studio is not None:
            production.studio = studio
        if status is not None:
            production.status = status
        if icon is not None:
            production.icon = icon
        return production.model_copy(deep=True)

    def delete(self, production_id: str) -> None:
        if production_id not in self._productions:
            raise ProductionRepositoryNotFound(production_id)
        del self._productions[production_id]

    def summarize(
        self, production: Production, cases: "builtins.list[Case]"
    ) -> ProductionSummary:
        return summarize_production(production, cases)


class AgentRunRepository(Protocol):
    def create(self, run: AgentRun) -> AgentRun: ...

    def get(self, run_id: str) -> AgentRun: ...

    def list_for_production(self, production_id: str, limit: int) -> list[AgentRun]: ...

    def update(self, run: AgentRun) -> AgentRun: ...


class AgentRunNotFound(Exception):
    pass


class InMemoryAgentRunRepository:
    def __init__(self) -> None:
        self._runs: dict[str, AgentRun] = {}

    def create(self, run: AgentRun) -> AgentRun:
        self._runs[run.id] = run.model_copy(deep=True)
        return run

    def get(self, run_id: str) -> AgentRun:
        run = self._runs.get(run_id)
        if run is None:
            raise AgentRunNotFound(run_id)
        return run.model_copy(deep=True)

    def list_for_production(self, production_id: str, limit: int) -> list[AgentRun]:
        runs = [run for run in self._runs.values() if run.production_id == production_id]
        runs.sort(key=lambda run: run.created_at, reverse=True)
        return [run.model_copy(deep=True) for run in runs[:limit]]

    def update(self, run: AgentRun) -> AgentRun:
        if run.id not in self._runs:
            raise AgentRunNotFound(run.id)
        self._runs[run.id] = run.model_copy(deep=True)
        return run


class FirestoreProductionRepository:
    """Cloud production repository loaded only when a real repository is selected."""

    def __init__(self, project: str, collection_name: str, *, client: Any | None = None) -> None:
        if client is None:
            from google.cloud import firestore

            client = firestore.Client(project=project)
        self._collection = client.collection(collection_name)

    def create(self, production: Production) -> Production:
        self._collection.document(production.id).set(production.model_dump(mode="json"))
        return production

    def get(self, production_id: str) -> Production:
        snapshot = self._collection.document(production_id).get()
        if not snapshot.exists:
            raise ProductionRepositoryNotFound(production_id)
        document = snapshot.to_dict()
        if not isinstance(document, Mapping):
            raise ProductionRepositoryNotFound(production_id)
        return Production.model_validate(document)

    def list(self) -> "builtins.list[ProductionSummary]":
        snapshots = self._collection.order_by("created_at", direction="DESCENDING").stream()
        return [
            ProductionSummary.model_validate(document)
            for snapshot in snapshots
            if isinstance((document := snapshot.to_dict()), Mapping)
        ]

    def update(
        self,
        production_id: str,
        *,
        title: str | None = None,
        studio: str | None = None,
        status: ProductionStatus | None = None,
        icon: str | None = None,
    ) -> Production:
        document = self._collection.document(production_id)
        if not document.get().exists:
            raise ProductionRepositoryNotFound(production_id)
        updates: dict[str, Any] = {}
        if title is not None:
            updates["title"] = title
        if studio is not None:
            updates["studio"] = studio
        if status is not None:
            updates["status"] = status.value
        if icon is not None:
            updates["icon"] = icon
        if updates:
            document.update(updates)
        return self.get(production_id)

    def delete(self, production_id: str) -> None:
        document = self._collection.document(production_id)
        if not document.get().exists:
            raise ProductionRepositoryNotFound(production_id)
        document.delete()

    def summarize(
        self, production: Production, cases: "builtins.list[Case]"
    ) -> ProductionSummary:
        return summarize_production(production, cases)


class FirestoreAgentRunRepository:
    """Cloud agent-run repository loaded only when a real repository is selected."""

    def __init__(self, project: str, collection_name: str, *, client: Any | None = None) -> None:
        if client is None:
            from google.cloud import firestore

            client = firestore.Client(project=project)
        self._collection = client.collection(collection_name)

    def create(self, run: AgentRun) -> AgentRun:
        self._collection.document(run.id).set(run.model_dump(mode="json"))
        return run

    def get(self, run_id: str) -> AgentRun:
        snapshot = self._collection.document(run_id).get()
        if not snapshot.exists:
            raise AgentRunNotFound(run_id)
        document = snapshot.to_dict()
        if not isinstance(document, Mapping):
            raise AgentRunNotFound(run_id)
        return AgentRun.model_validate(document)

    def list_for_production(self, production_id: str, limit: int) -> "builtins.list[AgentRun]":
        snapshots = (
            self._collection.where("production_id", "==", production_id)
            .order_by("created_at", direction="DESCENDING")
            .limit(limit)
            .stream()
        )
        return [
            AgentRun.model_validate(document)
            for snapshot in snapshots
            if isinstance((document := snapshot.to_dict()), Mapping)
        ]

    def update(self, run: AgentRun) -> AgentRun:
        document = self._collection.document(run.id)
        if not document.get().exists:
            raise AgentRunNotFound(run.id)
        document.set(run.model_dump(mode="json"))
        return run
