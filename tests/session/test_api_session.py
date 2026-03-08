from unittest.mock import patch

import kuzu
import pytest
from fastapi.testclient import TestClient

from backend.api import app, session_memory
from backend.db.kuzu import init_kuzu as real_init_kuzu
from backend.db.lance import init_lancedb as real_init_lancedb
from tests.conftest import (
    mock_embed_query,
    mock_embed_texts,
    mock_extract_concepts,
    mock_generate_answer,
)

client = TestClient(app)


@pytest.fixture(autouse=True)
def isolate_api_data(monkeypatch, lance_path, kuzu_path):
    real_kuzu_db, _ = real_init_kuzu(kuzu_path)

    monkeypatch.setattr("backend.db.kuzu._db_instance", real_kuzu_db)
    monkeypatch.setattr(
        "backend.ingestion.processor.init_lancedb",
        lambda path="./data/lancedb": real_init_lancedb(lance_path),
    )
    monkeypatch.setattr(
        "backend.retrieval.query.init_lancedb",
        lambda path="./data/lancedb": real_init_lancedb(lance_path),
    )
    monkeypatch.setattr(
        "backend.api.get_kuzu_engine",
        lambda path="./data/kuzu": real_kuzu_db,
    )
    # Clear session memory between tests
    session_memory._sessions.clear()


class TestSessionAwareQuery:
    @patch("backend.ingestion.processor.embed_texts", side_effect=mock_embed_texts)
    @patch("backend.ingestion.processor.extract_concepts", side_effect=mock_extract_concepts)
    def _ingest(self, _mock_ext, _mock_emb):
        client.post("/ingest", json={"text": "Calculus is about derivatives.", "title": "Math"})

    @patch("backend.retrieval.query.generate_answer", side_effect=mock_generate_answer)
    @patch("backend.retrieval.query.embed_query", side_effect=mock_embed_query)
    @patch("backend.ingestion.processor.embed_texts", side_effect=mock_embed_texts)
    @patch("backend.ingestion.processor.extract_concepts", side_effect=mock_extract_concepts)
    def test_query_with_session_id_and_history(self, _e, _t, _q, _g):
        self._ingest()
        response = client.post("/query", json={
            "question": "Tell me more about it",
            "session_id": "test-session-1",
            "history": [
                {"role": "user", "content": "What is calculus?"},
                {"role": "assistant", "content": "Calculus studies change."},
            ],
        })
        assert response.status_code == 200
        assert "answer" in response.json()

    @patch("backend.retrieval.query.generate_answer", side_effect=mock_generate_answer)
    @patch("backend.retrieval.query.embed_query", side_effect=mock_embed_query)
    @patch("backend.ingestion.processor.embed_texts", side_effect=mock_embed_texts)
    @patch("backend.ingestion.processor.extract_concepts", side_effect=mock_extract_concepts)
    def test_session_turns_are_stored(self, _e, _t, _q, _g):
        self._ingest()
        client.post("/query", json={
            "question": "What is calculus?",
            "session_id": "test-session-2",
            "history": [],
        })
        turns = session_memory.get_turns("test-session-2")
        # Should have user turn + assistant turn
        assert len(turns) == 2
        assert turns[0].role == "user"
        assert turns[0].content == "What is calculus?"
        assert turns[1].role == "assistant"

    @patch("backend.retrieval.query.generate_answer", side_effect=mock_generate_answer)
    @patch("backend.retrieval.query.embed_query", side_effect=mock_embed_query)
    def test_query_without_session_id_still_works(self, _q, _g):
        response = client.post("/query", json={"question": "Hello"})
        assert response.status_code == 200

    @patch("backend.retrieval.query.generate_answer", side_effect=mock_generate_answer)
    @patch("backend.retrieval.query.embed_query", side_effect=mock_embed_query)
    @patch("backend.ingestion.processor.embed_texts", side_effect=mock_embed_texts)
    @patch("backend.ingestion.processor.extract_concepts", side_effect=mock_extract_concepts)
    def test_sessions_are_isolated(self, _e, _t, _q, _g):
        self._ingest()
        client.post("/query", json={
            "question": "From session A",
            "session_id": "session-a",
            "history": [],
        })
        client.post("/query", json={
            "question": "From session B",
            "session_id": "session-b",
            "history": [],
        })
        turns_a = session_memory.get_turns("session-a")
        turns_b = session_memory.get_turns("session-b")
        assert all(t.content != "From session B" for t in turns_a)
        assert all(t.content != "From session A" for t in turns_b)
