import os
import threading
import time
from unittest.mock import MagicMock, patch

import pytest

from backend.services.sync_agent import (
    DEBOUNCE_SECONDS,
    WATCHED_EXTENSIONS,
    SyncAgent,
)


@pytest.fixture
def notes_dir(tmp_path):
    return str(tmp_path / "notes")


class TestSyncAgentDebounce:
    def test_enqueue_sets_pending_file(self, notes_dir):
        agent = SyncAgent(notes_dir=notes_dir, auto_start=False)
        path = os.path.join(notes_dir, "test.md")

        agent.enqueue(path)

        assert path in agent.pending

    def test_enqueue_updates_timestamp_on_repeat(self, notes_dir):
        agent = SyncAgent(notes_dir=notes_dir, auto_start=False)
        path = os.path.join(notes_dir, "test.md")

        agent.enqueue(path)
        first_ts = agent.pending[path]

        time.sleep(0.05)
        agent.enqueue(path)
        second_ts = agent.pending[path]

        assert second_ts > first_ts

    def test_drain_ignores_files_within_debounce_window(self, notes_dir):
        agent = SyncAgent(notes_dir=notes_dir, auto_start=False)
        path = os.path.join(notes_dir, "test.md")

        agent.enqueue(path)
        ready = agent._drain_ready()

        assert ready == []
        assert path in agent.pending

    def test_drain_returns_files_past_debounce_window(self, notes_dir):
        agent = SyncAgent(notes_dir=notes_dir, auto_start=False, debounce_seconds=0.0)
        path = os.path.join(notes_dir, "test.md")

        agent.enqueue(path)
        time.sleep(0.01)
        ready = agent._drain_ready()

        assert ready == [path]
        assert path not in agent.pending

    def test_enqueue_delete_marks_file_for_deletion(self, notes_dir):
        agent = SyncAgent(notes_dir=notes_dir, auto_start=False)
        path = os.path.join(notes_dir, "test.md")

        agent.enqueue_delete(path)

        assert path in agent.pending_deletes


class TestSyncAgentProcessing:
    @patch("backend.services.sync_agent.ingest_markdown")
    @patch("backend.services.sync_agent.get_kuzu_engine")
    def test_process_file_calls_ingest_for_managed_file(self, mock_kuzu, mock_ingest, notes_dir):
        mock_kuzu.return_value = MagicMock()
        mock_ingest.return_value = {"doc_id": "abc", "chunks": 1, "concepts": []}

        agent = SyncAgent(notes_dir=notes_dir, auto_start=False)
        path = os.path.join(notes_dir, "calculus.md")
        with open(path, "w") as f:
            f.write("# Calculus\nDerivatives and integrals.")

        # Register as managed in the manifest
        from backend.ingestion.processor import doc_id_from_path
        from backend.services.notes_fs import content_hash_file
        doc_id = doc_id_from_path(path)
        agent.manifest.upsert(doc_id, path, content_hash_file(path), is_managed=True)

        # Change content so hash differs
        with open(path, "w") as f:
            f.write("# Calculus\nDerivatives and integrals. Updated.")
        agent._process_file(path)

        mock_ingest.assert_called_once()
        call_kwargs = mock_ingest.call_args
        assert call_kwargs[1]["file_path"] == path
        assert "Updated" in call_kwargs[0][0]

    @patch("backend.services.sync_agent.ingest_markdown")
    @patch("backend.services.sync_agent.get_kuzu_engine")
    def test_process_file_skips_unmanaged_file(self, mock_kuzu, mock_ingest, notes_dir):
        mock_kuzu.return_value = MagicMock()

        agent = SyncAgent(notes_dir=notes_dir, auto_start=False)
        path = os.path.join(notes_dir, "external.md")
        with open(path, "w") as f:
            f.write("# External note")

        agent._process_file(path)

        # File unknown to manifest → registered as unmanaged, NOT ingested
        mock_ingest.assert_not_called()
        from backend.ingestion.processor import doc_id_from_path
        row = agent.manifest.get(doc_id_from_path(path))
        assert row is not None
        assert row["is_managed"] is False

    @patch("backend.services.sync_agent.ingest_markdown")
    @patch("backend.services.sync_agent.get_kuzu_engine")
    def test_process_file_skips_unchanged_hash(self, mock_kuzu, mock_ingest, notes_dir):
        mock_kuzu.return_value = MagicMock()

        agent = SyncAgent(notes_dir=notes_dir, auto_start=False)
        path = os.path.join(notes_dir, "stable.md")
        with open(path, "w") as f:
            f.write("# Stable content")

        from backend.ingestion.processor import doc_id_from_path
        from backend.services.notes_fs import content_hash_file
        doc_id = doc_id_from_path(path)
        agent.manifest.upsert(doc_id, path, content_hash_file(path), is_managed=True)

        # Process same file with same content — should skip
        agent._process_file(path)
        mock_ingest.assert_not_called()

    @patch("backend.services.sync_agent.delete_document_chunks")
    @patch("backend.services.sync_agent.doc_id_from_path")
    def test_process_delete_calls_delete_document_chunks(self, mock_id, mock_delete, notes_dir):
        mock_id.return_value = "abc123"
        mock_delete.return_value = 2

        agent = SyncAgent(notes_dir=notes_dir, auto_start=False)
        path = os.path.join(notes_dir, "old.md")

        # Register in manifest so delete cleans it up
        agent.manifest.upsert("abc123", path, "hash", is_managed=True)

        agent._process_delete(path)

        mock_id.assert_called_once_with(path)
        mock_delete.assert_called_once()
        assert agent.manifest.get("abc123") is None


class TestSyncAgentWatchedExtensions:
    def test_watched_extensions_include_md_and_txt(self):
        assert ".md" in WATCHED_EXTENSIONS
        assert ".txt" in WATCHED_EXTENSIONS

    def test_non_watched_extension_ignored(self, notes_dir):
        agent = SyncAgent(notes_dir=notes_dir, auto_start=False)
        path = os.path.join(notes_dir, "image.png")

        agent.enqueue(path)

        assert path not in agent.pending


class TestSyncAgentLifecycle:
    def test_start_and_stop(self, notes_dir):
        agent = SyncAgent(notes_dir=notes_dir, auto_start=False, debounce_seconds=0.1)
        agent.start()

        assert agent._running
        assert agent._thread is not None
        assert agent._thread.is_alive()

        agent.stop()

        assert not agent._running
        agent._thread.join(timeout=2.0)
        assert not agent._thread.is_alive()
