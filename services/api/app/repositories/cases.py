from collections.abc import Callable, Mapping
from typing import Any, Protocol

from app.models import (
    Case,
    CaseSummary,
    CaseThreadMessage,
    Finding,
    FindingComment,
    ReviewerStatus,
)


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

    def update_finding_meta(
        self,
        case_id: str,
        finding_id: str,
        *,
        assignee: str | None = None,
        due_date: str | None = None,
    ) -> Finding: ...

    def add_finding_comment(
        self, case_id: str, finding_id: str, comment: FindingComment
    ) -> Finding: ...

    def add_thread_message(
        self, case_id: str, message: CaseThreadMessage
    ) -> Case: ...

    def list_recent(self, limit: int) -> list[CaseSummary]: ...

    def list_all(self) -> list[Case]: ...

    def list_for_production(self, production_id: str) -> list[Case]: ...

    def increment_asset_count(self, case_id: str) -> None: ...

    def delete(self, case_id: str) -> None: ...


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

    def update_finding_meta(
        self,
        case_id: str,
        finding_id: str,
        *,
        assignee: str | None = None,
        due_date: str | None = None,
    ) -> Finding:
        case = self._cases.get(case_id)
        if case is None:
            raise CaseRepositoryNotFound(case_id)
        for finding in case.findings:
            if finding.id == finding_id:
                if assignee is not None:
                    finding.assignee = assignee
                if due_date is not None:
                    finding.due_date = due_date
                return finding.model_copy(deep=True)
        raise FindingNotFound(finding_id)

    def add_finding_comment(
        self, case_id: str, finding_id: str, comment: FindingComment
    ) -> Finding:
        case = self._cases.get(case_id)
        if case is None:
            raise CaseRepositoryNotFound(case_id)
        for finding in case.findings:
            if finding.id == finding_id:
                finding.comments.append(comment)
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

    def list_all(self) -> list[Case]:
        return [case.model_copy(deep=True) for case in self._cases.values()]

    def add_thread_message(self, case_id: str, message: CaseThreadMessage) -> Case:
        case = self._cases.get(case_id)
        if case is None:
            raise CaseRepositoryNotFound(case_id)
        case.thread.append(message)
        return case.model_copy(deep=True)

    def list_for_production(self, production_id: str) -> list[Case]:
        return [
            case.model_copy(deep=True)
            for case in self._cases.values()
            if case.production_id == production_id
        ]

    def increment_asset_count(self, case_id: str) -> None:
        case = self._cases.get(case_id)
        if case is None:
            raise CaseRepositoryNotFound(case_id)
        case.asset_count += 1

    def delete(self, case_id: str) -> None:
        if case_id not in self._cases:
            raise CaseRepositoryNotFound(case_id)
        del self._cases[case_id]


