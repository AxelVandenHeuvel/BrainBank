from unittest.mock import patch

from backend.ingestion.processor import ingest_markdown
from backend.retrieval.query import query_brainbank
from tests.conftest import (
    mock_embed_query,
    mock_embed_texts,
    mock_extract_concepts,
    mock_generate_answer,
)


def _capture_generate_answer(query, context, concepts, history=None):
    """Mock that captures the history argument for assertion."""
    history_note = ""
    if history:
        history_note = f" [history:{len(history)} turns]"
    return f"Mock answer for: {query}{history_note}"


class TestQueryWithHistory:
    def _ingest_sample(self, lance_path, kuzu_path):
        with (
            patch("backend.ingestion.processor.embed_texts", side_effect=mock_embed_texts),
            patch(
                "backend.ingestion.processor.extract_concepts",
                side_effect=mock_extract_concepts,
            ),
        ):
            ingest_markdown(
                "Calculus is about Derivatives and Integrals.",
                "Math Notes",
                lance_path,
                kuzu_path,
            )

    @patch("backend.retrieval.query.generate_answer", side_effect=_capture_generate_answer)
    @patch("backend.retrieval.query.embed_query", side_effect=mock_embed_query)
    def test_history_passed_to_generate_answer(self, _mock_emb, mock_gen, lance_path, kuzu_path):
        self._ingest_sample(lance_path, kuzu_path)
        history = [
            {"role": "user", "content": "What is calculus?"},
            {"role": "assistant", "content": "Calculus studies change."},
        ]
        result = query_brainbank("Tell me more about it", lance_path, kuzu_path, history=history)
        assert "[history:2 turns]" in result["answer"]

    @patch("backend.retrieval.query.generate_answer", side_effect=_capture_generate_answer)
    @patch("backend.retrieval.query.embed_query", side_effect=mock_embed_query)
    def test_no_history_works(self, _mock_emb, mock_gen, lance_path, kuzu_path):
        self._ingest_sample(lance_path, kuzu_path)
        result = query_brainbank("What is calculus?", lance_path, kuzu_path)
        assert "[history:" not in result["answer"]

    @patch("backend.retrieval.query.generate_answer", side_effect=_capture_generate_answer)
    @patch("backend.retrieval.query.embed_query", side_effect=mock_embed_query)
    def test_empty_history_treated_as_none(self, _mock_emb, mock_gen, lance_path, kuzu_path):
        self._ingest_sample(lance_path, kuzu_path)
        result = query_brainbank("What is calculus?", lance_path, kuzu_path, history=[])
        assert "[history:" not in result["answer"]
