from unittest.mock import patch

from backend.db.lance import init_lancedb
from backend.retrieval.global_search import run_global_search
from backend.retrieval.types import RetrievalConfig

def _vector(head: float) -> list[float]:
    return [head] + [0.0] * 383


class TestGlobalSearch:
    def test_runs_map_reduce_over_ranked_communities(self, lance_path):
        db, _ = init_lancedb(lance_path)
        table = db.open_table("community_summaries")
        table.add(
            [
                {
                    "community_id": "community:0001",
                    "member_concepts": ["Calculus", "Derivatives"],
                    "summary": "This cluster covers calculus ideas.",
                    "summary_vector": _vector(1.0),
                },
                {
                    "community_id": "community:0002",
                    "member_concepts": ["Probability", "Bayes Theorem"],
                    "summary": "This cluster covers probability ideas.",
                    "summary_vector": _vector(0.9),
                },
            ]
        )

        with (
            patch(
                "backend.retrieval.global_search.generate_partial_answer",
                side_effect=["Partial one", "Partial two"],
            ) as mock_partial,
            patch(
                "backend.retrieval.global_search.synthesize_answers",
                return_value="Final answer",
            ) as mock_reduce,
        ):
            result = run_global_search(
                db,
                "Summarize the main ideas",
                _vector(1.0),
                RetrievalConfig(community_seed_limit=2, global_source_concept_limit=3),
            )

        assert result.answer == "Final answer"
        assert result.source_concepts == ("Calculus", "Derivatives", "Probability")
        assert result.discovery_concepts == ()
        assert mock_partial.call_count == 2
        mock_reduce.assert_called_once()

    def test_returns_none_when_community_summaries_are_empty(self, lance_path):
        db, _ = init_lancedb(lance_path)
        result = run_global_search(
            db,
            "Overview please",
            _vector(1.0),
            RetrievalConfig(),
        )
        assert result is None
