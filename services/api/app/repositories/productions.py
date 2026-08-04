import copy
from datetime import datetime
from typing import Protocol

from app.models import (
    Production,
    ProductionDetail,
    ProductionFinding,
    ProductionMonitoringSnapshot,
    ProductionMonitoringSource,
    ProductionRun,
    ProductionRunSummary,
    ProductionSource,
    ProductionSourceVersion,
    ProductionSummary,
    ReviewerStatus,
    ReviewEvent,
    ReviewUpdate,
    SourceChangeState,
    StoredProductionRun,
    source_change_state,
    to_public_detail,
    to_public_run,
)


class ProductionRepositoryNotFound(Exception):
    pass


class ProductionSourceNotFound(Exception):
    pass


class ProductionRunNotFound(Exception):
    pass


class ProductionFindingNotFound(Exception):
    pass


class ProductionRevisionConflict(Exception):
    pass


class ProductionRepository(Protocol):
    def create(self, production: Production) -> Production: ...

    def list_recent(self, limit: int) -> list[ProductionSummary]: ...

    def get_detail(self, production_id: str) -> ProductionDetail: ...

    def create_source(
        self, production_id: str, source: ProductionSource, version: ProductionSourceVersion
    ) -> ProductionSource: ...

    def append_source_version(
        self,
        production_id: str,
        source_id: str,
        version: ProductionSourceVersion,
        updated_at: datetime,
    ) -> ProductionSource: ...

    def retire_source(
        self, production_id: str, source_id: str, updated_at: datetime
    ) -> ProductionSource: ...

    def get_monitoring_snapshot(self, production_id: str) -> ProductionMonitoringSnapshot: ...

    def append_complete_run(
        self, snapshot: ProductionMonitoringSnapshot, run: StoredProductionRun
    ) -> ProductionRun: ...

    def list_runs(self, production_id: str, limit: int) -> list[ProductionRunSummary]: ...

    def get_run(self, production_id: str, run_id: str) -> ProductionRun: ...

    def update_finding_status(
        self,
        production_id: str,
        run_id: str,
        finding_id: str,
        reviewer_status: ReviewerStatus,
        updated_at: datetime,
    ) -> ReviewUpdate: ...

    def list_review_events(self, production_id: str, limit: int) -> list[ReviewEvent]: ...


