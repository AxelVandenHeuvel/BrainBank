from unittest.mock import patch

from brainbank.logic import query_brainbank
from brainbank.processor import ingest_markdown
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
            patch("brainbank.processor.embed_texts", side_effect=mock_embed_texts),
            patch(
                "brainbank.processor.extract_concepts",
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

    @patch("brainbank.logic.generate_answer", side_effect=mock_generate_answer)
    @patch("brainbank.logic.embed_query", side_effect=mock_embed_query)
    def test_returns_answer(self, mock_emb, mock_llm, lance_path, kuzu_path):
        self._ingest_sample(lance_path, kuzu_path)
        result = query_brainbank("What is calculus?", lance_path, kuzu_path)
        assert "answer" in result
        assert len(result["answer"]) > 0

    @patch("brainbank.logic.generate_answer", side_effect=mock_generate_answer)
    @patch("brainbank.logic.embed_query", side_effect=mock_embed_query)
    def test_returns_discovery_concepts(self, mock_emb, mock_llm, lance_path, kuzu_path):
        self._ingest_sample(lance_path, kuzu_path)
        result = query_brainbank("What is calculus?", lance_path, kuzu_path)
        assert "discovery_concepts" in result

    @patch("brainbank.logic.generate_answer", side_effect=mock_generate_answer)
    @patch("brainbank.logic.embed_query", side_effect=mock_embed_query)
    def test_returns_source_concepts(self, mock_emb, mock_llm, lance_path, kuzu_path):
        self._ingest_sample(lance_path, kuzu_path)
        result = query_brainbank("What is calculus?", lance_path, kuzu_path)
        assert "source_concepts" in result

    @patch("brainbank.logic.generate_answer", side_effect=mock_generate_answer)
    @patch("brainbank.logic.embed_query", side_effect=mock_embed_query)
    def test_empty_db_returns_no_results(self, mock_emb, mock_llm, lance_path, kuzu_path):
        result = query_brainbank("What is calculus?", lance_path, kuzu_path)
        assert result["answer"] == "No relevant information found."
        assert result["discovery_concepts"] == []
