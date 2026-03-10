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

LANCE_PATH_HOLDER = {"path": None}

client = TestClient(app)


@pytest.fixture(autouse=True)
def isolate_graph_data(monkeypatch, lance_path, kuzu_path, tmp_path):
    # init_kuzu initialises schema and returns (db, conn); we only need the db.
    real_kuzu_db, _ = real_init_kuzu(kuzu_path)

    # Store lance_path so update-document tests can verify data directly.
    LANCE_PATH_HOLDER["path"] = lance_path

    # Use an isolated temp notes directory for file-system document tests.
    notes_dir = str(tmp_path / "notes")
    monkeypatch.setattr("backend.api_graph.get_notes_dir", lambda: notes_dir)

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

    # Route delete_document_chunks to use the isolated test path.
    from backend.db.lance import delete_document_chunks as real_delete
    monkeypatch.setattr(
        "backend.api_graph.delete_document_chunks",
        lambda db_path, doc_id: real_delete(lance_path, doc_id),
    )

    # Route ingest_markdown in api_graph to use the isolated test path.
    from backend.ingestion.processor import ingest_markdown as real_ingest
    monkeypatch.setattr(
        "backend.api_graph.ingest_markdown",
        lambda text, title, shared_kuzu_db=None, doc_id=None, file_path=None: real_ingest(
            text, title, lance_db_path=lance_path, shared_kuzu_db=shared_kuzu_db, doc_id=doc_id, file_path=file_path,
        ),
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

    def test_node_has_community_id(self):
        _ingest_sample()
        response = client.get("/api/graph")
        node = response.json()["nodes"][0]
        assert "community_id" in node
        assert isinstance(node["community_id"], (int, type(None)))

    def test_existing_concepts_receive_community_id_after_recluster(self):
        """Pre-existing concepts (community_id = -1) get real IDs after recluster."""
        _ingest_sample()

        # Force community_id back to -1 to simulate a pre-migration database.
        import kuzu as _kuzu
        from backend.db.kuzu import get_kuzu_engine
        db = get_kuzu_engine()
        conn = _kuzu.Connection(db)
        conn.execute("MATCH (c:Concept) SET c.community_id = -1")
        conn.close()

        # Trigger recluster endpoint.
        response = client.post("/api/recluster")
        assert response.status_code == 200

        # All nodes should now have a real community_id.
        graph = client.get("/api/graph").json()
        concept_nodes = [n for n in graph["nodes"] if n["type"] == "Concept"]
        assert all(n["community_id"] is not None for n in concept_nodes)

    def test_semantic_bridge_edges_returned_with_correct_type(self):
        """Edges inserted by heal_graph should surface as SEMANTIC_BRIDGE in the API."""
        _ingest_sample()
        # Directly insert a SEMANTIC_BRIDGE edge via the DB.
        import kuzu as _kuzu
        from backend.db.kuzu import get_kuzu_engine
        db = get_kuzu_engine()
        conn = _kuzu.Connection(db)
        conn.execute(
            "MATCH (a:Concept {name: 'Calculus'}), (b:Concept {name: 'Integrals'}) "
            "CREATE (a)-[:RELATED_TO {reason: 'High semantic similarity discovered via embeddings', "
            "weight: 0.95, edge_type: 'SEMANTIC_BRIDGE'}]->(b)"
        )
        conn.close()

        response = client.get("/api/graph")
        edges = response.json()["edges"]
        bridge_edges = [e for e in edges if e["type"] == "SEMANTIC_BRIDGE"]
        assert len(bridge_edges) >= 1
        assert bridge_edges[0]["weight"] == pytest.approx(0.95, abs=1e-6)

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

    def test_all_graph_edges_return_numeric_weight(self):
        _ingest_sample()
        response = client.get("/api/graph")
        edges = response.json()["edges"]

        assert len(edges) > 0
        assert all(isinstance(edge.get("weight"), (int, float)) for edge in edges)


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

class TestGetLatentDiscovery:
    def test_returns_top_five_similar_documents_excluding_existing_concept_docs(self, lance_path):
        db, chunks = real_init_lancedb(lance_path)
        centroids = db.open_table("document_centroids")

        base_vector = [1.0] + [0.0] * 383

        chunks.add(
            [
                {
                    "chunk_id": "c1",
                    "doc_id": "doc-calc",
                    "doc_name": "Calculus Core",
                    "text": "Calculus basics",
                    "concepts": ["Calculus"],
                    "vector": base_vector,
                }
            ]
        )

        centroids.add(
            [
                {"doc_id": "doc-calc", "doc_name": "Calculus Core", "centroid_vector": base_vector},
                {"doc_id": "doc-1", "doc_name": "Doc 1", "centroid_vector": [1.00] + [0.0] * 383},
                {"doc_id": "doc-2", "doc_name": "Doc 2", "centroid_vector": [0.99] + [0.0] * 383},
                {"doc_id": "doc-3", "doc_name": "Doc 3", "centroid_vector": [0.98] + [0.0] * 383},
                {"doc_id": "doc-4", "doc_name": "Doc 4", "centroid_vector": [0.97] + [0.0] * 383},
                {"doc_id": "doc-5", "doc_name": "Doc 5", "centroid_vector": [0.96] + [0.0] * 383},
                {"doc_id": "doc-6", "doc_name": "Doc 6", "centroid_vector": [0.95] + [0.0] * 383},
            ]
        )

        response = client.get("/api/discovery/latent/Calculus")
        assert response.status_code == 200

        data = response.json()
        assert data["concept_name"] == "Calculus"
        assert len(data["results"]) == 5
        assert all(item["doc_name"] != "Calculus Core" for item in data["results"])
        assert all("doc_name" in item and "similarity_score" in item for item in data["results"])
        assert all(isinstance(item["similarity_score"], float) for item in data["results"])

    def test_returns_empty_results_when_concept_is_missing(self):
        response = client.get("/api/discovery/latent/NonExistent")
        assert response.status_code == 200
        data = response.json()
        assert data["concept_name"] == "NonExistent"
        assert data["results"] == []


class TestUpdateDocument:
    def test_create_document_returns_doc_id(self):
        resp = client.post(
            "/api/documents",
            json={"text": "", "title": "Short draft"},
        )

        assert resp.status_code == 200
        data = resp.json()
        assert "doc_id" in data
        assert data["status"] == "saved"

    def test_create_document_writes_file_and_lists_document(self):
        resp = client.post(
            "/api/documents",
            json={"text": "", "title": "Short draft"},
        )
        doc_id = resp.json()["doc_id"]

        listing = client.get("/api/documents")

        assert listing.status_code == 200
        docs = listing.json()["documents"]
        matching = [doc for doc in docs if doc["doc_id"] == doc_id]
        assert len(matching) == 1
        assert matching[0]["name"] == "Short draft"

    def test_create_document_with_text_writes_to_disk(self):
        """POST /api/documents with text should save to disk (ingestion happens via watcher)."""
        resp = client.post(
            "/api/documents",
            json={"text": "Calculus is about Derivatives.", "title": "Math Notes"},
        )

        assert resp.status_code == 200
        data = resp.json()
        assert "doc_id" in data
        assert data["status"] == "saved"

    def test_get_document_returns_full_text_from_disk(self):
        create = client.post(
            "/api/documents",
            json={"text": "Some content here.", "title": "Disk Note"},
        )
        doc_id = create.json()["doc_id"]

        resp = client.get(f"/api/documents/{doc_id}")

        assert resp.status_code == 200
        data = resp.json()
        assert data["doc_id"] == doc_id
        assert data["name"] == "Disk Note"
        assert data["full_text"] == "Some content here."

    def _ingest_and_get_doc_id(self, title="Math Notes", text="Calculus is about Derivatives and Integrals."):
        """Ingest a document and return its doc_id."""
        with (
            patch("backend.ingestion.processor.embed_texts", side_effect=mock_embed_texts),
            patch("backend.ingestion.processor.extract_concepts", side_effect=mock_extract_concepts),
            patch("backend.ingestion.processor.calculate_color_score", return_value=0.5),
        ):
            resp = client.post("/ingest", json={"text": text, "title": title})
        return resp.json()["doc_id"]

    def test_save_returns_doc_id(self):
        """PUT should save text to disk and return doc_id."""
        resp = client.post(
            "/api/documents",
            json={"text": "Initial.", "title": "Test Doc"},
        )
        doc_id = resp.json()["doc_id"]

        resp = client.put(
            f"/api/documents/{doc_id}",
            json={"text": "Updated content.", "title": "Test Doc"},
        )

        assert resp.status_code == 200
        data = resp.json()
        assert data["doc_id"] == doc_id
        assert data["status"] == "saved"

    def test_save_updates_text_on_disk(self):
        """After PUT, GET should return updated text from disk."""
        resp = client.post(
            "/api/documents",
            json={"text": "Original.", "title": "Update Test"},
        )
        doc_id = resp.json()["doc_id"]

        client.put(
            f"/api/documents/{doc_id}",
            json={"text": "Biology is about Cells.", "title": "Update Test"},
        )

        resp = client.get(f"/api/documents/{doc_id}")
        assert resp.status_code == 200
        assert resp.json()["full_text"] == "Biology is about Cells."

    def test_reingest_returns_concepts(self):
        """POST reingest should run full pipeline and return concepts."""
        doc_id = self._ingest_and_get_doc_id()

        with (
            patch("backend.ingestion.processor.embed_texts", side_effect=mock_embed_texts),
            patch("backend.ingestion.processor.extract_concepts", return_value={
                "concepts": ["Chemistry", "Atoms"],
                "relationships": [],
            }),
            patch("backend.ingestion.processor.calculate_color_score", return_value=0.5),
        ):
            resp = client.post(
                f"/api/documents/{doc_id}/reingest",
                json={"text": "Chemistry is about Atoms.", "title": "Chem Notes"},
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["doc_id"] == doc_id
        assert "Chemistry" in data["concepts"]
        assert "Atoms" in data["concepts"]


class TestAdoptDocument:
    def test_adopt_sets_managed_and_triggers_ingest(self):
        """Adopting an unmanaged file should set is_managed=True and ingest."""
        # Simulate an external file discovered by the watcher
        from backend.db.manifest import Manifest
        from backend.services.notes_fs import write_note
        from backend.ingestion.processor import doc_id_from_path

        notes_dir_holder = {}

        # Get the test's notes_dir via a create call
        resp = client.post("/api/documents", json={"text": "", "title": "_probe"})
        assert resp.status_code == 200
        # The notes_dir is wherever _probe.md was written — derive from doc_id
        # Instead, let's write an external file and register it as unmanaged
        import os
        # find the notes dir from the monkeypatched get_notes_dir
        from backend.api_graph import get_notes_dir
        nd = get_notes_dir()

        path = write_note(nd, "External Note", "# External\nSome external content.")
        did = doc_id_from_path(path)
        manifest = Manifest(nd)
        manifest.upsert(did, path, "somehash", is_managed=False, status="discovered")
        manifest.close()

        with (
            patch("backend.ingestion.processor.embed_texts", side_effect=mock_embed_texts),
            patch("backend.ingestion.processor.extract_concepts", side_effect=mock_extract_concepts),
            patch("backend.ingestion.processor.calculate_color_score", return_value=0.5),
        ):
            resp = client.post(f"/api/documents/{did}/adopt")

        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "adopted"
        assert data["doc_id"] == did

        # Verify manifest now shows managed
        manifest = Manifest(nd)
        row = manifest.get(did)
        manifest.close()
        assert row["is_managed"] is True

    def test_adopt_missing_returns_404(self):
        resp = client.post("/api/documents/nonexistent-doc-id/adopt")
        assert resp.status_code == 404
