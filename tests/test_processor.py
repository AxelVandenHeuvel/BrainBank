from unittest.mock import patch

from brainbank.engine_setup import init_kuzu, init_lancedb
from brainbank.processor import chunk_text, ingest_markdown
from tests.conftest import (
    mock_embed_texts,
    mock_extract_concepts,
)


class TestChunkText:
    def test_single_paragraph(self):
        text = "This is a single paragraph."
        chunks = chunk_text(text)
        assert len(chunks) == 1
        assert chunks[0] == text

    def test_multiple_paragraphs(self):
        text = "First paragraph.\n\nSecond paragraph.\n\nThird paragraph."
        chunks = chunk_text(text)
        assert len(chunks) >= 1
        # All text should be covered
        combined = " ".join(chunks)
        assert "First paragraph" in combined
        assert "Third paragraph" in combined

    def test_empty_text_returns_original(self):
        chunks = chunk_text("")
        assert len(chunks) == 1

    def test_respects_chunk_size(self):
        text = "Word " * 200 + "\n\n" + "Word " * 200
        chunks = chunk_text(text, chunk_size=500)
        assert len(chunks) >= 2


class TestIngestMarkdown:
    @patch("brainbank.processor.embed_texts", side_effect=mock_embed_texts)
    @patch("brainbank.processor.extract_concepts", side_effect=mock_extract_concepts)
    def test_returns_doc_info(self, mock_llm, mock_emb, lance_path, kuzu_path):
        text = "Calculus is about Derivatives and Integrals."
        result = ingest_markdown(text, "Math Notes", lance_path, kuzu_path)
        assert "doc_id" in result
        assert "chunks" in result
        assert result["chunks"] >= 1
        assert "concepts" in result

    @patch("brainbank.processor.embed_texts", side_effect=mock_embed_texts)
    @patch("brainbank.processor.extract_concepts", side_effect=mock_extract_concepts)
    def test_chunks_stored_in_lancedb(self, mock_llm, mock_emb, lance_path, kuzu_path):
        text = "Calculus is about Derivatives and Integrals."
        result = ingest_markdown(text, "Math Notes", lance_path, kuzu_path)
        db, table = init_lancedb(lance_path)
        df = table.to_pandas()
        assert len(df) == result["chunks"]
        assert df.iloc[0]["doc_id"] == result["doc_id"]

    @patch("brainbank.processor.embed_texts", side_effect=mock_embed_texts)
    @patch("brainbank.processor.extract_concepts", side_effect=mock_extract_concepts)
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

    @patch("brainbank.processor.embed_texts", side_effect=mock_embed_texts)
    @patch("brainbank.processor.extract_concepts", side_effect=mock_extract_concepts)
    def test_upsert_concept_no_duplicate(self, mock_llm, mock_emb, lance_path, kuzu_path):
        """Ingesting two docs with the same concept should not create duplicates."""
        ingest_markdown("Calculus basics", "Doc 1", lance_path, kuzu_path)
        ingest_markdown("Advanced Calculus", "Doc 2", lance_path, kuzu_path)
        _, conn = init_kuzu(kuzu_path)
        result = conn.execute(
            "MATCH (c:Concept {name: 'Calculus'}) RETURN count(c)"
        )
        assert result.get_next()[0] == 1

    @patch("brainbank.processor.embed_texts", side_effect=mock_embed_texts)
    @patch("brainbank.processor.extract_concepts", side_effect=mock_extract_concepts)
    def test_mentions_edge_created(self, mock_llm, mock_emb, lance_path, kuzu_path):
        text = "Calculus is about Derivatives and Integrals."
        ingest_markdown(text, "Math Notes", lance_path, kuzu_path)
        _, conn = init_kuzu(kuzu_path)
        result = conn.execute(
            "MATCH (d:Document)-[m:MENTIONS]->(c:Concept) RETURN d.name, c.name"
        )
        edges = []
        while result.has_next():
            edges.append(result.get_next())
        assert len(edges) >= 1

    @patch("brainbank.processor.embed_texts", side_effect=mock_embed_texts)
    @patch("brainbank.processor.extract_concepts", side_effect=mock_extract_concepts)
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
