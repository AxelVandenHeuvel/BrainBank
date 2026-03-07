from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.api import app
from tests.conftest import (
    mock_embed_texts,
    mock_extract_concepts,
)

client = TestClient(app)


def _ingest_sample():
    """Helper to ingest sample data via the API."""
    with (
        patch("backend.ingestion.processor.embed_texts", side_effect=mock_embed_texts),
        patch(
            "backend.ingestion.processor.extract_concepts",
            side_effect=mock_extract_concepts,
        ),
    ):
        client.post(
            "/ingest",
            json={
                "text": "Calculus is about Derivatives and Integrals.",
                "title": "Math Notes",
            },
        )


class TestGetGraph:
    def test_response_structure(self):
        response = client.get("/api/graph")
        assert response.status_code == 200
        data = response.json()
        assert "nodes" in data
        assert "edges" in data
        assert isinstance(data["nodes"], list)
        assert isinstance(data["edges"], list)

    def test_returns_nodes_after_ingest(self):
        _ingest_sample()
        response = client.get("/api/graph")
        data = response.json()
        assert len(data["nodes"]) > 0
        node_types = {n["type"] for n in data["nodes"]}
        assert "Concept" in node_types
        assert "Document" in node_types

    def test_returns_edges_after_ingest(self):
        _ingest_sample()
        response = client.get("/api/graph")
        data = response.json()
        assert len(data["edges"]) > 0
        edge_types = {e["type"] for e in data["edges"]}
        assert "MENTIONS" in edge_types

    def test_node_shape(self):
        _ingest_sample()
        response = client.get("/api/graph")
        node = response.json()["nodes"][0]
        assert "id" in node
        assert "type" in node
        assert "name" in node

    def test_edge_shape(self):
        _ingest_sample()
        response = client.get("/api/graph")
        edge = response.json()["edges"][0]
        assert "source" in edge
        assert "target" in edge
        assert "type" in edge


class TestGetConcepts:
    def test_response_structure(self):
        response = client.get("/api/concepts")
        assert response.status_code == 200
        data = response.json()
        assert "concepts" in data
        assert isinstance(data["concepts"], list)

    def test_concept_shape_after_ingest(self):
        _ingest_sample()
        response = client.get("/api/concepts")
        data = response.json()
        assert len(data["concepts"]) > 0
        concept = data["concepts"][0]
        assert "name" in concept
        assert "document_count" in concept
        assert "related_concepts" in concept
        assert isinstance(concept["document_count"], int)
        assert isinstance(concept["related_concepts"], list)


class TestGetDocuments:
    def test_response_structure(self):
        response = client.get("/api/documents")
        assert response.status_code == 200
        data = response.json()
        assert "documents" in data
        assert isinstance(data["documents"], list)

    def test_document_shape_after_ingest(self):
        _ingest_sample()
        response = client.get("/api/documents")
        data = response.json()
        assert len(data["documents"]) > 0
        doc = data["documents"][0]
        assert "doc_id" in doc
        assert "name" in doc
        assert "chunk_count" in doc
        assert "concepts" in doc
        assert isinstance(doc["chunk_count"], int)
        assert isinstance(doc["concepts"], list)


class TestGetStats:
    def test_response_structure(self):
        response = client.get("/api/stats")
        assert response.status_code == 200
        data = response.json()
        assert "total_documents" in data
        assert "total_chunks" in data
        assert "total_concepts" in data
        assert "total_relationships" in data
        assert all(isinstance(v, int) for v in data.values())

    def test_counts_after_ingest(self):
        _ingest_sample()
        response = client.get("/api/stats")
        data = response.json()
        assert data["total_documents"] >= 1
        assert data["total_chunks"] >= 1
        assert data["total_concepts"] >= 1
        assert data["total_relationships"] >= 1
