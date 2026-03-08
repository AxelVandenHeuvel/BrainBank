import pytest

from backend.db.kuzu import init_kuzu
from backend.services.clustering import run_leiden_clustering


def _make_concept(conn, name: str) -> None:
    conn.execute("MERGE (:Concept {name: $name})", parameters={"name": name})


def _make_edge(conn, a: str, b: str, weight: float = 1.0) -> None:
    conn.execute(
        "MATCH (a:Concept {name: $a}), (b:Concept {name: $b}) "
        "CREATE (a)-[:RELATED_TO {reason: 'shared', weight: $w}]->(b)",
        parameters={"a": a, "b": b, "w": weight},
    )


class TestRunLeidenClustering:
    def test_returns_dict_mapping_concept_to_int(self, kuzu_path):
        _, conn = init_kuzu(kuzu_path)
        for name in ["Math", "Calculus", "Algebra", "Physics", "Mechanics"]:
            _make_concept(conn, name)
        _make_edge(conn, "Math", "Calculus", 3.0)
        _make_edge(conn, "Math", "Algebra", 2.0)
        _make_edge(conn, "Physics", "Mechanics", 3.0)

        result = run_leiden_clustering(conn)

        assert isinstance(result, dict)
        assert set(result.keys()) == {"Math", "Calculus", "Algebra", "Physics", "Mechanics"}
        assert all(isinstance(v, int) for v in result.values())

    def test_empty_graph_returns_empty_dict(self, kuzu_path):
        _, conn = init_kuzu(kuzu_path)

        result = run_leiden_clustering(conn)

        assert result == {}

    def test_single_node_returns_community_zero(self, kuzu_path):
        _, conn = init_kuzu(kuzu_path)
        _make_concept(conn, "Solo")

        result = run_leiden_clustering(conn)

        assert result == {"Solo": 0}

    def test_isolated_nodes_each_get_a_community(self, kuzu_path):
        _, conn = init_kuzu(kuzu_path)
        _make_concept(conn, "A")
        _make_concept(conn, "B")

        result = run_leiden_clustering(conn)

        assert set(result.keys()) == {"A", "B"}
        assert all(isinstance(v, int) for v in result.values())

    def test_dense_clusters_share_communities(self, kuzu_path):
        """Two isolated cliques should land in distinct communities."""
        _, conn = init_kuzu(kuzu_path)
        for name in ["Math", "Calculus", "Algebra"]:
            _make_concept(conn, name)
        for name in ["Biology", "Cells", "DNA"]:
            _make_concept(conn, name)

        _make_edge(conn, "Math", "Calculus", 10.0)
        _make_edge(conn, "Math", "Algebra", 10.0)
        _make_edge(conn, "Calculus", "Algebra", 10.0)
        _make_edge(conn, "Biology", "Cells", 10.0)
        _make_edge(conn, "Biology", "DNA", 10.0)
        _make_edge(conn, "Cells", "DNA", 10.0)

        result = run_leiden_clustering(conn)

        assert result["Math"] == result["Calculus"] == result["Algebra"]
        assert result["Biology"] == result["Cells"] == result["DNA"]
        assert result["Math"] != result["Biology"]
