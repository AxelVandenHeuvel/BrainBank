"""SQLite manifest for tracking file identity, content hashes, and managed status.

The manifest is the authority on which files are known to BrainBank, whether they
were created via the app (is_managed=True) or found externally by the watcher
(is_managed=False), and whether their content has changed since last indexing.
"""

import os
import sqlite3
import threading
from datetime import datetime, timezone


_SCHEMA = """
CREATE TABLE IF NOT EXISTS manifest (
    doc_id       TEXT PRIMARY KEY,
    file_path    TEXT NOT NULL UNIQUE,
    content_hash TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'indexed',
    last_indexed_at TEXT NOT NULL,
    is_managed   INTEGER NOT NULL DEFAULT 1
);
"""


class Manifest:
    def __init__(self, notes_dir: str):
        os.makedirs(notes_dir, exist_ok=True)
        self._db_path = os.path.join(notes_dir, ".brainbank_manifest.db")
        self._lock = threading.Lock()
        with self._connect() as conn:
            conn.executescript(_SCHEMA)

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path, timeout=10)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.row_factory = sqlite3.Row
        return conn

    def upsert(
        self,
        doc_id: str,
        file_path: str,
        content_hash: str,
        *,
        is_managed: bool = True,
        status: str = "indexed",
    ) -> None:
        now = datetime.now(timezone.utc).isoformat()
        with self._lock:
            with self._connect() as conn:
                conn.execute(
                    """
                    INSERT INTO manifest (doc_id, file_path, content_hash, status, last_indexed_at, is_managed)
                    VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT(doc_id) DO UPDATE SET
                        file_path = excluded.file_path,
                        content_hash = excluded.content_hash,
                        status = excluded.status,
                        last_indexed_at = excluded.last_indexed_at,
                        is_managed = excluded.is_managed
                    """,
                    (doc_id, file_path, content_hash, status, now, int(is_managed)),
                )

    def get(self, doc_id: str) -> dict | None:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM manifest WHERE doc_id = ?", (doc_id,)).fetchone()
        return self._row_to_dict(row) if row else None

    def get_by_path(self, file_path: str) -> dict | None:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM manifest WHERE file_path = ?", (file_path,)).fetchone()
        return self._row_to_dict(row) if row else None

    def list_managed(self) -> list[dict]:
        with self._connect() as conn:
            rows = conn.execute("SELECT * FROM manifest WHERE is_managed = 1").fetchall()
        return [self._row_to_dict(r) for r in rows]

    def list_all(self) -> list[dict]:
        with self._connect() as conn:
            rows = conn.execute("SELECT * FROM manifest").fetchall()
        return [self._row_to_dict(r) for r in rows]

    def adopt(self, doc_id: str) -> bool:
        with self._lock:
            with self._connect() as conn:
                cursor = conn.execute(
                    "UPDATE manifest SET is_managed = 1 WHERE doc_id = ?", (doc_id,)
                )
                return cursor.rowcount > 0

    def delete(self, doc_id: str) -> None:
        with self._lock:
            with self._connect() as conn:
                conn.execute("DELETE FROM manifest WHERE doc_id = ?", (doc_id,))

    def needs_reindex(self, doc_id: str, current_hash: str) -> bool:
        row = self.get(doc_id)
        if row is None:
            return True
        return row["content_hash"] != current_hash

    def close(self) -> None:
        """Explicitly close the WAL checkpoint to release file handles."""
        with self._lock:
            conn = self._connect()
            try:
                conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            finally:
                conn.close()

    @staticmethod
    def _row_to_dict(row: sqlite3.Row) -> dict:
        d = dict(row)
        d["is_managed"] = bool(d["is_managed"])
        return d