class FirestoreCaseRepository:
    """Cloud repository loaded only when a real repository is explicitly selected."""

    def __init__(
        self,
        project: str,
        collection_name: str,
        *,
        client: Any | None = None,
        increment_factory: Callable[[int], Any] | None = None,
        transactional_decorator: (
            Callable[[Callable[[Any], Finding]], Callable[[Any], Finding]] | None
        ) = None,
        transaction_runner: Callable[[Callable[[Any], Finding]], Finding] | None = None,
    ) -> None:
        if client is None or increment_factory is None or (
            transaction_runner is None and transactional_decorator is None
        ):
            from google.cloud import firestore

            if client is None:
                client = firestore.Client(project=project)
            if increment_factory is None:
                increment_factory = firestore.Increment
            if transactional_decorator is None:
                transactional_decorator = firestore.transactional

        assert increment_factory is not None
        self._client = client
        self._increment_factory = increment_factory
        self._collection = self._client.collection(collection_name)
        self._transactional_decorator = transactional_decorator
        self._transaction_runner = transaction_runner

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
        def update(transaction: Any) -> Finding:
            document = self._collection.document(case_id)
            snapshot = document.get(transaction=transaction)
            if not snapshot.exists:
                raise CaseRepositoryNotFound(case_id)
            stored_case = snapshot.to_dict()
            if not isinstance(stored_case, Mapping):
                raise CaseRepositoryNotFound(case_id)
            case = Case.model_validate(stored_case)
            for finding in case.findings:
                if finding.id == finding_id:
                    finding.reviewer_status = reviewer_status
                    transaction.update(
                        document,
                        case.model_dump(include={"findings"}, mode="json"),
                    )
                    return finding
            raise FindingNotFound(finding_id)

        if self._transaction_runner is not None:
            return self._transaction_runner(update)

        assert self._transactional_decorator is not None
        transaction = self._client.transaction()
        return self._transactional_decorator(update)(transaction)

    def update_finding_meta(
        self,
        case_id: str,
        finding_id: str,
        *,
        assignee: str | None = None,
        due_date: str | None = None,
    ) -> Finding:
        def update(transaction: Any) -> Finding:
            document = self._collection.document(case_id)
            snapshot = document.get(transaction=transaction)
            if not snapshot.exists:
                raise CaseRepositoryNotFound(case_id)
            stored_case = snapshot.to_dict()
            if not isinstance(stored_case, Mapping):
                raise CaseRepositoryNotFound(case_id)
            case = Case.model_validate(stored_case)
            for finding in case.findings:
                if finding.id == finding_id:
                    if assignee is not None:
                        finding.assignee = assignee
                    if due_date is not None:
                        finding.due_date = due_date
                    transaction.update(
                        document,
                        case.model_dump(include={"findings"}, mode="json"),
                    )
                    return finding
            raise FindingNotFound(finding_id)

        if self._transaction_runner is not None:
            return self._transaction_runner(update)

        assert self._transactional_decorator is not None
        transaction = self._client.transaction()
        return self._transactional_decorator(update)(transaction)

    def add_finding_comment(
        self, case_id: str, finding_id: str, comment: FindingComment
    ) -> Finding:
        def update(transaction: Any) -> Finding:
            document = self._collection.document(case_id)
            snapshot = document.get(transaction=transaction)
            if not snapshot.exists:
                raise CaseRepositoryNotFound(case_id)
            stored_case = snapshot.to_dict()
            if not isinstance(stored_case, Mapping):
                raise CaseRepositoryNotFound(case_id)
            case = Case.model_validate(stored_case)
            for finding in case.findings:
                if finding.id == finding_id:
                    finding.comments.append(comment)
                    transaction.update(
                        document,
                        case.model_dump(include={"findings"}, mode="json"),
                    )
                    return finding
            raise FindingNotFound(finding_id)

        if self._transaction_runner is not None:
            return self._transaction_runner(update)

        assert self._transactional_decorator is not None
        transaction = self._client.transaction()
        return self._transactional_decorator(update)(transaction)

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

    def list_all(self) -> list[Case]:
        snapshots = self._collection.stream()
        return [
            Case.model_validate(document)
            for snapshot in snapshots
            if isinstance((document := snapshot.to_dict()), Mapping)
        ]

    def list_for_production(self, production_id: str) -> list[Case]:
        snapshots = self._collection.where("production_id", "==", production_id).stream()
        return [
            Case.model_validate(document)
            for snapshot in snapshots
            if isinstance((document := snapshot.to_dict()), Mapping)
        ]

    def add_thread_message(self, case_id: str, message: CaseThreadMessage) -> Case:
        document = self._collection.document(case_id)
        snapshot = document.get()
        if not snapshot.exists:
            raise CaseRepositoryNotFound(case_id)
        stored_case = snapshot.to_dict()
        if not isinstance(stored_case, Mapping):
            raise CaseRepositoryNotFound(case_id)
        case = Case.model_validate(stored_case)
        case.thread.append(message)
        document.update(case.model_dump(include={"thread"}, mode="json"))
        return case

    def increment_asset_count(self, case_id: str) -> None:
        document = self._collection.document(case_id)
        if not document.get().exists:
            raise CaseRepositoryNotFound(case_id)
        document.update({"asset_count": self._increment_factory(1)})

    def delete(self, case_id: str) -> None:
        document = self._collection.document(case_id)
        if not document.get().exists:
            raise CaseRepositoryNotFound(case_id)
        document.delete()
