import numpy as np
import pytest

from backend.db.kuzu import init_kuzu
from backend.db.lance import init_lancedb
from backend.scripts.heal_graph import (
    _compute_concept_centroids,
    _cosine_similarity,
    _edge_exists,
    heal_graph,
)


# ---------------------------------------------------------------------------
# Unit tests for pure helpers
# ---------------------------------------------------------------------------


class TestCosineSimilarity:
    def test_identical_vectors_return_one(self):
        v = [1.0, 0.0, 0.5]
        assert abs(_cosine_similarity(v, v) - 1.0) < 1e-9

    def test_orthogonal_vectors_return_zero(self):
        a = [1.0, 0.0]
        b = [0.0, 1.0]
        assert abs(_cosine_similarity(a, b)) < 1e-9

    def test_opposite_vectors_return_negative_one(self):
        a = [1.0, 0.0]
        b = [-1.0, 0.0]
        assert abs(_cosine_similarity(a, b) + 1.0) < 1e-9

    def test_zero_vector_returns_zero(self):
        assert _cosine_similarity([0.0, 0.0], [1.0, 1.0]) == 0.0


class TestComputeConceptCentroids:
    def test_returns_empty_dict_for_empty_table(self, lance_path):
        _, table = init_lancedb(lance_path)
        result = _compute_concept_centroids(table)
        assert result == {}

    def test_computes_centroid_per_concept(self, lance_path):
        _, table = init_lancedb(lance_path)
        table.add([
            {
                "chunk_id": "c1",
                "doc_id": "d1",
                "doc_name": "Doc1",
                "text": "text",
                "concepts": ["Math"],
                "vector": [1.0, 0.0] + [0.0] * 382,
            }
        ])
        result = _compute_concept_centroids(table)
        assert "Math" in result
        assert abs(result["Math"][0] - 1.0) < 1e-6

    def test_averages_multiple_chunks_for_same_concept(self, lance_path):
        _, table = init_lancedb(lance_path)
        table.add([
            {
                "chunk_id": "c1",
                "doc_id": "d1",
                "doc_name": "Doc1",
                "text": "text",
                "concepts": ["Math"],
                "vector": [1.0, 0.0] + [0.0] * 382,
            },
            {
                "chunk_id": "c2",
                "doc_id": "d2",
                "doc_name": "Doc2",
                "text": "text",
                "concepts": ["Math"],
                "vector": [0.0, 1.0] + [0.0] * 382,
            },
        ])
        result = _compute_concept_centroids(table)
        assert abs(result["Math"][0] - 0.5) < 1e-6
        assert abs(result["Math"][1] - 0.5) < 1e-6


class TestEdgeExists:
    def test_returns_false_when_no_edge(self, kuzu_path):
        _, conn = init_kuzu(kuzu_path)
        conn.execute("CREATE (:Concept {name: 'A'})")
        conn.execute("CREATE (:Concept {name: 'B'})")
        assert not _edge_exists(conn, "A", "B")

    def test_returns_true_for_forward_edge(self, kuzu_path):
        _, conn = init_kuzu(kuzu_path)
        conn.execute("CREATE (:Concept {name: 'A'})")
        conn.execute("CREATE (:Concept {name: 'B'})")
        conn.execute(
            "MATCH (a:Concept {name: 'A'}), (b:Concept {name: 'B'}) "
            "CREATE (a)-[:RELATED_TO {reason: 'shared', weight: 1.0}]->(b)"
        )
        assert _edge_exists(conn, "A", "B")

    def test_returns_true_for_reverse_edge(self, kuzu_path):
        _, conn = init_kuzu(kuzu_path)
        conn.execute("CREATE (:Concept {name: 'A'})")
        conn.execute("CREATE (:Concept {name: 'B'})")
        conn.execute(
            "MATCH (a:Concept {name: 'A'}), (b:Concept {name: 'B'}) "
            "CREATE (a)-[:RELATED_TO {reason: 'shared', weight: 1.0}]->(b)"
        )
        # Asking B→A should also return True (undirected check)
        assert _edge_exists(conn, "B", "A")


# ---------------------------------------------------------------------------
# Integration test for heal_graph
# ---------------------------------------------------------------------------


