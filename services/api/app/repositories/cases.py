from collections.abc import Callable, Mapping
from typing import Any, Protocol

from app.models import Case, CaseSummary, Finding, ReviewerStatus


class CaseRepositoryNotFound(Exception):
    pass


class FindingNotFound(Exception):
    pass


class CaseRepository(Protocol):
    def create(self, case: Case) -> Case: ...

    def get(self, case_id: str) -> Case: ...

    def update_finding_status(
        self, case_id: str, finding_id: str, reviewer_status: ReviewerStatus
    ) -> Finding: ...

    def list_recent(self, limit: int) -> list[CaseSummary]: ...

    def increment_asset_count(self, case_id: str) -> None: ...


class InMemoryCaseRepository:
    def __init__(self) -> None:
        self._cases: dict[str, Case] = {}

    def create(self, case: Case) -> Case:
        self._cases[case.id] = case.model_copy(deep=True)
        return case

    def get(self, case_id: str) -> Case:
        case = self._cases.get(case_id)
        if case is None:
            raise CaseRepositoryNotFound(case_id)
        return case.model_copy(deep=True)

    def update_finding_status(
        self, case_id: str, finding_id: str, reviewer_status: ReviewerStatus
    ) -> Finding:
        case = self._cases.get(case_id)
        if case is None:
            raise CaseRepositoryNotFound(case_id)
        for finding in case.findings:
            if finding.id == finding_id:
                finding.reviewer_status = reviewer_status
                return finding.model_copy(deep=True)
        raise FindingNotFound(finding_id)

    def list_recent(self, limit: int) -> list[CaseSummary]:
        cases = sorted(self._cases.values(), key=lambda case: case.created_at, reverse=True)
        return [
            CaseSummary(
                id=case.id,
                created_at=case.created_at,
                script_excerpt=case.script_text[:160],
                finding_count=len(case.findings),
                asset_count=case.asset_count,
            )
            for case in cases[:limit]
        ]

    def increment_asset_count(self, case_id: str) -> None:
        case = self._cases.get(case_id)
        if case is None:
            raise CaseRepositoryNotFound(case_id)
        case.asset_count += 1


class FirestoreCaseRepository:
    """Cloud repository loaded only when a real repository is explicitly selected."""

    def __init__(self, project: str, collection_name: str, *, client: Any | None = None) -> None:
        increment: Callable[[int], Any]
        if client is None:
            from google.cloud import firestore

            client = firestore.Client(project=project)
            increment = firestore.Increment
        else:
            increment = client.Increment

        self._client = client
        self._increment = increment
        self._collection = self._client.collection(collection_name)

    def create(self, case: Case) -> Case:
        self._collection.document(case.id).set(case.model_dump(mode="json"))
        return case

    def get(self, case_id: str) -> Case:
        snapshot = self._collection.document(case_id).get()
        if not snapshot.exists:
            raise CaseRepositoryNotFound(case_id)
        document = snapshot.to_dict()
        if not isinstance(document, Mapping):
            raise CaseRepositoryNotFound(case_id)
        return Case.model_validate(document)

    def update_finding_status(
        self, case_id: str, finding_id: str, reviewer_status: ReviewerStatus
    ) -> Finding:
        case = self.get(case_id)
        for finding in case.findings:
            if finding.id == finding_id:
                finding.reviewer_status = reviewer_status
                self._collection.document(case_id).update(
                    case.model_dump(include={"findings"}, mode="json")
                )
                return finding
        raise FindingNotFound(finding_id)

    def list_recent(self, limit: int) -> list[CaseSummary]:
        snapshots = (
            self._collection.order_by("created_at", direction="DESCENDING").limit(limit).stream()
        )
        return [
            CaseSummary(
                id=document["id"],
                created_at=document["created_at"],
                script_excerpt=document["script_text"][:160],
                finding_count=len(document["findings"]),
                asset_count=document.get("asset_count", 0),
            )
            for snapshot in snapshots
            if isinstance((document := snapshot.to_dict()), Mapping)
        ]

    def increment_asset_count(self, case_id: str) -> None:
        document = self._collection.document(case_id)
        if not document.get().exists:
            raise CaseRepositoryNotFound(case_id)
        document.update({"asset_count": self._increment(1)})
