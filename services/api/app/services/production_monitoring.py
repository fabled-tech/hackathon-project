from collections.abc import Callable
from datetime import UTC, datetime
from uuid import uuid4

from app.agents import AgentService
from app.errors import ProductionContentUnavailableError, ProductionNoChangesError
from app.models import (
    Finding,
    ProductionFinding,
    ProductionMonitoringSource,
    ProductionRun,
    ProductionRunTrigger,
    ProductionSourceKind,
    SourceChangeState,
    StoredProductionRun,
    StoredProductionRunSourceSnapshot,
)
from app.repositories import AssetRepository, ProductionRepository


class ProductionMonitoringService:
    """Analyze a complete production snapshot and persist it atomically."""

    def __init__(
        self,
        production_repository: ProductionRepository,
        asset_repository: AssetRepository,
        agent_service: AgentService,
        *,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self._production_repository = production_repository
        self._asset_repository = asset_repository
        self._agent_service = agent_service
        self._clock = clock or (lambda: datetime.now(UTC))

    def monitor(self, production_id: str, *, explicit_recheck: bool) -> ProductionRun:
        snapshot = self._production_repository.get_monitoring_snapshot(production_id)
        changed_states = {
            SourceChangeState.NEW,
            SourceChangeState.CHANGED,
            SourceChangeState.RETIRED,
        }
        if not explicit_recheck and not any(
            item.change_state in changed_states for item in snapshot.sources
        ):
            raise ProductionNoChangesError(production_id)

        run_id = str(uuid4())
        findings: list[ProductionFinding] = []
        stored_snapshots: list[StoredProductionRunSourceSnapshot] = []
        for item in snapshot.sources:
            stored_snapshots.append(self._stored_snapshot(item))
            if not item.source.active:
                continue
            text = self._source_text(snapshot.production.id, item)
            agent_findings = self._agent_service.analyze(item.version.id, text)
            findings.extend(self._map_findings(run_id, item.source.id, agent_findings))

        trigger = (
            ProductionRunTrigger.EXPLICIT_RECHECK
            if explicit_recheck
            else ProductionRunTrigger.INITIAL
            if not snapshot.has_successful_run
            else ProductionRunTrigger.CHANGES_DETECTED
        )
        return self._production_repository.append_complete_run(
            snapshot,
            StoredProductionRun(
                id=run_id,
                production_id=snapshot.production.id,
                production_revision=snapshot.production.revision,
                trigger=trigger,
                created_at=self._clock(),
                source_snapshots=stored_snapshots,
                findings=findings,
            ),
        )

    @staticmethod
    def _stored_snapshot(item: ProductionMonitoringSource) -> StoredProductionRunSourceSnapshot:
        return StoredProductionRunSourceSnapshot(
            source_id=item.source.id,
            source_version_id=item.version.id,
            kind=item.source.kind,
            name=item.source.name,
            fingerprint_sha256=item.version.fingerprint_sha256,
            change_state=item.change_state,
        )

    def _source_text(self, production_id: str, item: ProductionMonitoringSource) -> str:
        if item.source.kind is ProductionSourceKind.SCRIPT:
            if item.version.script_text is None:
                raise ProductionContentUnavailableError()
            return item.version.script_text

        if item.version.asset_id is None:
            raise ProductionContentUnavailableError()
        try:
            content = self._asset_repository.get_content(production_id, item.version.asset_id)
            if not isinstance(content, bytes):
                raise TypeError("Asset content must be bytes")
            return content.decode("utf-8")
        except Exception:
            raise ProductionContentUnavailableError() from None

    @staticmethod
    def _map_findings(
        run_id: str, source_id: str, findings: list[Finding]
    ) -> list[ProductionFinding]:
        return [
            ProductionFinding(
                id=str(uuid4()),
                run_id=run_id,
                source_id=source_id,
                category=finding.category,
                detected_item=finding.detected_item,
                explanation=finding.explanation,
                confidence=finding.confidence,
                supporting_evidence=finding.supporting_evidence,
                source_urls=finding.source_urls,
                retrieved_at=finding.retrieved_at,
                reviewer_status=finding.reviewer_status,
                evidence=finding.evidence,
            )
            for finding in findings
        ]
