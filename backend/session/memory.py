import threading
import time
from dataclasses import dataclass, field

DEFAULT_MAX_TURNS = 20
DEFAULT_TTL_SECONDS = 1800  # 30 minutes


@dataclass(frozen=True)
class SessionTurn:
    role: str
    content: str
    timestamp: float


@dataclass
class _SessionData:
    turns: list[SessionTurn] = field(default_factory=list)
    last_active: float = 0.0


class SessionMemory:
    """In-memory session store with bounded turn window and TTL expiration."""

    def __init__(
        self,
        max_turns: int = DEFAULT_MAX_TURNS,
        ttl_seconds: float = DEFAULT_TTL_SECONDS,
    ):
        self._max_turns = max_turns
        self._ttl_seconds = ttl_seconds
        self._sessions: dict[str, _SessionData] = {}
        self._lock = threading.Lock()

    def add_turn(self, session_id: str, role: str, content: str) -> None:
        now = time.time()
        turn = SessionTurn(role=role, content=content, timestamp=now)

        with self._lock:
            session = self._sessions.setdefault(session_id, _SessionData())
            session.turns.append(turn)
            session.last_active = now
            if len(session.turns) > self._max_turns:
                session.turns = session.turns[-self._max_turns :]

    def get_turns(self, session_id: str) -> list[SessionTurn]:
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                return []
            return list(session.turns)

    def clear_session(self, session_id: str) -> None:
        with self._lock:
            self._sessions.pop(session_id, None)

    def cleanup_expired(self) -> None:
        now = time.time()
        with self._lock:
            expired = [
                sid
                for sid, data in self._sessions.items()
                if now - data.last_active > self._ttl_seconds
            ]
            for sid in expired:
                del self._sessions[sid]
