import threading
import time
import uuid
from dataclasses import dataclass, field

from backend.retrieval.types import LocalQueryPreparation, QueryRoute

DEFAULT_PREPARED_QUERY_TTL_SECONDS = 300
DEFAULT_PREPARED_QUERY_MAX_ITEMS = 100


@dataclass(frozen=True)
class PreparedQueryRecord:
    route: QueryRoute
    preparation: LocalQueryPreparation
    created_at: float = field(default_factory=time.time)


class PreparedQueryStore:
    """Short-lived in-memory store for local query state between prepare and answer."""

    def __init__(
        self,
        ttl_seconds: float = DEFAULT_PREPARED_QUERY_TTL_SECONDS,
        max_items: int = DEFAULT_PREPARED_QUERY_MAX_ITEMS,
    ):
        self._ttl_seconds = ttl_seconds
        self._max_items = max_items
        self._records: dict[str, PreparedQueryRecord] = {}
        self._lock = threading.Lock()

    def create(
        self,
        route: QueryRoute,
        preparation: LocalQueryPreparation,
    ) -> str:
        now = time.time()
        record = PreparedQueryRecord(route=route, preparation=preparation, created_at=now)

        with self._lock:
            self._cleanup_expired_locked(now)
            if len(self._records) >= self._max_items:
                oldest_key = min(
                    self._records,
                    key=lambda key: self._records[key].created_at,
                )
                del self._records[oldest_key]

            prepared_query_id = str(uuid.uuid4())
            self._records[prepared_query_id] = record
            return prepared_query_id

    def consume(self, prepared_query_id: str) -> PreparedQueryRecord | None:
        now = time.time()

        with self._lock:
            self._cleanup_expired_locked(now)
            return self._records.pop(prepared_query_id, None)

    def clear(self) -> None:
        with self._lock:
            self._records.clear()

    def _cleanup_expired_locked(self, now: float) -> None:
        expired_keys = [
            prepared_query_id
            for prepared_query_id, record in self._records.items()
            if now - record.created_at > self._ttl_seconds
        ]
        for prepared_query_id in expired_keys:
            del self._records[prepared_query_id]
