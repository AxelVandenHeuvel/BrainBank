from unittest.mock import Mock, patch

from backend.db.kuzu import init_kuzu
from backend.db.lance import init_lancedb
from backend.ingestion.processor import ingest_markdown
from tests.conftest import (
    mock_embed_texts,
    mock_extract_concepts,
)


class TestIngestMarkdown:
    @patch("backend.ingestion.processor.calculate_color_score", return_value=0.5)
    @patch("backend.ingestion.processor.embed_texts", side_effect=mock_embed_texts)
    @patch("backend.ingestion.processor.extract_concepts", side_effect=mock_extract_concepts)
    def test_returns_doc_info(self, _mock_llm, _mock_emb, _mock_score, lance_path, kuzu_path):
        text = "Calculus is about Derivatives and Integrals."
        result = ingest_markdown(text, "Math Notes", lance_path, kuzu_path)
        assert "doc_id" in result
        assert "chunks" in result
        assert result["chunks"] >= 1
        assert "concepts" in result

    @patch("backend.ingestion.processor.calculate_color_score", return_value=0.5)
    @patch("backend.ingestion.processor.embed_texts", side_effect=mock_embed_texts)
    @patch("backend.ingestion.processor.extract_concepts", side_effect=mock_extract_concepts)
    def test_chunks_stored_in_lancedb(self, _mock_llm, _mock_emb, _mock_score, lance_path, kuzu_path):
        text = "Calculus is about Derivatives and Integrals."
        result = ingest_markdown(text, "Math Notes", lance_path, kuzu_path)
        _, table = init_lancedb(lance_path)
        df = table.to_pandas()
        assert len(df) == result["chunks"]
        assert df.iloc[0]["doc_id"] == result["doc_id"]

    @patch("backend.ingestion.processor.calculate_color_score", return_value=0.5)
    @patch("backend.ingestion.processor.embed_texts", side_effect=mock_embed_texts)
    @patch("backend.ingestion.processor.extract_concepts", side_effect=mock_extract_concepts)
    def test_concepts_stored_in_kuzu(self, _mock_llm, _mock_emb, _mock_score, lance_path, kuzu_path):
        text = "Calculus is about Derivatives and Integrals."
        ingest_markdown(text, "Math Notes", lance_path, kuzu_path)
        _, conn = init_kuzu(kuzu_path)
        result = conn.execute("MATCH (c:Concept) RETURN c.name")
        concepts = []
        while result.has_next():
            concepts.append(result.get_next()[0])
        assert "Calculus" in concepts
        assert "Derivatives" in concepts

    @patch("backend.ingestion.processor.calculate_color_score", return_value=0.5)
    @patch("backend.ingestion.processor.embed_texts", side_effect=mock_embed_texts)
    @patch("backend.ingestion.processor.extract_concepts", side_effect=mock_extract_concepts)
    def test_upsert_concept_no_duplicate(self, _mock_llm, _mock_emb, _mock_score, lance_path, kuzu_path):
        """Ingesting two docs with the same concept should not create duplicates."""
        ingest_markdown("Calculus basics", "Doc 1", lance_path, kuzu_path)
        ingest_markdown("Advanced Calculus", "Doc 2", lance_path, kuzu_path)
        _, conn = init_kuzu(kuzu_path)
        result = conn.execute(
            "MATCH (c:Concept {name: 'Calculus'}) RETURN count(c)"
        )
        assert result.get_next()[0] == 1

    @patch("backend.ingestion.processor.calculate_color_score", return_value=0.5)
    @patch("backend.ingestion.processor.embed_texts", side_effect=mock_embed_texts)
    @patch("backend.ingestion.processor.extract_concepts", side_effect=mock_extract_concepts)
    def test_document_concept_links_are_stored_in_lancedb_metadata(self, _mock_llm, _mock_emb, _mock_score, lance_path, kuzu_path):
        text = "Calculus is about Derivatives and Integrals."
        result = ingest_markdown(text, "Math Notes", lance_path, kuzu_path)
        _, table = init_lancedb(lance_path)
        df = table.to_pandas()

        matching_rows = df[df["doc_id"] == result["doc_id"]]

        assert not matching_rows.empty
        assert any("Calculus" in list(concepts) for concepts in matching_rows["concepts"])

    @patch("backend.ingestion.processor.calculate_color_score", return_value=0.5)
    @patch("backend.ingestion.processor.embed_texts", side_effect=mock_embed_texts)
    @patch("backend.ingestion.processor.extract_concepts", side_effect=mock_extract_concepts)
    def test_related_to_edges_created(self, _mock_llm, _mock_emb, _mock_score, lance_path, kuzu_path):
        text = "Calculus is about Derivatives and Integrals."
        ingest_markdown(text, "Math Notes", lance_path, kuzu_path)
        _, conn = init_kuzu(kuzu_path)
        result = conn.execute(
            "MATCH (a:Concept)-[r:RELATED_TO]->(b:Concept) RETURN a.name, b.name"
        )
        edges = []
        while result.has_next():
            edges.append(result.get_next())
        assert len(edges) >= 1

    @patch("backend.ingestion.processor.calculate_color_score", return_value=0.5)
    @patch("backend.ingestion.processor.embed_texts", side_effect=mock_embed_texts)
    @patch(
        "backend.ingestion.processor.extract_concepts",
        return_value={
            "concepts": ["Calculus", "Calculus", "Derivatives", "Integrals"],
            "relationships": [],
        },
    )
    def test_related_to_edges_created_for_unique_concept_pairs(
        self, _mock_llm, _mock_emb, _mock_score, lance_path, kuzu_path
    ):
        ingest_markdown("Any text", "Math Notes", lance_path, kuzu_path)
        _, conn = init_kuzu(kuzu_path)
        result = conn.execute("MATCH (:Concept)-[r:RELATED_TO]->(:Concept) RETURN count(r)")
        assert result.get_next()[0] == 3

    @patch("backend.ingestion.processor.calculate_color_score", return_value=0.5)
    @patch("backend.ingestion.processor.embed_texts", side_effect=mock_embed_texts)
    @patch(
        "backend.ingestion.processor.extract_concepts",
        return_value={"concepts": ["Calculus", "Derivatives"], "relationships": []},
    )
    def test_related_to_edge_weight_increments_by_shared_documents(
        self, _mock_llm, _mock_emb, _mock_score, lance_path, kuzu_path
    ):
        ingest_markdown("Doc one", "Doc 1", lance_path, kuzu_path)
        ingest_markdown("Doc two", "Doc 2", lance_path, kuzu_path)
        _, conn = init_kuzu(kuzu_path)
        result = conn.execute(
            "MATCH (a:Concept {name: 'Calculus'})-[r:RELATED_TO]->(b:Concept {name: 'Derivatives'}) "
            "RETURN r.weight, r.reason"
        )
        assert result.has_next()
        weight, reason = result.get_next()
        assert weight == 2.0
        assert reason == "shared_document"

    @patch("backend.ingestion.processor.calculate_color_score", return_value=0.5)
    @patch("backend.ingestion.processor.embed_texts", side_effect=mock_embed_texts)
    @patch("backend.ingestion.processor.extract_concepts", side_effect=mock_extract_concepts)
    def test_color_score_stored_on_concept(self, _mock_llm, _mock_emb, _mock_score, lance_path, kuzu_path):
        ingest_markdown("Calculus basics", "Doc 1", lance_path, kuzu_path)
        _, conn = init_kuzu(kuzu_path)
        result = conn.execute("MATCH (c:Concept {name: 'Calculus'}) RETURN c.colorScore")
        assert result.has_next()
        assert result.get_next()[0] == 0.5

    @patch("backend.ingestion.processor.calculate_color_score", return_value=0.5)
    @patch("backend.ingestion.processor.embed_texts", side_effect=mock_embed_texts)
    @patch("backend.ingestion.processor.extract_concepts", side_effect=mock_extract_concepts)
    def test_document_centroid_stored_after_ingest(self, _mock_llm, _mock_emb, _mock_score, lance_path, kuzu_path):
        result = ingest_markdown("Calculus basics and derivatives", "Doc 1", lance_path, kuzu_path)

        db, _ = init_lancedb(lance_path)
        centroids = db.open_table("document_centroids")
        df = centroids.to_pandas()
        matching = df[df["doc_id"] == result["doc_id"]]

        assert len(matching) == 1
        assert matching.iloc[0]["doc_name"] == "Doc 1"
        centroid_vector = matching.iloc[0]["centroid_vector"]
        assert len(centroid_vector) == 384

    @patch("backend.ingestion.processor.calculate_color_score", return_value=0.5)
    @patch("backend.ingestion.processor.embed_texts", side_effect=mock_embed_texts)
    def test_passes_top_existing_concepts_as_hints(self, _mock_emb, _mock_score, lance_path, kuzu_path):
        db, _ = init_lancedb(lance_path)
        concept_centroids = db.open_table("concept_centroids")
        concept_centroids.add([
            {
                "concept_name": "Calculus",
                "centroid_vector": [0.0] * 384,
                "document_count": 12,
            },
            {
                "concept_name": "Integrals",
                "centroid_vector": [0.0] * 384,
                "document_count": 8,
            },
            {
                "concept_name": "Limits",
                "centroid_vector": [0.0] * 384,
                "document_count": 2,
            },
        ])

        captured_hints = {}

        def _fake_extract(_text: str, _doc_name: str, existing_concepts=None):
            captured_hints["value"] = existing_concepts
            return {"concepts": ["Calculus", "Integrals"], "relationships": []}

        class _NoopConsolidator:
            def __init__(self, *_args, **_kwargs):
                pass

            def canonicalize_concepts(self, concepts):
                return concepts

            def consolidate_graph(self, _conn):
                return {"merged_count": 0, "renamed_count": 0}

        with patch("backend.ingestion.processor.extract_concepts", side_effect=_fake_extract):
            with patch("backend.ingestion.processor.ConceptConsolidator", _NoopConsolidator):
                ingest_markdown("Calculus and integrals", "Doc", lance_path, kuzu_path)

        assert captured_hints["value"] == ["Calculus", "Integrals", "Limits"]

    @patch("backend.ingestion.processor.calculate_color_score", return_value=0.5)
    @patch("backend.ingestion.processor.embed_texts", side_effect=mock_embed_texts)
    @patch(
        "backend.ingestion.processor.extract_concepts",
        return_value={"concepts": ["Definite Integrals", "Derivatives"], "relationships": []},
    )
    def test_ingest_uses_consolidator_output_for_canonical_concepts(
        self, _mock_extract, _mock_emb, _mock_score, lance_path, kuzu_path
    ):
        consolidator = Mock()
        consolidator.canonicalize_concepts.return_value = ["Integrals", "Derivatives"]
        consolidator.consolidate_graph.return_value = {"merged_count": 1, "renamed_count": 1}

        with patch("backend.ingestion.processor.ConceptConsolidator", return_value=consolidator):
            result = ingest_markdown("Definite integrals and derivatives", "Doc", lance_path, kuzu_path)

        assert result["concepts"] == ["Integrals", "Derivatives"]
        consolidator.canonicalize_concepts.assert_called_once_with(["Definite Integrals", "Derivatives"])
        consolidator.consolidate_graph.assert_called_once()


