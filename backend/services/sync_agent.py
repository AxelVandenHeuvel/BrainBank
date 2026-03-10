"""File system watcher with debounce queue for automatic note ingestion.

Monitors a notes directory for .md and .txt file changes and automatically
ingests them into BrainBank after a debounce period.
"""

import logging
import os
import threading
import time

from backend.db.kuzu import get_kuzu_engine
from backend.db.lance import delete_document_chunks
from backend.db.manifest import Manifest
from backend.ingestion.processor import doc_id_from_path, ingest_markdown
from backend.services.notes_fs import content_hash_file

logger = logging.getLogger(__name__)

DEBOUNCE_SECONDS = 60.0
WATCHED_EXTENSIONS = {".md", ".txt"}
DEFAULT_NOTES_DIR = "./data/notes"
DEFAULT_ASSETS_DIR = "./data/assets"


def get_notes_dir() -> str:
    """Return the resolved notes directory from env or default."""
    return os.path.abspath(os.environ.get("BRAINBANK_NOTES_DIR", DEFAULT_NOTES_DIR))


def get_assets_dir() -> str:
    """Return the resolved assets directory from env or default."""
    return os.path.abspath(os.environ.get("BRAINBANK_ASSETS_DIR", DEFAULT_ASSETS_DIR))


class SyncAgent:
    def __init__(
        self,
        notes_dir: str = DEFAULT_NOTES_DIR,
        auto_start: bool = True,
        debounce_seconds: float = DEBOUNCE_SECONDS,
    ):
        self.notes_dir = os.path.abspath(notes_dir)
        self.debounce_seconds = debounce_seconds

        self.pending: dict[str, float] = {}
        self.pending_deletes: dict[str, float] = {}
        self._lock = threading.Lock()

        self.manifest = Manifest(self.notes_dir)

        self._running = False
        self._thread: threading.Thread | None = None
        self._observer = None

        if auto_start:
            self.start()

    def enqueue(self, path: str) -> None:
        ext = os.path.splitext(path)[1].lower()
        if ext not in WATCHED_EXTENSIONS:
            return
        with self._lock:
            self.pending[path] = time.monotonic()

    def enqueue_delete(self, path: str) -> None:
        ext = os.path.splitext(path)[1].lower()
        if ext not in WATCHED_EXTENSIONS:
            return
        with self._lock:
            self.pending.pop(path, None)
            self.pending_deletes[path] = time.monotonic()

    def _drain_ready(self) -> list[str]:
        now = time.monotonic()
        ready = []
        with self._lock:
            expired_keys = [
                p for p, ts in self.pending.items()
                if (now - ts) >= self.debounce_seconds
            ]
            for key in expired_keys:
                del self.pending[key]
                ready.append(key)
        return ready

    def _drain_ready_deletes(self) -> list[str]:
        now = time.monotonic()
        ready = []
        with self._lock:
            expired_keys = [
                p for p, ts in self.pending_deletes.items()
                if (now - ts) >= self.debounce_seconds
            ]
            for key in expired_keys:
                del self.pending_deletes[key]
                ready.append(key)
        return ready

    def _process_file(self, path: str) -> None:
        try:
            if not os.path.exists(path):
                return

            doc_id = doc_id_from_path(path)
            current_hash = content_hash_file(path)
            row = self.manifest.get(doc_id)

            if row is None:
                # Unknown file — register as unmanaged, do NOT ingest
                self.manifest.upsert(doc_id, path, current_hash, is_managed=False, status="discovered")
                logger.info("Discovered external file %s — registered as unmanaged", path)
                return

            if not row["is_managed"]:
                # Unmanaged file — skip ingestion
                logger.debug("Skipping unmanaged file %s", path)
                return

            if not self.manifest.needs_reindex(doc_id, current_hash):
                # Hash unchanged — skip
                logger.debug("Skipping unchanged file %s", path)
                return

            with open(path, "r", encoding="utf-8") as f:
                text = f.read()
            doc_name = os.path.splitext(os.path.basename(path))[0]
            ingest_markdown(
                text,
                doc_name,
                shared_kuzu_db=get_kuzu_engine(),
                file_path=path,
            )
            self.manifest.upsert(doc_id, path, current_hash, is_managed=True, status="indexed")
            logger.info("Ingested %s", path)
        except Exception:
            logger.exception("Failed to process %s", path)

    def _process_delete(self, path: str) -> None:
        try:
            doc_id = doc_id_from_path(path)
            deleted = delete_document_chunks("./data/lancedb", doc_id)
            self.manifest.delete(doc_id)
            logger.info("Deleted %d chunks for %s", deleted, path)
        except Exception:
            logger.exception("Failed to process delete for %s", path)

    def _loop(self) -> None:
        while self._running:
            for path in self._drain_ready():
                self._process_file(path)
            for path in self._drain_ready_deletes():
                self._process_delete(path)
            time.sleep(0.5)

    def start(self) -> None:
        if self._running:
            return
        os.makedirs(self.notes_dir, exist_ok=True)
        self._running = True
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        self._start_watchdog()

    def _start_watchdog(self) -> None:
        try:
            from watchdog.events import FileSystemEventHandler
            from watchdog.observers import Observer

            agent = self

            class _Handler(FileSystemEventHandler):
                def on_created(self, event):
                    if not event.is_directory:
                        agent.enqueue(event.src_path)

                def on_modified(self, event):
                    if not event.is_directory:
                        agent.enqueue(event.src_path)

                def on_deleted(self, event):
                    if not event.is_directory:
                        agent.enqueue_delete(event.src_path)

            self._observer = Observer()
            self._observer.schedule(_Handler(), self.notes_dir, recursive=True)
            self._observer.start()
            logger.info("Watchdog observer started for %s", self.notes_dir)
        except ImportError:
            logger.warning("watchdog not installed — file system watching disabled")

    def stop(self) -> None:
        self._running = False
        if self._observer is not None:
            self._observer.stop()
            self._observer.join(timeout=5.0)
            self._observer = None
        if self._thread is not None:
            self._thread.join(timeout=5.0)
