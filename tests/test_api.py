from unittest.mock import patch

import kuzu
import pytest
from fastapi.testclient import TestClient

from backend.api import app
from backend.db.kuzu import init_kuzu as real_init_kuzu
from backend.db.lance import init_lancedb as real_init_lancedb
from tests.conftest import (
    mock_embed_query,
    mock_embed_texts,
    mock_extract_concepts,
    mock_generate_answer,
)

client = TestClient(app)

def test_initializes_kuzu_engine_on_startup(monkeypatch):
    calls = []

    def fake_get_kuzu_engine():
        calls.append(1)
        return None

    monkeypatch.setattr("backend.api.get_kuzu_engine", fake_get_kuzu_engine)

    with TestClient(app):
        pass

    assert len(calls) == 1



@pytest.fixture(autouse=True)
def isolate_api_data(monkeypatch, lance_path, kuzu_path):
    real_kuzu_db, _ = real_init_kuzu(kuzu_path)

    # Route the global Kuzu engine to the isolated test DB so that both the
    # ingest endpoint (which calls get_kuzu_engine()) and the query endpoint
    # use the same temporary database.
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


class TestIngestEndpoint:
    @patch("backend.ingestion.processor.embed_texts", side_effect=mock_embed_texts)
    @patch("backend.ingestion.processor.extract_concepts", side_effect=mock_extract_concepts)
    def test_ingest_success(self, _mock_llm, _mock_emb):
        response = client.post(
            "/ingest",
            json={"text": "Calculus is about derivatives.", "title": "Math"},
        )
        assert response.status_code == 200
        data = response.json()
        assert "doc_id" in data
        assert "chunks" in data
        assert "concepts" in data

    def test_ingest_missing_fields(self):
        response = client.post("/ingest", json={"text": "hello"})
        assert response.status_code == 422


class TestQueryEndpoint:
    @patch("backend.retrieval.query.generate_answer", side_effect=mock_generate_answer)
    @patch("backend.retrieval.query.embed_query", side_effect=mock_embed_query)
    @patch("backend.ingestion.processor.embed_texts", side_effect=mock_embed_texts)
    @patch("backend.ingestion.processor.extract_concepts", side_effect=mock_extract_concepts)
    def test_query_success(self, _mock_ext, _mock_emb_t, _mock_emb_q, _mock_gen):
        client.post(
            "/ingest",
            json={"text": "Calculus is about derivatives.", "title": "Math"},
        )
        response = client.post("/query", json={"question": "What is calculus?"})
        assert response.status_code == 200
        data = response.json()
        assert "answer" in data
        assert "source_concepts" in data
        assert "discovery_concepts" in data
        assert "source_documents" in data
        assert "discovery_documents" in data
        assert "source_chunks" in data
        assert "discovery_chunks" in data
        assert "supporting_relationships" in data

    def test_query_missing_fields(self):
        response = client.post("/query", json={})
        assert response.status_code == 422


class TestLlmTestEndpoint:
    @patch("backend.api.generate_test_answer", return_value="Direct Gemini response")
    def test_llm_test_route_returns_answer_without_database(self, mock_generate):
        response = client.post(
            "/query/test-llm",
            json={"question": "Can you hear me?"},
        )

        assert response.status_code == 200
        assert response.json() == {
            "answer": "Direct Gemini response",
            "source_concepts": [],
            "discovery_concepts": [],
            "source_documents": [],
            "discovery_documents": [],
            "source_chunks": [],
            "discovery_chunks": [],
            "supporting_relationships": [],
            "mode": "llm_test",
        }
        mock_generate.assert_called_once_with("Can you hear me?")

    def test_llm_test_route_requires_question(self):
        response = client.post("/query/test-llm", json={})
        assert response.status_code == 422


class TestDemoSeedEndpoint:
    @patch(
        "backend.api.seed_mock_demo_data",
        return_value={
            "seeded_documents": 84,
            "skipped_documents": 0,
            "total_concepts": 98,
            "community_summaries": 12,
        },
    )
    def test_demo_seed_uses_shared_kuzu_engine(self, mock_seed, monkeypatch):
        shared_db, conn = real_init_kuzu("/tmp/test-api-demo-seed-kuzu")
        conn.close()
        monkeypatch.setattr(
            "backend.api.get_kuzu_engine",
            lambda path="./data/kuzu": shared_db,
        )

        response = client.post("/ingest/demo/mock")

        assert response.status_code == 200
        assert response.json()["seeded_documents"] == 84
        mock_seed.assert_called_once_with(shared_kuzu_db=shared_db)
        shared_db.close()