class TestFilePathIngest:
    @patch("backend.ingestion.processor.calculate_color_score", return_value=0.5)
    @patch("backend.ingestion.processor.embed_texts", side_effect=mock_embed_texts)
    @patch("backend.ingestion.processor.extract_concepts", side_effect=mock_extract_concepts)
    def test_file_path_uses_provided_doc_id(self, _m1, _m2, _m3, lance_path, kuzu_path):
        file_path = "/home/user/notes/calculus.md"
        result = ingest_markdown("Calculus basics", "Calculus", lance_path, kuzu_path, file_path=file_path, doc_id="my-uuid-123")
        assert result["doc_id"] == "my-uuid-123"

    @patch("backend.ingestion.processor.calculate_color_score", return_value=0.5)
    @patch("backend.ingestion.processor.embed_texts", side_effect=mock_embed_texts)
    @patch("backend.ingestion.processor.extract_concepts", side_effect=mock_extract_concepts)
    def test_file_path_without_doc_id_raises(self, _m1, _m2, _m3, lance_path, kuzu_path):
        import pytest
        with pytest.raises(ValueError, match="doc_id is required"):
            ingest_markdown("Calculus basics", "Calculus", lance_path, kuzu_path, file_path="/some/path.md")

    @patch("backend.ingestion.processor.calculate_color_score", return_value=0.5)
    @patch("backend.ingestion.processor.embed_texts", side_effect=mock_embed_texts)
    @patch("backend.ingestion.processor.extract_concepts", side_effect=mock_extract_concepts)
    def test_file_path_stored_in_chunk_records(self, _m1, _m2, _m3, lance_path, kuzu_path):
        file_path = "/home/user/notes/calculus.md"
        result = ingest_markdown("Calculus basics", "Calculus", lance_path, kuzu_path, file_path=file_path, doc_id="uuid-1")
        _, table = init_lancedb(lance_path)
        df = table.to_pandas()
        matching = df[df["doc_id"] == result["doc_id"]]
        assert all(matching["file_path"] == file_path)

    @patch("backend.ingestion.processor.calculate_color_score", return_value=0.5)
    @patch("backend.ingestion.processor.embed_texts", side_effect=mock_embed_texts)
    @patch("backend.ingestion.processor.extract_concepts", side_effect=mock_extract_concepts)
    def test_file_path_stored_in_document_centroids(self, _m1, _m2, _m3, lance_path, kuzu_path):
        file_path = "/home/user/notes/calculus.md"
        result = ingest_markdown("Calculus basics", "Calculus", lance_path, kuzu_path, file_path=file_path, doc_id="uuid-2")
        db, _ = init_lancedb(lance_path)
        centroids = db.open_table("document_centroids")
        df = centroids.to_pandas()
        matching = df[df["doc_id"] == result["doc_id"]]
        assert len(matching) == 1
        assert matching.iloc[0]["file_path"] == file_path

    @patch("backend.ingestion.processor.calculate_color_score", return_value=0.5)
    @patch("backend.ingestion.processor.embed_texts", side_effect=mock_embed_texts)
    @patch("backend.ingestion.processor.extract_concepts", side_effect=mock_extract_concepts)
    def test_reingest_same_doc_id_overwrites_chunks(self, _m1, _m2, _m3, lance_path, kuzu_path):
        file_path = "/home/user/notes/calculus.md"
        doc_id = "stable-uuid"
        r1 = ingest_markdown("Version one", "Calculus", lance_path, kuzu_path, file_path=file_path, doc_id=doc_id)
        r2 = ingest_markdown("Version two", "Calculus", lance_path, kuzu_path, file_path=file_path, doc_id=doc_id)

        assert r1["doc_id"] == r2["doc_id"]

        _, table = init_lancedb(lance_path)
        df = table.to_pandas()
        matching = df[df["doc_id"] == r1["doc_id"]]
        # Should only have chunks from the second ingest, not duplicates
        assert all("Version two" in text for text in matching["text"].tolist())

    @patch("backend.ingestion.processor.calculate_color_score", return_value=0.5)
    @patch("backend.ingestion.processor.embed_texts", side_effect=mock_embed_texts)
    @patch("backend.ingestion.processor.extract_concepts", side_effect=mock_extract_concepts)
    def test_no_file_path_still_uses_random_uuid(self, _m1, _m2, _m3, lance_path, kuzu_path):
        r1 = ingest_markdown("Text one", "Doc 1", lance_path, kuzu_path)
        r2 = ingest_markdown("Text two", "Doc 2", lance_path, kuzu_path)
        assert r1["doc_id"] != r2["doc_id"]
        assert len(r1["doc_id"]) == 36  # UUID format
