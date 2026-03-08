from unittest.mock import patch

from backend.db.kuzu import init_kuzu
from backend.db.lance import init_lancedb
from backend.ingestion.consolidator import ConceptConsolidator


def _vec(x: float, y: float) -> list[float]:
    return [x, y] + [0.0] * 382


class TestConceptConsolidator:
    @patch("backend.ingestion.consolidator.embed_texts")
    def test_canonicalize_concepts_maps_semantic_duplicates(self, mock_embed, lance_path, kuzu_path):
        db, chunks_table = init_lancedb(lance_path)
        concept_centroids = db.open_table("concept_centroids")
        concept_centroids.add(
            [
                {
                    "concept_name": "Integrals",
                    "centroid_vector": _vec(1.0, 0.0),
                    "document_count": 5,
                }
            ]
        )

        def _fake_embed(texts: list[str]) -> list[list[float]]:
            vectors = {
                "Definite Integrals": _vec(0.95, 0.05),
                "Probability": _vec(0.0, 1.0),
            }
            return [vectors[text] for text in texts]

        mock_embed.side_effect = _fake_embed

        _, conn = init_kuzu(kuzu_path)
        consolidator = ConceptConsolidator(
            chunks_table=chunks_table,
            concept_centroids_table=concept_centroids,
            lance_db=db,
        )

        canonical = consolidator.canonicalize_concepts(["Definite Integrals", "Probability"])

        assert canonical == ["Integrals", "Probability"]
        conn.close()

    def test_consolidate_graph_merges_underpopulated_concepts(self, lance_path, kuzu_path):
        db, chunks_table = init_lancedb(lance_path)
        concept_centroids = db.open_table("concept_centroids")
        concept_centroids.add(
            [
                {
                    "concept_name": "Definite Integrals",
                    "centroid_vector": _vec(0.95, 0.05),
                    "document_count": 2,
                },
                {
                    "concept_name": "Integrals",
                    "centroid_vector": _vec(1.0, 0.0),
                    "document_count": 4,
                },
                {
                    "concept_name": "Derivatives",
                    "centroid_vector": _vec(0.0, 1.0),
                    "document_count": 4,
                },
            ]
        )

        chunks_table.add(
            [
                {
                    "chunk_id": "c1",
                    "doc_id": "d1",
                    "doc_name": "Doc 1",
                    "text": "Definite integrals",
                    "concepts": ["Definite Integrals"],
                    "vector": _vec(0.95, 0.05),
                },
                {
                    "chunk_id": "c2",
                    "doc_id": "d2",
                    "doc_name": "Doc 2",
                    "text": "Definite integrals",
                    "concepts": ["Definite Integrals"],
                    "vector": _vec(0.95, 0.05),
                },
                {
                    "chunk_id": "c3",
                    "doc_id": "d3",
                    "doc_name": "Doc 3",
                    "text": "Integrals",
                    "concepts": ["Integrals"],
                    "vector": _vec(1.0, 0.0),
                },
                {
                    "chunk_id": "c4",
                    "doc_id": "d4",
                    "doc_name": "Doc 4",
                    "text": "Integrals",
                    "concepts": ["Integrals"],
                    "vector": _vec(1.0, 0.0),
                },
                {
                    "chunk_id": "c5",
                    "doc_id": "d5",
                    "doc_name": "Doc 5",
                    "text": "Integrals",
                    "concepts": ["Integrals"],
                    "vector": _vec(1.0, 0.0),
                },
            ]
        )

        _, conn = init_kuzu(kuzu_path)
        conn.execute("CREATE (:Concept {name: 'Definite Integrals'})")
        conn.execute("CREATE (:Concept {name: 'Integrals'})")
        conn.execute("CREATE (:Concept {name: 'Chain Rule'})")
        conn.execute(
            "MATCH (a:Concept {name: 'Definite Integrals'}), (b:Concept {name: 'Chain Rule'}) "
            "CREATE (a)-[:RELATED_TO {reason: 'shared_document', weight: 2.0, edge_type: 'RELATED_TO'}]->(b)"
        )
        conn.execute(
            "MATCH (a:Concept {name: 'Integrals'}), (b:Concept {name: 'Chain Rule'}) "
            "CREATE (a)-[:RELATED_TO {reason: 'shared_document', weight: 1.0, edge_type: 'RELATED_TO'}]->(b)"
        )

        consolidator = ConceptConsolidator(
            chunks_table=chunks_table,
            concept_centroids_table=concept_centroids,
            lance_db=db,
        )

        with patch.object(
            consolidator,
            "_select_merge_target_with_llm",
            return_value="Integrals",
        ):
            summary = consolidator.consolidate_graph(conn)

        assert summary["merged_count"] == 1

        source_result = conn.execute("MATCH (c:Concept {name: 'Definite Integrals'}) RETURN count(c)")
        assert source_result.get_next()[0] == 0

        edge_result = conn.execute(
            "MATCH (a:Concept {name: 'Integrals'})-[r:RELATED_TO]->(b:Concept {name: 'Chain Rule'}) "
            "RETURN r.weight"
        )
        assert edge_result.has_next()
        assert edge_result.get_next()[0] == 3.0

        chunk_df = chunks_table.to_pandas()
        flattened = [concept for concepts in chunk_df["concepts"].tolist() for concept in concepts]
        assert "Definite Integrals" not in flattened
        assert "Integrals" in flattened
        conn.close()
