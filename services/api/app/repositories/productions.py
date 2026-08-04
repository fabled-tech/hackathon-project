import copy
from collections.abc import Callable, Mapping
from datetime import datetime
from typing import Any, Protocol, TypeVar, cast
from uuid import uuid4

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


def _validate_source_version_metadata(
    source: ProductionSource, version: ProductionSourceVersion, *, creating: bool = False
) -> None:
    if source.kind.value == "script":
        if version.script_text is None:
            raise ValueError("Script sources require script source versions")
        return
    if version.asset_id is None:
        raise ValueError("Asset sources require asset source versions")
    if creating and (
        source.name != version.asset_filename
        or source.content_type != version.asset_content_type
        or source.byte_size != version.asset_byte_size
    ):
        raise ValueError("Asset source metadata must match its current immutable version")


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
            version = self._versions_by_source[source.id][source.current_version_id]
            change_state = source_change_state(source, version.fingerprint_sha256)
            if not source.active and change_state is not SourceChangeState.RETIRED:
                continue
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
        _validate_source_version_metadata(source, version, creating=True)
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

        _validate_source_version_metadata(source, version)
        source_updates: dict[str, object] = {
            "current_version_id": version.id,
            "updated_at": updated_at,
        }
        if source.kind.value == "asset":
            source_updates.update(
                {
                    "name": version.asset_filename,
                    "content_type": version.asset_content_type,
                    "byte_size": version.asset_byte_size,
                }
            )
        next_source = source.model_copy(update=source_updates, deep=True)
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
            next_sources[item.source.id].last_monitored_fingerprint_sha256 = (
                item.version.fingerprint_sha256
            )
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


TransactionResult = TypeVar("TransactionResult")


