from unittest.mock import patch

from backend.db.kuzu import init_kuzu
from backend.db.lance import init_lancedb
from backend.ingestion.processor import ingest_markdown
from tests.conftest import (
    mock_embed_texts,
    mock_extract_concepts,
)


class TestIngestMarkdown:
    @patch("backend.ingestion.processor.embed_texts", side_effect=mock_embed_texts)
    @patch("backend.ingestion.processor.extract_concepts", side_effect=mock_extract_concepts)
    def test_returns_doc_info(self, mock_llm, mock_emb, lance_path, kuzu_path):
        text = "Calculus is about Derivatives and Integrals."
        result = ingest_markdown(text, "Math Notes", lance_path, kuzu_path)
        assert "doc_id" in result
        assert "chunks" in result
        assert result["chunks"] >= 1
        assert "concepts" in result

    @patch("backend.ingestion.processor.embed_texts", side_effect=mock_embed_texts)
    @patch("backend.ingestion.processor.extract_concepts", side_effect=mock_extract_concepts)
    def test_chunks_stored_in_lancedb(self, mock_llm, mock_emb, lance_path, kuzu_path):
        text = "Calculus is about Derivatives and Integrals."
        result = ingest_markdown(text, "Math Notes", lance_path, kuzu_path)
        db, table = init_lancedb(lance_path)
        df = table.to_pandas()
        assert len(df) == result["chunks"]
        assert df.iloc[0]["doc_id"] == result["doc_id"]

    @patch("backend.ingestion.processor.embed_texts", side_effect=mock_embed_texts)
    @patch("backend.ingestion.processor.extract_concepts", side_effect=mock_extract_concepts)
    def test_concepts_stored_in_kuzu(self, mock_llm, mock_emb, lance_path, kuzu_path):
        text = "Calculus is about Derivatives and Integrals."
        ingest_markdown(text, "Math Notes", lance_path, kuzu_path)
        _, conn = init_kuzu(kuzu_path)
        result = conn.execute("MATCH (c:Concept) RETURN c.name")
        concepts = []
        while result.has_next():
            concepts.append(result.get_next()[0])
        assert "Calculus" in concepts
        assert "Derivatives" in concepts

    @patch("backend.ingestion.processor.embed_texts", side_effect=mock_embed_texts)
    @patch("backend.ingestion.processor.extract_concepts", side_effect=mock_extract_concepts)
    def test_upsert_concept_no_duplicate(self, mock_llm, mock_emb, lance_path, kuzu_path):
        """Ingesting two docs with the same concept should not create duplicates."""
        ingest_markdown("Calculus basics", "Doc 1", lance_path, kuzu_path)
        ingest_markdown("Advanced Calculus", "Doc 2", lance_path, kuzu_path)
        _, conn = init_kuzu(kuzu_path)
        result = conn.execute(
            "MATCH (c:Concept {name: 'Calculus'}) RETURN count(c)"
        )
        assert result.get_next()[0] == 1

    @patch("backend.ingestion.processor.embed_texts", side_effect=mock_embed_texts)
    @patch("backend.ingestion.processor.extract_concepts", side_effect=mock_extract_concepts)
    def test_document_concept_links_are_stored_in_lancedb_metadata(self, mock_llm, mock_emb, lance_path, kuzu_path):
        text = "Calculus is about Derivatives and Integrals."
        result = ingest_markdown(text, "Math Notes", lance_path, kuzu_path)
        _, table = init_lancedb(lance_path)
        df = table.to_pandas()

        matching_rows = df[df["doc_id"] == result["doc_id"]]

        assert not matching_rows.empty
        assert any("Calculus" in list(concepts) for concepts in matching_rows["concepts"])

    @patch("backend.ingestion.processor.embed_texts", side_effect=mock_embed_texts)
    @patch("backend.ingestion.processor.extract_concepts", side_effect=mock_extract_concepts)
    def test_related_to_edges_created(self, mock_llm, mock_emb, lance_path, kuzu_path):
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
