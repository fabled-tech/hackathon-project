from collections.abc import Mapping
from typing import Protocol

from app.models import Case, Finding, ReviewerStatus


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


class FirestoreCaseRepository:
    """Cloud repository loaded only when a real repository is explicitly selected."""

    def __init__(self, project: str, collection_name: str) -> None:
        from google.cloud import firestore

        self._client = firestore.Client(project=project)
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
                self._collection.document(case_id).set(case.model_dump(mode="json"))
                return finding
        raise FindingNotFound(finding_id)
