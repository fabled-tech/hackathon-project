from datetime import UTC, datetime
from uuid import uuid4

from app.integrations import GeminiClient, ParallelSearchClient
from app.models import (
    AgentRun,
    AgentRunStatus,
    AgentRunTrigger,
    Case,
    Finding,
    ReviewerStatus,
)
from app.models.analysis import GeminiSignal
from app.repositories import AgentRunRepository, CaseRepository


class ClearanceAgentService:
    """Production-scoped agent: digests findings (Gemini) and watches for new evidence (Parallel)."""

    def __init__(
        self,
        gemini: GeminiClient,
        parallel: ParallelSearchClient,
        cases: CaseRepository,
        runs: AgentRunRepository,
    ) -> None:
        self._gemini = gemini
        self._parallel = parallel
        self._cases = cases
        self._runs = runs

    async def digest(
        self, production_id: str, trigger: AgentRunTrigger = AgentRunTrigger.MANUAL
    ) -> AgentRun:
        """Summarize a production's open findings into a clearance brief via Gemini."""
        run = self._start_run(production_id, "digest", trigger)
        try:
            cases = self._cases.list_for_production(production_id)
            open_findings = [
                finding
                for case in cases
                for finding in case.findings
                if finding.reviewer_status in {ReviewerStatus.PENDING, ReviewerStatus.ESCALATED}
            ]
            summary = await self._summarize_findings(cases, open_findings)
            return self._complete_run(run, summary)
        except Exception:
            return self._fail_run(run, "Digest agent could not summarize this production.")

    async def watch(
        self, production_id: str, trigger: AgentRunTrigger = AgentRunTrigger.MANUAL
    ) -> AgentRun:
        """Re-run escalated findings' queries via Parallel and flag new evidence."""
        run = self._start_run(production_id, "watch", trigger)
        try:
            cases = self._cases.list_for_production(production_id)
            escalated = [
                finding
                for case in cases
                for finding in case.findings
                if finding.reviewer_status is ReviewerStatus.ESCALATED
            ]
            new_evidence_count = await self._rescan_escalated(escalated)
            summary = (
                f"Watch agent re-scanned {len(escalated)} escalated finding(s); "
                f"{new_evidence_count} had new evidence."
            )
            return self._complete_run(run, summary)
        except Exception:
            return self._fail_run(run, "Watch agent could not re-scan escalated findings.")

    def _start_run(
        self, production_id: str, kind: str, trigger: AgentRunTrigger
    ) -> AgentRun:
        run = AgentRun(
            id=str(uuid4()),
            production_id=production_id,
            kind=kind,
            trigger=trigger,
            status=AgentRunStatus.RUNNING,
            created_at=datetime.now(UTC),
        )
        return self._runs.create(run)

    def _complete_run(self, run: AgentRun, summary: str) -> AgentRun:
        run.status = AgentRunStatus.COMPLETED
        run.summary = summary
        run.completed_at = datetime.now(UTC)
        return self._runs.update(run)

    def _fail_run(self, run: AgentRun, summary: str) -> AgentRun:
        run.status = AgentRunStatus.FAILED
        run.summary = summary
        run.completed_at = datetime.now(UTC)
        return self._runs.update(run)

    async def _summarize_findings(self, cases: list[Case], open_findings: list[Finding]) -> str:
        if not open_findings:
            return "No open findings across this production. Clearance is on track."
        digest_input = "\n".join(
            f"- [{finding.reviewer_status}] {finding.detected_item} "
            f"({finding.category}, {finding.confidence:.0%} confidence)"
            for finding in open_findings
        )
        signal = GeminiSignal(
            category="clearance_digest",
            detected_item=f"{len(open_findings)} open findings across {len(cases)} case(s)",
            explanation=digest_input,
            confidence=1.0,
        )
        decision = await self._gemini.curate_evidence(signal, [])
        if decision.rationale:
            return decision.rationale
        escalated = sum(
            1 for finding in open_findings if finding.reviewer_status is ReviewerStatus.ESCALATED
        )
        return (
            f"{len(open_findings)} open finding(s) across {len(cases)} case(s); "
            f"{escalated} escalated and blocking release. Review the escalation queue first."
        )

    async def _rescan_escalated(self, escalated: list[Finding]) -> int:
        new_evidence_count = 0
        for finding in escalated:
            signal = GeminiSignal(
                category=finding.category,
                detected_item=finding.detected_item,
                explanation=finding.explanation,
                confidence=finding.confidence,
            )
            results = await self._parallel.search(signal, f"rightsrader:watch:{finding.id}")
            known_urls = set(finding.source_urls)
            if any(result.source.url not in known_urls for result in results):
                new_evidence_count += 1
        return new_evidence_count
