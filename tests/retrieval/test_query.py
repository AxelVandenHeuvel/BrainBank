from unittest.mock import patch

from backend.ingestion.processor import ingest_markdown
from backend.retrieval.query import query_brainbank
from tests.conftest import (
    mock_embed_query,
    mock_embed_texts,
    mock_extract_concepts,
    mock_generate_answer,
)


class TestQueryBrainbank:
    def _ingest_sample(self, lance_path, kuzu_path):
        """Helper to ingest sample data for query tests."""
        with (
            patch("backend.ingestion.processor.embed_texts", side_effect=mock_embed_texts),
            patch(
                "backend.ingestion.processor.extract_concepts",
                side_effect=mock_extract_concepts,
            ),
        ):
            ingest_markdown(
                "Calculus is about Derivatives and Integrals. "
                "Derivatives measure rate of change.",
                "Math Notes",
                lance_path,
                kuzu_path,
            )

    @patch("backend.retrieval.query.generate_answer", side_effect=mock_generate_answer)
    @patch("backend.retrieval.query.embed_query", side_effect=mock_embed_query)
    def test_returns_answer(self, mock_emb, mock_llm, lance_path, kuzu_path):
        self._ingest_sample(lance_path, kuzu_path)
        result = query_brainbank("What is calculus?", lance_path, kuzu_path)
        assert "answer" in result
        assert len(result["answer"]) > 0

    @patch("backend.retrieval.query.generate_answer", side_effect=mock_generate_answer)
    @patch("backend.retrieval.query.embed_query", side_effect=mock_embed_query)
    def test_returns_discovery_concepts(self, mock_emb, mock_llm, lance_path, kuzu_path):
        self._ingest_sample(lance_path, kuzu_path)
        result = query_brainbank("What is calculus?", lance_path, kuzu_path)
        assert "discovery_concepts" in result

    @patch("backend.retrieval.query.generate_answer", side_effect=mock_generate_answer)
    @patch("backend.retrieval.query.embed_query", side_effect=mock_embed_query)
    def test_returns_source_concepts(self, mock_emb, mock_llm, lance_path, kuzu_path):
        self._ingest_sample(lance_path, kuzu_path)
        result = query_brainbank("What is calculus?", lance_path, kuzu_path)
        assert "source_concepts" in result

    @patch("backend.retrieval.query.generate_answer", side_effect=mock_generate_answer)
    @patch("backend.retrieval.query.embed_query", side_effect=mock_embed_query)
    def test_empty_db_returns_no_results(self, mock_emb, mock_llm, lance_path, kuzu_path):
        result = query_brainbank("What is calculus?", lance_path, kuzu_path)
        assert result["answer"] == "No relevant information found."
        assert result["discovery_concepts"] == []