class InMemoryProductionRepository:
    """Deep-copied deterministic production storage for mock mode and unit tests."""

    def __init__(self) -> None:
        self._productions: dict[str, Production] = {}
        self._sources_by_production: dict[str, dict[str, ProductionSource]] = {}
        self._versions_by_source: dict[str, dict[str, ProductionSourceVersion]] = {}
        self._runs_by_production: dict[str, dict[str, StoredProductionRun]] = {}
        self._review_events_by_production: dict[str, dict[str, ReviewEvent]] = {}

    def _production(self, production_id: str) -> Production:
        production = self._productions.get(production_id)
        if production is None:
            raise ProductionRepositoryNotFound(production_id)
        return production

    def _source(self, production_id: str, source_id: str) -> ProductionSource:
        self._production(production_id)
        source = self._sources_by_production[production_id].get(source_id)
        if source is None:
            raise ProductionSourceNotFound(source_id)
        return source

    def _monitoring_sources(self, production_id: str) -> list[ProductionMonitoringSource]:
        sources = self._sources_by_production[production_id]
        monitoring_sources: list[ProductionMonitoringSource] = []
        for source in sources.values():
            change_state = source_change_state(source)
            if not source.active and change_state is not SourceChangeState.RETIRED:
                continue
            version = self._versions_by_source[source.id][source.current_version_id]
            monitoring_sources.append(
                ProductionMonitoringSource(
                    source=source.model_copy(deep=True),
                    version=version.model_copy(deep=True),
                    change_state=change_state,
                )
            )
        return monitoring_sources

    def _latest_run(self, production_id: str) -> StoredProductionRun | None:
        runs = self._runs_by_production[production_id].values()
        return max(runs, key=lambda run: (run.created_at, run.id), default=None)

    def _bump_production(self, production_id: str, updated_at: datetime) -> None:
        production = self._production(production_id)
        self._productions[production_id] = production.model_copy(
            update={"revision": production.revision + 1, "updated_at": updated_at}, deep=True
        )

    def create(self, production: Production) -> Production:
        if production.id in self._productions:
            raise ValueError(f"Production already exists: {production.id}")
        self._productions[production.id] = production.model_copy(deep=True)
        self._sources_by_production[production.id] = {}
        self._runs_by_production[production.id] = {}
        self._review_events_by_production[production.id] = {}
        return production.model_copy(deep=True)

    def list_recent(self, limit: int) -> list[ProductionSummary]:
        productions = sorted(
            self._productions.values(),
            key=lambda production: (production.updated_at, production.id),
            reverse=True,
        )
        summaries: list[ProductionSummary] = []
        for production in productions[:limit]:
            sources = self._monitoring_sources(production.id)
            latest_run = self._latest_run(production.id)
            detail = to_public_detail(production, sources, latest_run=latest_run)
            summaries.append(
                ProductionSummary(
                    id=detail.id,
                    name=detail.name,
                    revision=detail.revision,
                    updated_at=detail.updated_at,
                    script_count=detail.script_count,
                    asset_count=detail.asset_count,
                    sources_needing_recheck=detail.sources_needing_recheck,
                    latest_run_at=detail.latest_run_at,
                )
            )
        return [summary.model_copy(deep=True) for summary in summaries]

    def get_detail(self, production_id: str) -> ProductionDetail:
        production = self._production(production_id)
        detail = to_public_detail(
            production,
            self._monitoring_sources(production_id),
            latest_run=self._latest_run(production_id),
        )
        return detail.model_copy(deep=True)

    def create_source(
        self, production_id: str, source: ProductionSource, version: ProductionSourceVersion
    ) -> ProductionSource:
        self._production(production_id)
        if source.production_id != production_id or version.source_id != source.id:
            raise ValueError("Source and version must belong to the requested production source")
        if source.current_version_id != version.id:
            raise ValueError("Source current version must match the created version")
        if source.id in self._sources_by_production[production_id]:
            raise ValueError(f"Source already exists: {source.id}")

        self._sources_by_production[production_id][source.id] = source.model_copy(deep=True)
        self._versions_by_source[source.id] = {version.id: version.model_copy(deep=True)}
        self._bump_production(production_id, source.updated_at)
        return source.model_copy(deep=True)

    def append_source_version(
        self,
        production_id: str,
        source_id: str,
        version: ProductionSourceVersion,
        updated_at: datetime,
    ) -> ProductionSource:
        source = self._source(production_id, source_id)
        if not source.active:
            raise ValueError("Cannot append a version to a retired source")
        if version.source_id != source.id:
            raise ValueError("Version must belong to the requested source")
        if version.id in self._versions_by_source[source_id]:
            raise ValueError(f"Source version already exists: {version.id}")

        next_source = source.model_copy(
            update={"current_version_id": version.id, "updated_at": updated_at}, deep=True
        )
        next_versions = copy.deepcopy(self._versions_by_source[source_id])
        next_versions[version.id] = version.model_copy(deep=True)
        self._versions_by_source[source_id] = next_versions
        self._sources_by_production[production_id][source_id] = next_source
        self._bump_production(production_id, updated_at)
        return next_source.model_copy(deep=True)

    def retire_source(
        self, production_id: str, source_id: str, updated_at: datetime
    ) -> ProductionSource:
        source = self._source(production_id, source_id)
        if not source.active:
            return source.model_copy(deep=True)
        next_source = source.model_copy(
            update={"active": False, "last_monitored_version_id": None, "updated_at": updated_at},
            deep=True,
        )
        self._sources_by_production[production_id][source_id] = next_source
        self._bump_production(production_id, updated_at)
        return next_source.model_copy(deep=True)

    def get_monitoring_snapshot(self, production_id: str) -> ProductionMonitoringSnapshot:
        production = self._production(production_id)
        return ProductionMonitoringSnapshot(
            production=production.model_copy(deep=True),
            sources=self._monitoring_sources(production_id),
            has_successful_run=bool(self._runs_by_production[production_id]),
        )

    def append_complete_run(
        self, snapshot: ProductionMonitoringSnapshot, run: StoredProductionRun
    ) -> ProductionRun:
        current = self._productions.get(snapshot.production.id)
        if current is None:
            raise ProductionRepositoryNotFound(snapshot.production.id)
        if current.revision != snapshot.production.revision:
            raise ProductionRevisionConflict(snapshot.production.id)
        if snapshot.sources != self._monitoring_sources(snapshot.production.id):
            raise ValueError("Run snapshot must match the current monitoring sources")
        if (
            run.production_id != snapshot.production.id
            or run.production_revision != snapshot.production.revision
        ):
            raise ValueError("Run must belong to the supplied monitoring snapshot")
        if run.id in self._runs_by_production[snapshot.production.id]:
            raise ValueError(f"Run already exists: {run.id}")

        snapshot_sources = {item.source.id: item for item in snapshot.sources}
        if len(snapshot_sources) != len(snapshot.sources):
            raise ValueError("Monitoring snapshot contains duplicate sources")
        run_sources = {item.source_id: item for item in run.source_snapshots}
        if len(run_sources) != len(run.source_snapshots) or set(run_sources) != set(
            snapshot_sources
        ):
            raise ValueError("Run source snapshots must match the monitoring snapshot")
        for source_id, item in snapshot_sources.items():
            source = self._sources_by_production[snapshot.production.id].get(source_id)
            if source is None or source.production_id != snapshot.production.id:
                raise ProductionSourceNotFound(source_id)
            if source.current_version_id != item.version.id:
                raise ProductionRevisionConflict(snapshot.production.id)
            stored = run_sources[source_id]
            if (
                stored.source_version_id != item.version.id
                or stored.fingerprint_sha256 != item.version.fingerprint_sha256
                or stored.kind != item.source.kind
                or stored.name != item.source.name
                or stored.change_state != item.change_state
            ):
                raise ValueError("Run source snapshots must preserve the monitoring snapshot")
        for finding in run.findings:
            if finding.run_id != run.id or finding.source_id not in run_sources:
                raise ValueError("Run findings must reference a source included in the run")

        next_sources = copy.deepcopy(self._sources_by_production[snapshot.production.id])
        for item in snapshot.sources:
            next_sources[item.source.id].last_monitored_version_id = item.version.id
        next_runs = copy.deepcopy(self._runs_by_production[snapshot.production.id])
        next_runs[run.id] = run.model_copy(deep=True)

        self._sources_by_production[snapshot.production.id] = next_sources
        self._runs_by_production[snapshot.production.id] = next_runs
        return to_public_run(run).model_copy(deep=True)

    def list_runs(self, production_id: str, limit: int) -> list[ProductionRunSummary]:
        self._production(production_id)
        runs = sorted(
            self._runs_by_production[production_id].values(),
            key=lambda run: (run.created_at, run.id),
            reverse=True,
        )
        return [
            ProductionRunSummary(
                id=run.id,
                trigger=run.trigger,
                created_at=run.created_at,
                source_count=len(run.source_snapshots),
                changed_source_count=sum(
                    item.change_state is not SourceChangeState.UNCHANGED
                    for item in run.source_snapshots
                ),
                finding_count=len(run.findings),
            )
            for run in runs[:limit]
        ]

    def get_run(self, production_id: str, run_id: str) -> ProductionRun:
        self._production(production_id)
        run = self._runs_by_production[production_id].get(run_id)
        if run is None:
            raise ProductionRunNotFound(run_id)
        return to_public_run(run).model_copy(deep=True)

    def update_finding_status(
        self,
        production_id: str,
        run_id: str,
        finding_id: str,
        reviewer_status: ReviewerStatus,
        updated_at: datetime,
    ) -> ReviewUpdate:
        self._production(production_id)
        run = self._runs_by_production[production_id].get(run_id)
        if run is None:
            raise ProductionRunNotFound(run_id)

        next_run = run.model_copy(deep=True)
        finding: ProductionFinding | None = None
        for candidate in next_run.findings:
            if candidate.id == finding_id:
                finding = candidate
                break
        if finding is None:
            raise ProductionFindingNotFound(finding_id)

        event_number = len(self._review_events_by_production[production_id]) + 1
        event_id = f"{run_id}:{finding_id}:{event_number}"
        event = ReviewEvent(
            id=event_id,
            production_id=production_id,
            run_id=run_id,
            finding_id=finding_id,
            previous_status=finding.reviewer_status,
            reviewer_status=reviewer_status,
            created_at=updated_at,
        )
        finding.reviewer_status = reviewer_status
        next_runs = copy.deepcopy(self._runs_by_production[production_id])
        next_events = copy.deepcopy(self._review_events_by_production[production_id])
        next_runs[run_id] = next_run
        next_events[event.id] = event.model_copy(deep=True)
        self._runs_by_production[production_id] = next_runs
        self._review_events_by_production[production_id] = next_events
        return ReviewUpdate(
            finding=finding.model_copy(deep=True), event=event.model_copy(deep=True)
        )

    def list_review_events(self, production_id: str, limit: int) -> list[ReviewEvent]:
        self._production(production_id)
        events = sorted(
            self._review_events_by_production[production_id].values(),
            key=lambda event: (event.created_at, event.id),
            reverse=True,
        )
        return [event.model_copy(deep=True) for event in events[:limit]]
