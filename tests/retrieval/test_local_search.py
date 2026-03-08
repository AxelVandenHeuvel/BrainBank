from unittest.mock import patch

import kuzu

from backend.db.kuzu import init_kuzu
from backend.db.lance import init_lancedb
from backend.ingestion.processor import ingest_markdown
from backend.retrieval.local_search import (
    build_chunk_seed_set,
    expand_related_concepts,
    normalize_concepts,
    run_local_search,
    select_discovery_chunks,
)
from backend.retrieval.types import ChunkHit, RetrievalConfig
from tests.conftest import (
    mock_embed_query,
    mock_embed_texts,
)


class TestNormalizeConcepts:
    def test_returns_empty_list_for_none(self):
        assert normalize_concepts(None) == []

    def test_converts_arrow_like_values_to_plain_list(self):
        assert normalize_concepts(("Calculus", "Derivatives")) == [
            "Calculus",
            "Derivatives",
        ]


class TestLocalSearch:
    @staticmethod
    def _seed_chunk_table(lance_path):
        _, table = init_lancedb(lance_path)
        table.add(
            [
                {
                    "chunk_id": "chunk-1",
                    "doc_id": "doc-1",
                    "doc_name": "Math Notes",
                    "text": "Calculus connects derivatives and integrals.",
                    "concepts": ["Calculus", "Derivatives"],
                    "vector": mock_embed_texts(["chunk-1"])[0],
                },
                {
                    "chunk_id": "chunk-2",
                    "doc_id": "doc-2",
                    "doc_name": "Extra Notes",
                    "text": "Integrals connect to limits.",
                    "concepts": ["Integrals", "Limits"],
                    "vector": mock_embed_texts(["chunk-2"])[0],
                },
            ]
        )
        return table

    @staticmethod
    def _seed_graph(conn: kuzu.Connection):
        conn.execute("MERGE (c:Concept {name: 'Calculus'})")
        conn.execute("MERGE (c:Concept {name: 'Derivatives'})")
        conn.execute("MERGE (c:Concept {name: 'Integrals'})")
        conn.execute("MERGE (c:Concept {name: 'Limits'})")
        conn.execute("MERGE (c:Concept {name: 'Physics'})")
        conn.execute(
            "MATCH (a:Concept {name: 'Calculus'}), (b:Concept {name: 'Integrals'}) "
            "CREATE (a)-[:RELATED_TO {reason: 'contains'}]->(b)"
        )
        conn.execute(
            "MATCH (a:Concept {name: 'Integrals'}), (b:Concept {name: 'Limits'}) "
            "CREATE (a)-[:RELATED_TO {reason: 'depends_on'}]->(b)"
        )
        conn.execute(
            "MATCH (a:Concept {name: 'Limits'}), (b:Concept {name: 'Physics'}) "
            "CREATE (a)-[:RELATED_TO {reason: 'applies_to'}]->(b)"
        )

    def test_build_chunk_seed_set_returns_ordered_seed_chunks_and_source_concepts(
        self,
        lance_path,
    ):
        table = self._seed_chunk_table(lance_path)
        query_vector = mock_embed_query("Calculus")

        seed_chunks, source_concepts = build_chunk_seed_set(
            table,
            query_vector,
            limit=2,
        )

        assert len(seed_chunks) == 2
        assert isinstance(seed_chunks[0], ChunkHit)
        assert source_concepts == ["Calculus", "Derivatives", "Integrals", "Limits"]

    def test_expand_related_concepts_supports_multi_hop_ranking(self, kuzu_path):
        kuzu_db, conn = init_kuzu(kuzu_path)
        self._seed_graph(conn)

        discovered = expand_related_concepts(
            conn,
            ["Calculus"],
            max_hops=2,
            max_discovery_concepts=10,
        )

        assert [concept.name for concept in discovered] == ["Integrals", "Limits"]
        assert discovered[0].min_hop == 1
        assert discovered[1].min_hop == 2

        conn.close()
        kuzu_db.close()

    def test_expand_related_concepts_handles_cycles_without_duplicates(self, kuzu_path):
        kuzu_db, conn = init_kuzu(kuzu_path)
        self._seed_graph(conn)
        conn.execute(
            "MATCH (a:Concept {name: 'Limits'}), (b:Concept {name: 'Calculus'}) "
            "CREATE (a)-[:RELATED_TO {reason: 'cycles'}]->(b)"
        )

        discovered = expand_related_concepts(
            conn,
            ["Calculus"],
            max_hops=3,
            max_discovery_concepts=10,
        )

        assert [concept.name for concept in discovered] == ["Integrals", "Limits", "Physics"]

        conn.close()
        kuzu_db.close()

    def test_select_discovery_chunks_excludes_seed_chunks_and_limits_results(self, lance_path):
        table = self._seed_chunk_table(lance_path)
        df = table.to_pandas()
        discovery_chunks = select_discovery_chunks(
            df,
            discovery_concepts=[],
            excluded_chunk_ids={"chunk-1"},
            max_chunks=5,
        )
        assert discovery_chunks == []

    def test_select_discovery_chunks_ranks_by_concept_priority_and_caps_results(self, lance_path):
        _, table = init_lancedb(lance_path)
        table.add(
            [
                {
                    "chunk_id": "chunk-a",
                    "doc_id": "doc-a",
                    "doc_name": "Doc A",
                    "text": "Integrals are important.",
                    "concepts": ["Integrals"],
                    "vector": mock_embed_texts(["chunk-a"])[0],
                },
                {
                    "chunk_id": "chunk-b",
                    "doc_id": "doc-b",
                    "doc_name": "Doc B",
                    "text": "Limits support integrals.",
                    "concepts": ["Limits", "Integrals"],
                    "vector": mock_embed_texts(["chunk-b"])[0],
                },
                {
                    "chunk_id": "chunk-c",
                    "doc_id": "doc-c",
                    "doc_name": "Doc C",
                    "text": "Physics uses limits.",
                    "concepts": ["Physics", "Limits"],
                    "vector": mock_embed_texts(["chunk-c"])[0],
                },
            ]
        )
        df = table.to_pandas()

        discovery_chunks = select_discovery_chunks(
            df,
            discovery_concepts=[
                build_discovered_concept("Integrals", min_hop=1),
                build_discovered_concept("Limits", min_hop=2),
            ],
            excluded_chunk_ids=set(),
            max_chunks=2,
        )

        assert [chunk.chunk_id for chunk in discovery_chunks] == ["chunk-b", "chunk-a"]

    @patch("backend.ingestion.processor.embed_texts", side_effect=mock_embed_texts)
    def test_run_local_search_returns_seed_and_discovery_chunks(
        self,
        _mock_embed,
        lance_path,
        kuzu_path,
    ):
        with patch(
            "backend.ingestion.processor.extract_concepts",
            return_value={
                "concepts": ["Calculus", "Derivatives"],
                "relationships": [
                    {"from": "Calculus", "to": "Integrals", "relationship": "contains"},
                    {"from": "Integrals", "to": "Limits", "relationship": "depends_on"},
                ],
            },
        ):
            ingest_markdown(
                "Calculus explains derivatives and integrals. Limits support integrals.",
                "Math Notes",
                lance_path,
                kuzu_path,
            )

        _, table = init_lancedb(lance_path)
        kuzu_db, conn = init_kuzu(kuzu_path)

        result = run_local_search(
            table,
            conn,
            mock_embed_query("Calculus"),
            RetrievalConfig(max_graph_hops=2, max_discovery_chunks=5),
        )

        assert result.seed_chunks
        assert result.discovery_concepts
        assert isinstance(result.discovery_chunks, tuple)

        conn.close()
        kuzu_db.close()


def build_discovered_concept(name: str, *, min_hop: int) -> object:
    from backend.retrieval.types import DiscoveredConcept

    return DiscoveredConcept(
        name=name,
        min_hop=min_hop,
        supporting_seed_concepts=("Calculus",),
    )
