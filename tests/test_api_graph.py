from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from backend.api import app
from backend.db.kuzu import init_kuzu as real_init_kuzu
from backend.db.lance import init_lancedb as real_init_lancedb
from tests.conftest import (
    mock_embed_texts,
    mock_extract_concepts,
)

client = TestClient(app)


@pytest.fixture(autouse=True)
def isolate_graph_data(monkeypatch, lance_path, kuzu_path):
    # init_kuzu initialises schema and returns (db, conn); we only need the db.
    real_kuzu_db, _ = real_init_kuzu(kuzu_path)

    # Route all per-request Kuzu connections to the isolated test DB.
    # get_db_connection() calls get_kuzu_engine() which reads _db_instance at
    # call time, so patching the module-level variable is sufficient.
    monkeypatch.setattr("backend.db.kuzu._db_instance", real_kuzu_db)

    # Patch init_lancedb in api_graph so every per-call open returns the test
    # table (a fresh handle each time, always reflecting the latest writes).
    monkeypatch.setattr(
        "backend.api_graph.init_lancedb",
        lambda: real_init_lancedb(lance_path),
    )

    # Route ingest writes (LanceDB) to the same isolated test path.
    # Kuzu ingest already uses get_kuzu_engine() which returns real_kuzu_db above.
    monkeypatch.setattr(
        "backend.ingestion.processor.init_lancedb",
        lambda path="./data/lancedb": real_init_lancedb(lance_path),
    )


def _ingest_sample():
    """Helper to ingest sample data via the API."""
    with (
        patch("backend.ingestion.processor.embed_texts", side_effect=mock_embed_texts),
        patch(
            "backend.ingestion.processor.extract_concepts",
            side_effect=mock_extract_concepts,
        ),
        patch("backend.ingestion.processor.calculate_color_score", return_value=0.5),
    ):
        client.post(
            "/ingest",
            json={
                "text": "Calculus is about Derivatives and Integrals.",
                "title": "Math Notes",
            },
        )