class TestHealGraph:
    def _seed(self, lance_path, kuzu_path, concept_vectors: dict[str, list[float]]):
        """Seed Kuzu and LanceDB. Returns the open kuzu db handle (caller must close)."""
        db, conn = init_kuzu(kuzu_path)
        _, table = init_lancedb(lance_path)

        rows = []
        for i, (name, vec) in enumerate(concept_vectors.items()):
            conn.execute("MERGE (:Concept {name: $n})", parameters={"n": name})
            rows.append({
                "chunk_id": f"c{i}",
                "doc_id": f"d{i}",
                "doc_name": f"Doc{i}",
                "text": "text",
                "concepts": [name],
                "vector": vec,
            })
        table.add(rows)
        conn.close()
        return db

    def test_adds_bridge_for_similar_unconnected_concepts(self, lance_path, kuzu_path):
        # Math-Calculus similarity ~0.8 (in sweet spot [0.60, 0.90])
        db = self._seed(lance_path, kuzu_path, {
            "Math": [1.0, 0.0] + [0.0] * 382,
            "Calculus": [0.8, 0.6] + [0.0] * 382,
            "Biology": [0.0, 1.0] + [0.0] * 382,
        })

        added = heal_graph(lance_db_path=lance_path, k_neighbors=1, shared_kuzu_db=db)
        assert added > 0

        import kuzu as _kuzu
        conn = _kuzu.Connection(db)
        result = conn.execute(
            "MATCH (a:Concept)-[r:RELATED_TO]->(b:Concept) "
            "WHERE r.edge_type = 'SEMANTIC_BRIDGE' RETURN count(r)"
        )
        assert result.get_next()[0] > 0
        conn.close()

    def test_skips_already_connected_concepts(self, lance_path, kuzu_path):
        # Math-Calculus similarity ~0.8 (in sweet spot) — would be bridged if unconnected
        db = self._seed(lance_path, kuzu_path, {
            "Math": [1.0, 0.0] + [0.0] * 382,
            "Calculus": [0.8, 0.6] + [0.0] * 382,
        })

        import kuzu as _kuzu
        conn = _kuzu.Connection(db)
        conn.execute(
            "MATCH (a:Concept {name: 'Math'}), (b:Concept {name: 'Calculus'}) "
            "CREATE (a)-[:RELATED_TO {reason: 'shared', weight: 1.0}]->(b)"
        )
        conn.close()

        added = heal_graph(lance_db_path=lance_path, k_neighbors=1, shared_kuzu_db=db)
        assert added == 0

    def test_returns_zero_for_empty_lancedb(self, lance_path, kuzu_path):
        db, conn = init_kuzu(kuzu_path)
        conn.execute("MERGE (:Concept {name: 'Lone'})")
        conn.close()

        added = heal_graph(lance_db_path=lance_path, k_neighbors=3, shared_kuzu_db=db)
        assert added == 0

    def test_returns_zero_for_single_concept(self, lance_path, kuzu_path):
        db = self._seed(lance_path, kuzu_path, {
            "Solo": [1.0, 0.0] + [0.0] * 382,
        })

        added = heal_graph(lance_db_path=lance_path, k_neighbors=3, shared_kuzu_db=db)
        assert added == 0

    def test_bridge_edges_have_correct_properties(self, lance_path, kuzu_path):
        # Math-Calculus similarity ~0.8 (in sweet spot [0.60, 0.90])
        db = self._seed(lance_path, kuzu_path, {
            "Math": [1.0, 0.0] + [0.0] * 382,
            "Calculus": [0.8, 0.6] + [0.0] * 382,
        })

        heal_graph(lance_db_path=lance_path, k_neighbors=1, shared_kuzu_db=db)

        import kuzu as _kuzu
        conn = _kuzu.Connection(db)
        result = conn.execute(
            "MATCH ()-[r:RELATED_TO]->() WHERE r.edge_type = 'SEMANTIC_BRIDGE' "
            "RETURN r.reason, r.weight, r.edge_type"
        )
        assert result.has_next()
        reason, weight, edge_type = result.get_next()
        assert edge_type == "SEMANTIC_BRIDGE"
        assert "High semantic similarity discovered via embeddings" in reason
        assert 0.0 < weight <= 1.0
        conn.close()
