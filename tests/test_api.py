from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.api import app
from tests.conftest import (
    mock_embed_query,
    mock_embed_texts,
    mock_extract_concepts,
    mock_generate_answer,
)

client = TestClient(app)


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
        assert "discovery_concepts" in data

    def test_query_missing_fields(self):
        response = client.post("/query", json={})
        assert response.status_code == 422
