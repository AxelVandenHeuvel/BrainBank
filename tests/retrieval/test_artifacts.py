from unittest.mock import patch

from backend.db.kuzu import init_kuzu
from backend.db.lance import init_lancedb
from backend.ingestion.processor import ingest_markdown
from backend.retrieval.artifacts import rebuild_graphrag_artifacts
from tests.conftest import mock_embed_texts


class TestRebuildArtifacts:
    @patch("backend.ingestion.processor.calculate_color_score", return_value=0.5)
    @patch("backend.ingestion.processor.embed_texts", side_effect=mock_embed_texts)
    @patch(
        "backend.ingestion.processor.extract_concepts",
        side_effect=[
            {"concepts": ["Calculus", "Derivatives"], "relationships": []},
            {"concepts": ["Calculus", "Limits"], "relationships": []},
            {"concepts": ["Probability", "Bayes Theorem"], "relationships": []},
        ],
    )
    @patch("backend.retrieval.artifacts.generate_community_summary", return_value="Summary")
    @patch("backend.retrieval.artifacts.embed_texts", side_effect=mock_embed_texts)
    def test_rebuild_writes_concept_and_community_artifacts(
        self,
        _mock_summary_embed,
        _mock_generate_summary,
        _mock_extract,
        _mock_embed,
        _mock_score,
        lance_path,
        kuzu_path,
    ):
        ingest_markdown("Calculus and derivatives", "Doc 1", lance_path, kuzu_path)
        ingest_markdown("Calculus and limits", "Doc 2", lance_path, kuzu_path)
        ingest_markdown("Probability and Bayes", "Doc 3", lance_path, kuzu_path)

        summary = rebuild_graphrag_artifacts(lance_db_path=lance_path, kuzu_db_path=kuzu_path)

        db, _ = init_lancedb(lance_path)
        concept_table = db.open_table("concept_centroids")
        community_table = db.open_table("community_summaries")

        concept_df = concept_table.to_pandas()
        community_df = community_table.to_pandas()

        assert summary["concept_centroids"] >= 3
        assert summary["communities"] >= 1
        assert "Calculus" in set(concept_df["concept_name"])
        assert community_df.iloc[0]["community_id"].startswith("community:")
        assert len(community_df.iloc[0]["summary_vector"]) == 384