class FirestoreProductionRepository:
    """Firestore-backed production monitoring storage with transactional mutations."""

    def __init__(
        self,
        project: str,
        case_collection: str,
        *,
        client: Any | None = None,
        transactional_decorator: (
            Callable[[Callable[[Any], Any]], Callable[[Any], Any]] | None
        ) = None,
        transaction_runner: Callable[[Callable[[Any], Any]], Any] | None = None,
    ) -> None:
        if client is None or (transaction_runner is None and transactional_decorator is None):
            from google.cloud import firestore

            if client is None:
                client = firestore.Client(project=project)
            if transactional_decorator is None:
                transactional_decorator = firestore.transactional

        self._client = client
        self._collection = self._client.collection(f"{case_collection}_productions")
        self._transactional_decorator = transactional_decorator
        self._transaction_runner = transaction_runner

    def _production_document(self, production_id: str) -> Any:
        return self._collection.document(production_id)

    def _source_document(self, production_id: str, source_id: str) -> Any:
        return self._production_document(production_id).collection("sources").document(source_id)

    def _version_document(self, production_id: str, source_id: str, version_id: str) -> Any:
        return self._source_document(production_id, source_id).collection("versions").document(
            version_id
        )

    def _run_document(self, production_id: str, run_id: str) -> Any:
        return self._production_document(production_id).collection("runs").document(run_id)

    def _review_events(self, production_id: str) -> Any:
        return self._production_document(production_id).collection("review_events")

    def _transaction(self, operation: Callable[[Any], TransactionResult]) -> TransactionResult:
        if self._transaction_runner is not None:
            return cast(TransactionResult, self._transaction_runner(operation))

        assert self._transactional_decorator is not None
        return cast(
            TransactionResult,
            self._transactional_decorator(operation)(self._client.transaction()),
        )

    @staticmethod
    def _snapshot_data(snapshot: Any) -> Mapping[str, Any] | None:
        if not snapshot.exists:
            return None
        document = snapshot.to_dict()
        return document if isinstance(document, Mapping) else None

    def _get_production(self, production_id: str, *, transaction: Any | None = None) -> Production:
        snapshot = self._production_document(production_id).get(transaction=transaction)
        document = self._snapshot_data(snapshot)
        if document is None:
            raise ProductionRepositoryNotFound(production_id)
        return Production.model_validate(document)

    def _get_source(
        self, production_id: str, source_id: str, *, transaction: Any | None = None
    ) -> ProductionSource:
        snapshot = self._source_document(production_id, source_id).get(transaction=transaction)
        document = self._snapshot_data(snapshot)
        if document is None:
            raise ProductionSourceNotFound(source_id)
        return ProductionSource.model_validate(document)

    def _get_version(
        self,
        production_id: str,
        source_id: str,
        version_id: str,
        *,
        transaction: Any | None = None,
    ) -> ProductionSourceVersion:
        snapshot = self._version_document(production_id, source_id, version_id).get(
            transaction=transaction
        )
        document = self._snapshot_data(snapshot)
        if document is None:
            raise ProductionSourceNotFound(source_id)
        return ProductionSourceVersion.model_validate(document)

    def _monitoring_sources(self, production_id: str) -> list[ProductionMonitoringSource]:
        monitoring_sources: list[ProductionMonitoringSource] = []
        for snapshot in self._production_document(production_id).collection("sources").stream():
            document = self._snapshot_data(snapshot)
            if document is None:
                continue
            source = ProductionSource.model_validate(document)
            version = self._get_version(production_id, source.id, source.current_version_id)
            change_state = source_change_state(source, version.fingerprint_sha256)
            if not source.active and change_state is not SourceChangeState.RETIRED:
                continue
            monitoring_sources.append(
                ProductionMonitoringSource(
                    source=source,
                    version=version,
                    change_state=change_state,
                )
            )
        return monitoring_sources

    def _latest_run(self, production_id: str) -> StoredProductionRun | None:
        snapshots = (
            self._production_document(production_id)
            .collection("runs")
            .order_by("created_at", direction="DESCENDING")
            .limit(1)
            .stream()
        )
        for snapshot in snapshots:
            document = self._snapshot_data(snapshot)
            if document is not None:
                return StoredProductionRun.model_validate(document)
        return None

    @staticmethod
    def _run_summary(run: StoredProductionRun) -> ProductionRunSummary:
        return ProductionRunSummary(
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

    def create(self, production: Production) -> Production:
        document = self._production_document(production.id)
        if document.get().exists:
            raise ValueError(f"Production already exists: {production.id}")
        document.set(production.model_dump(mode="json"))
        return production.model_copy(deep=True)

    def list_recent(self, limit: int) -> list[ProductionSummary]:
        summaries: list[ProductionSummary] = []
        snapshots = (
            self._collection.order_by("updated_at", direction="DESCENDING").limit(limit).stream()
        )
        for snapshot in snapshots:
            document = self._snapshot_data(snapshot)
            if document is None:
                continue
            production = Production.model_validate(document)
            detail = to_public_detail(
                production,
                self._monitoring_sources(production.id),
                latest_run=self._latest_run(production.id),
            )
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
        return summaries

    def get_detail(self, production_id: str) -> ProductionDetail:
        production = self._get_production(production_id)
        return to_public_detail(
            production,
            self._monitoring_sources(production_id),
            latest_run=self._latest_run(production_id),
        )

    def create_source(
        self, production_id: str, source: ProductionSource, version: ProductionSourceVersion
    ) -> ProductionSource:
        if source.production_id != production_id or version.source_id != source.id:
            raise ValueError("Source and version must belong to the requested production source")
        if source.current_version_id != version.id:
            raise ValueError("Source current version must match the created version")
        _validate_source_version_metadata(source, version, creating=True)

        def create_source_transaction(transaction: Any) -> ProductionSource:
            production = self._get_production(production_id, transaction=transaction)
            source_document = self._source_document(production_id, source.id)
            if source_document.get(transaction=transaction).exists:
                raise ValueError(f"Source already exists: {source.id}")
            transaction.set(source_document, source.model_dump(mode="json"))
            transaction.set(
                self._version_document(production_id, source.id, version.id),
                version.model_dump(mode="json"),
            )
            transaction.update(
                self._production_document(production_id),
                {"revision": production.revision + 1, "updated_at": source.updated_at.isoformat()},
            )
            return source.model_copy(deep=True)

        return self._transaction(create_source_transaction)

    def append_source_version(
        self,
        production_id: str,
        source_id: str,
        version: ProductionSourceVersion,
        updated_at: datetime,
    ) -> ProductionSource:
        def append_source_version_transaction(transaction: Any) -> ProductionSource:
            production = self._get_production(production_id, transaction=transaction)
            source = self._get_source(production_id, source_id, transaction=transaction)
            if not source.active:
                raise ValueError("Cannot append a version to a retired source")
            if version.source_id != source.id:
                raise ValueError("Version must belong to the requested source")
            _validate_source_version_metadata(source, version)
            version_document = self._version_document(production_id, source_id, version.id)
            if version_document.get(transaction=transaction).exists:
                raise ValueError(f"Source version already exists: {version.id}")

            source_updates: dict[str, object] = {
                "current_version_id": version.id,
                "updated_at": updated_at,
            }
            if source.kind.value == "asset":
                source_updates.update(
                    {
                        "name": version.asset_filename,
                        "content_type": version.asset_content_type,
                        "byte_size": version.asset_byte_size,
                    }
                )
            next_source = source.model_copy(update=source_updates, deep=True)
            transaction.set(version_document, version.model_dump(mode="json"))
            transaction.update(
                self._source_document(production_id, source_id), next_source.model_dump(mode="json")
            )
            transaction.update(
                self._production_document(production_id),
                {"revision": production.revision + 1, "updated_at": updated_at.isoformat()},
            )
            return next_source

        return self._transaction(append_source_version_transaction)

    def retire_source(
        self, production_id: str, source_id: str, updated_at: datetime
    ) -> ProductionSource:
        def retire_source_transaction(transaction: Any) -> ProductionSource:
            production = self._get_production(production_id, transaction=transaction)
            source = self._get_source(production_id, source_id, transaction=transaction)
            if not source.active:
                return source.model_copy(deep=True)
            next_source = source.model_copy(
                update={
                    "active": False,
                    "last_monitored_version_id": None,
                    "updated_at": updated_at,
                },
                deep=True,
            )
            transaction.update(
                self._source_document(production_id, source_id), next_source.model_dump(mode="json")
            )
            transaction.update(
                self._production_document(production_id),
                {"revision": production.revision + 1, "updated_at": updated_at.isoformat()},
            )
            return next_source

        return self._transaction(retire_source_transaction)

    def get_monitoring_snapshot(self, production_id: str) -> ProductionMonitoringSnapshot:
        production = self._get_production(production_id)
        return ProductionMonitoringSnapshot(
            production=production,
            sources=self._monitoring_sources(production_id),
            has_successful_run=self._latest_run(production_id) is not None,
        )

    def append_complete_run(
        self, snapshot: ProductionMonitoringSnapshot, run: StoredProductionRun
    ) -> ProductionRun:
        production_id = snapshot.production.id
        if (
            run.production_id != production_id
            or run.production_revision != snapshot.production.revision
        ):
            raise ValueError("Run must belong to the supplied monitoring snapshot")
        current_production = self._get_production(production_id)
        if (
            current_production.revision == snapshot.production.revision
            and snapshot.sources != self._monitoring_sources(production_id)
        ):
            raise ValueError("Run snapshot must match the current monitoring sources")

        def append_complete_run_transaction(transaction: Any) -> ProductionRun:
            production = self._get_production(production_id, transaction=transaction)
            if production.revision != snapshot.production.revision:
                raise ProductionRevisionConflict(production_id)
            run_document = self._run_document(production_id, run.id)
            if run_document.get(transaction=transaction).exists:
                raise ValueError(f"Run already exists: {run.id}")

            snapshot_sources = {item.source.id: item for item in snapshot.sources}
            if len(snapshot_sources) != len(snapshot.sources):
                raise ValueError("Monitoring snapshot contains duplicate sources")
            run_sources = {item.source_id: item for item in run.source_snapshots}
            if len(run_sources) != len(run.source_snapshots) or set(run_sources) != set(
                snapshot_sources
            ):
                raise ValueError("Run source snapshots must match the monitoring snapshot")

            sources_to_update: list[tuple[Any, ProductionSource]] = []
            for source_id, item in snapshot_sources.items():
                source = self._get_source(production_id, source_id, transaction=transaction)
                if (
                    source.production_id != production_id
                    or source.current_version_id != item.version.id
                ):
                    raise ProductionRevisionConflict(production_id)
                version = self._get_version(
                    production_id, source_id, source.current_version_id, transaction=transaction
                )
                if (
                    source != item.source
                    or source_change_state(source, version.fingerprint_sha256)
                    is not item.change_state
                    or version != item.version
                ):
                    raise ProductionRevisionConflict(production_id)
                stored = run_sources[source_id]
                if (
                    stored.source_version_id != item.version.id
                    or stored.fingerprint_sha256 != item.version.fingerprint_sha256
                    or stored.kind != item.source.kind
                    or stored.name != item.source.name
                    or stored.change_state != item.change_state
                ):
                    raise ValueError("Run source snapshots must preserve the monitoring snapshot")
                sources_to_update.append(
                    (
                        self._source_document(production_id, source_id),
                        source.model_copy(
                            update={
                                "last_monitored_version_id": version.id,
                                "last_monitored_fingerprint_sha256": version.fingerprint_sha256,
                            },
                            deep=True,
                        ),
                    )
                )
            for finding in run.findings:
                if finding.run_id != run.id or finding.source_id not in run_sources:
                    raise ValueError("Run findings must reference a source included in the run")

            transaction.set(run_document, run.model_dump(mode="json"))
            for source_document, source in sources_to_update:
                transaction.update(source_document, source.model_dump(mode="json"))
            return to_public_run(run)

        return self._transaction(append_complete_run_transaction)

    def list_runs(self, production_id: str, limit: int) -> list[ProductionRunSummary]:
        self._get_production(production_id)
        snapshots = (
            self._production_document(production_id)
            .collection("runs")
            .order_by("created_at", direction="DESCENDING")
            .limit(limit)
            .stream()
        )
        return [
            self._run_summary(StoredProductionRun.model_validate(document))
            for snapshot in snapshots
            if (document := self._snapshot_data(snapshot)) is not None
        ]

    def get_run(self, production_id: str, run_id: str) -> ProductionRun:
        self._get_production(production_id)
        snapshot = self._run_document(production_id, run_id).get()
        document = self._snapshot_data(snapshot)
        if document is None:
            raise ProductionRunNotFound(run_id)
        return to_public_run(StoredProductionRun.model_validate(document))

    def update_finding_status(
        self,
        production_id: str,
        run_id: str,
        finding_id: str,
        reviewer_status: ReviewerStatus,
        updated_at: datetime,
    ) -> ReviewUpdate:
        def update_finding_status_transaction(transaction: Any) -> ReviewUpdate:
            self._get_production(production_id, transaction=transaction)
            run_document = self._run_document(production_id, run_id)
            snapshot = run_document.get(transaction=transaction)
            document = self._snapshot_data(snapshot)
            if document is None:
                raise ProductionRunNotFound(run_id)
            run = StoredProductionRun.model_validate(document)
            finding: ProductionFinding | None = None
            previous_status: ReviewerStatus | None = None
            for candidate in run.findings:
                if candidate.id == finding_id:
                    previous_status = candidate.reviewer_status
                    candidate.reviewer_status = reviewer_status
                    finding = candidate
                    break
            if finding is None or previous_status is None:
                raise ProductionFindingNotFound(finding_id)

            event = ReviewEvent(
                id=uuid4().hex,
                production_id=production_id,
                run_id=run_id,
                finding_id=finding_id,
                previous_status=previous_status,
                reviewer_status=reviewer_status,
                created_at=updated_at,
            )
            transaction.update(run_document, run.model_dump(include={"findings"}, mode="json"))
            transaction.set(
                self._review_events(production_id).document(event.id), event.model_dump(mode="json")
            )
            return ReviewUpdate(finding=finding.model_copy(deep=True), event=event)

        return self._transaction(update_finding_status_transaction)

    def list_review_events(self, production_id: str, limit: int) -> list[ReviewEvent]:
        self._get_production(production_id)
        snapshots = (
            self._review_events(production_id)
            .order_by("created_at", direction="DESCENDING")
            .limit(limit)
            .stream()
        )
        return [
            ReviewEvent.model_validate(document)
            for snapshot in snapshots
            if (document := self._snapshot_data(snapshot)) is not None
        ]