def _ingest_document(title: str, text: str, extraction: dict):
    with (
        patch("backend.ingestion.processor.embed_texts", side_effect=mock_embed_texts),
        patch(
            "backend.ingestion.processor.extract_concepts",
            return_value=extraction,
        ),
    ):
        client.post(
            "/ingest",
            json={
                "text": text,
                "title": title,
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

    def test_returns_edges_after_ingest(self):
        _ingest_sample()
        response = client.get("/api/graph")
        data = response.json()
        assert len(data["edges"]) > 0

    def test_node_shape(self):
        _ingest_sample()
        response = client.get("/api/graph")
        node = response.json()["nodes"][0]
        assert "id" in node
        assert "type" in node
        assert "name" in node

    def test_node_has_color_score(self):
        _ingest_sample()
        response = client.get("/api/graph")
        node = response.json()["nodes"][0]
        assert "colorScore" in node
        assert isinstance(node["colorScore"], float)
        assert 0.0 <= node["colorScore"] <= 1.0

    def test_edge_shape(self):
        _ingest_sample()
        response = client.get("/api/graph")
        edge = response.json()["edges"][0]
        assert "source" in edge
        assert "target" in edge
        assert "type" in edge
        assert "weight" in edge

    def test_related_edges_use_stable_type_and_reason(self):
        _ingest_sample()
        response = client.get("/api/graph")
        edges = response.json()["edges"]

        related_edge = next(
            edge for edge in edges if edge["source"] == "concept:Calculus" and edge["target"] == "concept:Derivatives"
        )

        assert related_edge["type"] == "RELATED_TO"
        assert related_edge["reason"] == "shared_document"
        assert related_edge["weight"] == 1.0

    def test_related_edge_weight_increases_across_documents(self):
        _ingest_document(
            title="Doc One",
            text="Calculus and Derivatives both appear here.",
            extraction={"concepts": ["Calculus", "Derivatives"], "relationships": []},
        )
        _ingest_document(
            title="Doc Two",
            text="Calculus and Derivatives appear again.",
            extraction={"concepts": ["Calculus", "Derivatives"], "relationships": []},
        )

        response = client.get("/api/graph")
        edges = response.json()["edges"]
        related_edge = next(
            edge for edge in edges if edge["source"] == "concept:Calculus" and edge["target"] == "concept:Derivatives"
        )

        assert related_edge["weight"] == 2.0


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


class TestGetConceptDocuments:
    def test_unknown_concept_returns_empty_list(self):
        response = client.get("/api/concepts/NonExistentConcept/documents")
        assert response.status_code == 200
        assert response.json() == []

    def test_returns_documents_after_ingest(self):
        _ingest_sample()
        response = client.get("/api/concepts/Calculus/documents")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) > 0

    def test_document_shape(self):
        _ingest_sample()
        response = client.get("/api/concepts/Calculus/documents")
        doc = response.json()[0]
        assert "doc_id" in doc
        assert "name" in doc
        assert "full_text" in doc
        assert isinstance(doc["doc_id"], str)
        assert isinstance(doc["name"], str)
        assert isinstance(doc["full_text"], str)

    def test_full_text_contains_document_content(self):
        _ingest_sample()
        response = client.get("/api/concepts/Calculus/documents")
        doc = response.json()[0]
        assert len(doc["full_text"]) > 0
        assert doc["name"] == "Math Notes"

    def test_deduplicates_documents(self):
        _ingest_sample()
        _ingest_sample()
        response = client.get("/api/concepts/Calculus/documents")
        data = response.json()
        doc_ids = [d["doc_id"] for d in data]
        assert len(doc_ids) == len(set(doc_ids))


class TestGetRelationshipDetails:
    def test_returns_documents_for_a_known_relationship(self):
        _ingest_document(
            title="Shared Math Notes",
            text="Calculus and Derivatives both appear here.",
            extraction={
                "concepts": ["Calculus", "Derivatives"],
                "relationships": [
                    {
                        "from": "Calculus",
                        "to": "Derivatives",
                        "relationship": "shared foundation",
                    }
                ],
            },
        )
        _ingest_document(
            title="Calculus Only Notes",
            text="Calculus appears here by itself.",
            extraction={
                "concepts": ["Calculus"],
                "relationships": [],
            },
        )
        _ingest_document(
            title="Derivatives Only Notes",
            text="Derivatives appears here by itself.",
            extraction={
                "concepts": ["Derivatives"],
                "relationships": [],
            },
        )

        response = client.get(
            "/api/relationships/details",
            params={"source": "Calculus", "target": "Derivatives"},
        )

        assert response.status_code == 200
        data = response.json()

        assert data["source"] == "Calculus"
        assert data["target"] == "Derivatives"
        assert data["type"] == "RELATED_TO"
        assert data["reason"] == "shared_document"

        source_names = {document["name"] for document in data["source_documents"]}
        target_names = {document["name"] for document in data["target_documents"]}

        assert "Shared Math Notes" in source_names
        assert "Shared Math Notes" in target_names
        assert "Calculus Only Notes" in source_names
        assert "Derivatives Only Notes" in target_names

    def test_returns_404_for_unknown_relationship(self):
        response = client.get(
            "/api/relationships/details",
            params={"source": "Unknown", "target": "Missing"},
        )

        assert response.status_code == 404

    def test_returns_relationship_details_for_reverse_direction(self):
        _ingest_document(
            title="Reverse Direction Notes",
            text="Calculus and Derivatives are connected.",
            extraction={
                "concepts": ["Calculus", "Derivatives"],
                "relationships": [
                    {
                        "from": "Calculus",
                        "to": "Derivatives",
                        "relationship": "shared foundation",
                    }
                ],
            },
        )

        response = client.get(
            "/api/relationships/details",
            params={"source": "Derivatives", "target": "Calculus"},
        )

        assert response.status_code == 200
        data = response.json()

        assert data["source"] == "Derivatives"
        assert data["target"] == "Calculus"
        assert data["type"] == "RELATED_TO"
        assert data["reason"] == "shared_document"

    def test_shared_document_ids_only_include_overlap(self):
        _ingest_document(
            title="Shared Edge Evidence",
            text="Calculus and Derivatives both appear here again.",
            extraction={
                "concepts": ["Calculus", "Derivatives"],
                "relationships": [
                    {
                        "from": "Calculus",
                        "to": "Derivatives",
                        "relationship": "shared evidence",
                    }
                ],
            },
        )
        _ingest_document(
            title="Calculus Solo Evidence",
            text="Calculus appears without the other concept.",
            extraction={
                "concepts": ["Calculus"],
                "relationships": [],
            },
        )
        _ingest_document(
            title="Derivatives Solo Evidence",
            text="Derivatives appears without the other concept.",
            extraction={
                "concepts": ["Derivatives"],
                "relationships": [],
            },
        )

        response = client.get(
            "/api/relationships/details",
            params={"source": "Calculus", "target": "Derivatives"},
        )

        assert response.status_code == 200
        data = response.json()

        source_documents = {
            document["doc_id"]: document["name"] for document in data["source_documents"]
        }
        target_documents = {
            document["doc_id"]: document["name"] for document in data["target_documents"]
        }

        shared_names = {
            source_documents[doc_id]
            for doc_id in data["shared_document_ids"]
            if doc_id in source_documents
        }

        assert shared_names == {
            "Shared Math Notes",
            "Shared Edge Evidence",
        } or shared_names == {"Shared Edge Evidence"}
        assert "Calculus Solo Evidence" not in shared_names
        assert "Derivatives Solo Evidence" not in shared_names
        assert set(data["shared_document_ids"]).issubset(source_documents)
        assert set(data["shared_document_ids"]).issubset(target_documents)


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
