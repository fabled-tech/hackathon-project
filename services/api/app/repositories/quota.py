from datetime import UTC, datetime
from threading import Lock
from typing import Protocol


def today_key() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%d")


class AnalysisQuota(Protocol):
    def try_consume(self, day: str) -> bool:
        """Reserve one analysis for `day`. Return False when the cap is already reached."""
        ...


class InMemoryAnalysisQuota:
    def __init__(self, cap: int) -> None:
        self._cap = cap
        self._used: dict[str, int] = {}
        self._lock = Lock()

    def try_consume(self, day: str) -> bool:
        with self._lock:
            used = self._used.get(day, 0)
            if used >= self._cap:
                return False
            self._used[day] = used + 1
            return True


class FirestoreAnalysisQuota:
    def __init__(self, project: str, collection: str, cap: int) -> None:
        from google.cloud import firestore

        self._cap = cap
        self._client = firestore.Client(project=project)
        self._collection = self._client.collection(collection)
        self._transactional = firestore.transactional

    def try_consume(self, day: str) -> bool:
        document = self._collection.document(day)
        transaction = self._client.transaction()

        @self._transactional
        def reserve(txn: object) -> bool:
            snapshot = document.get(transaction=txn)
            used = int((snapshot.to_dict() or {}).get("used", 0)) if snapshot.exists else 0
            if used >= self._cap:
                return False
            txn.set(document, {"used": used + 1, "cap": self._cap}, merge=True)  # type: ignore[attr-defined]
            return True

        return bool(reserve(transaction))
