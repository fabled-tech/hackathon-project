import builtins
from collections.abc import Mapping
from typing import Any, Protocol

from app.models import WorkspaceMember


class WorkspaceMemberNotFound(Exception):
    pass


class WorkspaceMemberRepository(Protocol):
    def create(self, member: WorkspaceMember) -> WorkspaceMember: ...

    def get(self, member_id: str) -> WorkspaceMember: ...

    def list(self) -> builtins.list[WorkspaceMember]: ...

    def delete(self, member_id: str) -> None: ...


class InMemoryWorkspaceMemberRepository:
    def __init__(self) -> None:
        self._members: dict[str, WorkspaceMember] = {}

    def create(self, member: WorkspaceMember) -> WorkspaceMember:
        self._members[member.id] = member.model_copy(deep=True)
        return member

    def get(self, member_id: str) -> WorkspaceMember:
        member = self._members.get(member_id)
        if member is None:
            raise WorkspaceMemberNotFound(member_id)
        return member.model_copy(deep=True)

    def list(self) -> list[WorkspaceMember]:
        return [
            member.model_copy(deep=True)
            for member in sorted(self._members.values(), key=lambda item: item.name.casefold())
        ]

    def delete(self, member_id: str) -> None:
        if member_id not in self._members:
            raise WorkspaceMemberNotFound(member_id)
        del self._members[member_id]


class FirestoreWorkspaceMemberRepository:
    """Cloud workspace-member repository loaded only when real repositories are selected."""

    def __init__(self, project: str, collection_name: str, *, client: Any | None = None) -> None:
        if client is None:
            from google.cloud import firestore

            client = firestore.Client(project=project)
        self._collection = client.collection(collection_name)

    def create(self, member: WorkspaceMember) -> WorkspaceMember:
        self._collection.document(member.id).set(member.model_dump(mode="json"))
        return member

    def get(self, member_id: str) -> WorkspaceMember:
        snapshot = self._collection.document(member_id).get()
        if not snapshot.exists:
            raise WorkspaceMemberNotFound(member_id)
        document = snapshot.to_dict()
        if not isinstance(document, Mapping):
            raise WorkspaceMemberNotFound(member_id)
        return WorkspaceMember.model_validate(document)

    def list(self) -> builtins.list[WorkspaceMember]:
        snapshots = self._collection.order_by("name").stream()
        return [
            WorkspaceMember.model_validate(document)
            for snapshot in snapshots
            if isinstance((document := snapshot.to_dict()), Mapping)
        ]

    def delete(self, member_id: str) -> None:
        document = self._collection.document(member_id)
        if not document.get().exists:
            raise WorkspaceMemberNotFound(member_id)
        document.delete()
