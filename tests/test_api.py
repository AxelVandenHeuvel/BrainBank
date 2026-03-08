from unittest.mock import patch

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


@pytest.fixture(autouse=True)
def isolate_api_data(monkeypatch, lance_path, kuzu_path):
    monkeypatch.setattr(
        "backend.ingestion.processor.init_lancedb",
        lambda path="./data/lancedb": real_init_lancedb(lance_path),
    )
    monkeypatch.setattr(
        "backend.ingestion.processor.init_kuzu",
        lambda path="./data/kuzu": real_init_kuzu(kuzu_path),
    )
    monkeypatch.setattr(
        "backend.retrieval.query.init_lancedb",
        lambda path="./data/lancedb": real_init_lancedb(lance_path),
    )
    monkeypatch.setattr(
        "backend.retrieval.query.init_kuzu",
        lambda path="./data/kuzu": real_init_kuzu(kuzu_path),
    )


class TestIngestEndpoint:
    @patch("backend.ingestion.processor.embed_texts", side_effect=mock_embed_texts)
    @patch("backend.ingestion.processor.extract_concepts", side_effect=mock_extract_concepts)
    def test_ingest_success(self, mock_llm, mock_emb):
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
    def test_query_success(self, mock_ext, mock_emb_t, mock_emb_q, mock_gen):
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
            "discovery_concepts": [],
            "mode": "llm_test",
        }
        mock_generate.assert_called_once_with("Can you hear me?")

    def test_llm_test_route_requires_question(self):
        response = client.post("/query/test-llm", json={})
        assert response.status_code == 422
