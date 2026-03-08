from unittest.mock import patch

from backend.db.kuzu import init_kuzu
from backend.db.lance import init_lancedb
from backend.retrieval.query import query_brainbank
from tests.conftest import mock_embed_query, mock_generate_answer


def _vector(head: float) -> list[float]:
    return [head] + [0.0] * 383


class TestPhaseTwoQuery:
    @patch("backend.retrieval.query.embed_query", side_effect=mock_embed_query)
    def test_global_route_uses_community_summaries_when_available(self, _mock_embed, lance_path, kuzu_path):
        db, _ = init_lancedb(lance_path)
        community_table = db.open_table("community_summaries")
        community_table.add(
            [
                {
                    "community_id": "community:0001",
                    "member_concepts": ["Calculus", "Derivatives"],
                    "summary": "Calculus summary",
                    "summary_vector": _vector(1.0),
                }
            ]
        )
        kuzu_db, conn = init_kuzu(kuzu_path)
        conn.close()

        with (
            patch(
                "backend.retrieval.query.generate_partial_answer",
                return_value="Partial summary",
            ),
            patch(
                "backend.retrieval.query.synthesize_answers",
                side_effect=AssertionError("reduce should not run for one community"),
            ),
        ):
            result = query_brainbank(
                "Give me a high level overview",
                lance_db_path=lance_path,
                kuzu_db_path=kuzu_path,
            )

        assert result["answer"] == "Partial summary"
        assert result["source_concepts"] == ["Calculus", "Derivatives"]
        assert result["discovery_concepts"] == []
        kuzu_db.close()
