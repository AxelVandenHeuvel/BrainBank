import kuzu

from backend.db.kuzu import init_kuzu
from backend.db.lance import init_lancedb
from backend.retrieval.latent_discovery import find_latent_document_hits
from backend.retrieval.local_search import (
    build_chunk_seed_set,
    expand_weighted_related_concepts,
    normalize_concepts,
    run_local_search,
    score_source_concepts_from_seed_chunks,
    select_top_chunks_for_documents,
)
from backend.retrieval.types import ChunkHit, RetrievalConfig, SourceConceptHit


def _vector(head: float, tail: float = 0.0) -> list[float]:
    return [head, tail] + [0.0] * 382


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
        db, table = init_lancedb(lance_path)
        table.add(
            [
                {
                    "chunk_id": "chunk-1",
                    "doc_id": "seed-doc",
                    "doc_name": "Seed Doc",
                    "text": "Limits support continuity.",
                    "concepts": ["Limits", "Continuity"],
                    "vector": _vector(1.0, 0.0),
                },
                {
                    "chunk_id": "chunk-2",
                    "doc_id": "seed-doc-2",
                    "doc_name": "Seed Doc 2",
                    "text": "Calculus uses limits.",
                    "concepts": ["Calculus", "Limits"],
                    "vector": _vector(0.9, 0.0),
                },
                {
                    "chunk_id": "chunk-3",
                    "doc_id": "latent-doc",
                    "doc_name": "Latent Doc",
                    "text": "Derivatives connect to tangent lines.",
                    "concepts": ["Derivatives"],
                    "vector": _vector(0.95, 0.0),
                },
                {
                    "chunk_id": "chunk-4",
                    "doc_id": "latent-doc",
                    "doc_name": "Latent Doc",
                    "text": "Derivative rules and chain rule.",
                    "concepts": ["Derivatives", "Chain Rule"],
                    "vector": _vector(0.94, 0.01),
                },
            ]
        )
        centroids = db.open_table("document_centroids")
        centroids.add(
            [
                {
                    "doc_id": "seed-doc",
                    "doc_name": "Seed Doc",
                    "centroid_vector": _vector(1.0, 0.0),
                },
                {
                    "doc_id": "seed-doc-2",
                    "doc_name": "Seed Doc 2",
                    "centroid_vector": _vector(0.9, 0.0),
                },
                {
                    "doc_id": "latent-doc",
                    "doc_name": "Latent Doc",
                    "centroid_vector": _vector(0.95, 0.0),
                },
            ]
        )
        return db, table

    @staticmethod
    def _seed_graph(conn: kuzu.Connection):
        for name in ["Calculus", "Limits", "Continuity", "Derivatives", "Chain Rule"]:
            conn.execute("MERGE (c:Concept {name: $name})", parameters={"name": name})
        conn.execute(
            "MATCH (a:Concept {name: 'Limits'}), (b:Concept {name: 'Derivatives'}) "
            "CREATE (a)-[:RELATED_TO {reason: 'shared_document', weight: 3.0}]->(b)"
        )
        conn.execute(
            "MATCH (a:Concept {name: 'Derivatives'}), (b:Concept {name: 'Chain Rule'}) "
            "CREATE (a)-[:RELATED_TO {reason: 'shared_document', weight: 2.0}]->(b)"
        )
        conn.execute(
            "MATCH (a:Concept {name: 'Calculus'}), (b:Concept {name: 'Continuity'}) "
            "CREATE (a)-[:RELATED_TO {reason: 'shared_document', weight: 1.0}]->(b)"
        )

    def test_build_chunk_seed_set_returns_ordered_seed_chunks(self, lance_path):
        _db, table = self._seed_chunk_table(lance_path)
        seed_chunks = build_chunk_seed_set(table, _vector(1.0, 0.0), limit=2)

        assert len(seed_chunks) == 2
        assert isinstance(seed_chunks[0], ChunkHit)
        assert [chunk.chunk_id for chunk in seed_chunks] == ["chunk-1", "chunk-3"]

    def test_score_source_concepts_from_seed_chunks_applies_exact_match_bonus(self):
        seed_chunks = [
            ChunkHit(
                chunk_id="chunk-1",
                doc_id="doc-1",
                doc_name="Doc 1",
                text="Limits support continuity.",
                concepts=("Limits", "Continuity"),
                rank=0,
            ),
            ChunkHit(
                chunk_id="chunk-2",
                doc_id="doc-2",
                doc_name="Doc 2",
                text="Calculus uses limits.",
                concepts=("Calculus", "Limits"),
                rank=1,
            ),
        ]

        hits = score_source_concepts_from_seed_chunks(
            seed_chunks,
            "How are limits related to continuity?",
            limit=5,
        )

        assert [hit.name for hit in hits] == ["Limits", "Continuity", "Calculus"]
        assert hits[0].score == 3.5
        assert hits[1].score == 3.0
        assert hits[2].score == 0.5

    def test_expand_weighted_related_concepts_uses_edge_weights_and_hops(self, kuzu_path):
        kuzu_db, conn = init_kuzu(kuzu_path)
        self._seed_graph(conn)

        hits = [
            SourceConceptHit(
                name="Limits",
                score=4.0,
                matched_chunk_ids=("chunk-1",),
            )
        ]
        discovered = expand_weighted_related_concepts(
            conn,
            hits,
            max_hops=2,
            max_discovery_concepts=10,
        )

        assert [concept.name for concept in discovered] == ["Derivatives", "Chain Rule"]
        assert discovered[0].score == 12.0
        assert discovered[1].score == 4.0
        assert discovered[1].min_hop == 2

        conn.close()
        kuzu_db.close()

    def test_find_latent_document_hits_excludes_seed_docs_and_ranks_by_best_support(self, lance_path):
        db, table = self._seed_chunk_table(lance_path)
        chunks_df = table.to_pandas()

        hits = find_latent_document_hits(
            db,
            chunks_df,
            ranked_concepts=[("Limits", 1.0), ("Derivatives", 0.5)],
            excluded_doc_ids={"seed-doc", "seed-doc-2"},
            limit=5,
        )

        assert len(hits) == 1
        assert hits[0].doc_id == "latent-doc"
        assert hits[0].supporting_concepts == ("Limits",)

    def test_select_top_chunks_for_documents_returns_best_chunks_per_doc(self, lance_path):
        _db, table = self._seed_chunk_table(lance_path)
        df = table.to_pandas()

        chunks = select_top_chunks_for_documents(
            df,
            query_vector=_vector(1.0, 0.0),
            latent_documents=[
                type(
                    "DocHit",
                    (),
                    {
                        "doc_id": "latent-doc",
                        "doc_name": "Latent Doc",
                    },
                )()
            ],
            per_document_limit=1,
        )

        assert [chunk.chunk_id for chunk in chunks] == ["chunk-3"]

    def test_run_local_search_returns_weighted_discovery_and_latent_docs(self, lance_path, kuzu_path):
        db, table = self._seed_chunk_table(lance_path)
        kuzu_db, conn = init_kuzu(kuzu_path)
        self._seed_graph(conn)

        result = run_local_search(
            db,
            table,
            conn,
            "How are limits related to continuity?",
            _vector(1.0, 0.0),
            RetrievalConfig(
                seed_chunk_limit=1,
                source_concept_limit=2,
                max_graph_hops=2,
                latent_doc_limit=5,
                latent_doc_chunk_limit=1,
            ),
        )

        assert result.seed_chunks
        assert result.source_concepts
        assert result.discovery_concepts
        assert result.latent_documents
        assert result.discovery_chunks

        conn.close()
        kuzu_db.close()
