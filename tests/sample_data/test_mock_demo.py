import os
import subprocess
import sys
from pathlib import Path
from unittest.mock import patch

from backend.db.kuzu import init_kuzu
from backend.db.lance import init_lancedb
from backend.retrieval.query import query_brainbank
from backend.sample_data.mock_demo import seed_mock_demo_data
from backend.services.embeddings import VECTOR_DIM


KEYWORDS = (
    "maxwells equations",
    "maxwell",
    "equations",
    "electromagnetism",
    "electric",
    "magnetic",
    "calculus",
    "derivatives",
    "integrals",
    "ethics",
    "motivation",
    "entropy",
    "determinism",
)


def _lexical_vector(text: str) -> list[float]:
    lowered = text.lower().replace("'", "")
    values = [float(lowered.count(keyword)) for keyword in KEYWORDS]
    if len(values) < VECTOR_DIM:
        values.extend([0.0] * (VECTOR_DIM - len(values)))
    return values[:VECTOR_DIM]


def _mock_embed_texts(texts: list[str]) -> list[list[float]]:
    return [_lexical_vector(text) for text in texts]


def _mock_embed_query(query: str) -> list[float]:
    return _lexical_vector(query)


def _echo_context(_query: str, context: str, _concepts: list[str], history=None) -> str:
    return context


class TestSeedMockDemoData:
    @patch("backend.sample_data.mock_demo._demo_color_score", return_value=0.5)
    @patch("backend.sample_data.mock_demo.embed_texts", side_effect=_mock_embed_texts)
    def test_seeds_mock_demo_documents_into_temp_databases(self, _mock_embed, _mock_score, lance_path, kuzu_path):
        summary = seed_mock_demo_data(lance_db_path=lance_path, kuzu_db_path=kuzu_path)

        assert summary["seeded_documents"] >= 40
        assert summary["skipped_documents"] == 0
        assert summary["total_concepts"] >= 90
        assert summary["community_summaries"] >= 5

        db, table = init_lancedb(lance_path)
        chunks_df = table.to_pandas()
        concept_df = db.open_table("concept_centroids").to_pandas()
        community_df = db.open_table("community_summaries").to_pandas()

        assert "Electromagnetism Lecture Notes" in set(chunks_df["doc_name"])
        assert "Maxwell's Equations" in set(concept_df["concept_name"])
        assert not community_df.empty

        kuzu_db, conn = init_kuzu(kuzu_path)
        result = conn.execute("MATCH (c:Concept {name: $name}) RETURN count(c)", parameters={"name": "Maxwell's Equations"})
        assert result.has_next()
        assert result.get_next()[0] == 1
        conn.close()
        kuzu_db.close()

    @patch("backend.sample_data.mock_demo._demo_color_score", return_value=0.5)
    @patch("backend.sample_data.mock_demo.embed_texts", side_effect=_mock_embed_texts)
    def test_skips_existing_documents_on_repeat_seed(self, _mock_embed, _mock_score, lance_path, kuzu_path):
        first = seed_mock_demo_data(lance_db_path=lance_path, kuzu_db_path=kuzu_path)
        second = seed_mock_demo_data(lance_db_path=lance_path, kuzu_db_path=kuzu_path)

        assert first["seeded_documents"] >= 40
        assert second["seeded_documents"] == 0
        assert second["skipped_documents"] >= first["seeded_documents"]

    @patch("backend.sample_data.mock_demo._demo_color_score", return_value=0.5)
    @patch("backend.sample_data.mock_demo.embed_texts", side_effect=_mock_embed_texts)
    @patch("backend.retrieval.query.embed_query", side_effect=_mock_embed_query)
    @patch("backend.retrieval.query.generate_answer", side_effect=_echo_context)
    def test_seeded_demo_data_answers_the_maxwell_question(
        self,
        _mock_generate,
        _mock_query,
        _mock_embed,
        _mock_score,
        lance_path,
        kuzu_path,
    ):
        seed_mock_demo_data(lance_db_path=lance_path, kuzu_db_path=kuzu_path)

        result = query_brainbank(
            "how many equations are in maxwell's equations",
            lance_db_path=lance_path,
            kuzu_db_path=kuzu_path,
        )

        assert "Maxwell's Equations" in result["source_concepts"]
        assert result["answer"]

    def test_seed_script_runs_from_repo_root(self, lance_path, kuzu_path):
        repo_root = Path(__file__).resolve().parents[2]
        result = subprocess.run(
            [
                sys.executable,
                "scripts/seed_mock_demo_data.py",
                "--lance-db-path",
                lance_path,
                "--kuzu-db-path",
                kuzu_path,
            ],
            cwd=repo_root,
            capture_output=True,
            text=True,
            check=False,
            env={
                **dict(os.environ),
                "BRAINBANK_DEMO_SEED_DETERMINISTIC": "1",
            },
        )

        assert result.returncode == 0
        assert "Seeded" in result.stdout
