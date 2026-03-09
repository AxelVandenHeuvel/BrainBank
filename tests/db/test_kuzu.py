from pathlib import Path

import pytest

import backend.db.kuzu as kuzu_module
from backend.db.kuzu import init_kuzu, merge_concepts
from backend.db.lance import init_lancedb


class TestInitKuzu:
    def test_returns_db_and_conn(self, kuzu_path):
        db, conn = init_kuzu(kuzu_path)
        assert db is not None
        assert conn is not None

    def test_concept_table_exists(self, kuzu_path):
        _, conn = init_kuzu(kuzu_path)
        result = conn.execute("MATCH (c:Concept) RETURN count(c)")
        assert result.has_next()
        assert result.get_next()[0] == 0

    def test_concept_stores_color_score(self, kuzu_path):
        _, conn = init_kuzu(kuzu_path)
        conn.execute("CREATE (:Concept {name: 'Calculus', colorScore: 0.15})")
        result = conn.execute("MATCH (c:Concept {name: 'Calculus'}) RETURN c.colorScore")
        assert result.has_next()
        assert abs(result.get_next()[0] - 0.15) < 1e-9

    def test_idempotent_init(self, kuzu_path):
        """Calling init twice (sequentially) should not error."""
        db1, conn1 = init_kuzu(kuzu_path)
        conn1.close()
        db1.close()
        _, conn2 = init_kuzu(kuzu_path)
        assert conn2 is not None

    def test_surfaces_a_clear_error_when_kuzu_open_fails_with_binding_index_error(
        self,
        monkeypatch,
        kuzu_path,
    ):
        def raise_index_error(_db_path):
            raise IndexError("unordered_map::at: key not found")

        monkeypatch.setattr(kuzu_module.kuzu, "Database", raise_index_error)

        with pytest.raises(RuntimeError, match="Another process may already be using it"):
            init_kuzu(kuzu_path)

    def test_surfaces_a_clear_error_for_alternate_kuzu_index_error_message(
        self,
        monkeypatch,
        kuzu_path,
    ):
        def raise_index_error(_db_path):
            raise IndexError("invalid unordered_map<K, T> key")

        monkeypatch.setattr(kuzu_module.kuzu, "Database", raise_index_error)

        with pytest.raises(RuntimeError, match="Another process may already be using it"):
            init_kuzu(kuzu_path)

    # --- Relationship table tests ---

    def test_related_to_relationship(self, kuzu_path):
        _, conn = init_kuzu(kuzu_path)
        conn.execute("CREATE (:Concept {name: 'Calculus'})")
        conn.execute("CREATE (:Concept {name: 'Mathematics'})")
        conn.execute(
            "MATCH (a:Concept {name: 'Calculus'}), (b:Concept {name: 'Mathematics'}) "
            "CREATE (a)-[:RELATED_TO {reason: 'subfield', weight: 1.0}]->(b)"
        )
        result = conn.execute(
            "MATCH (a:Concept)-[r:RELATED_TO]->(b:Concept) RETURN a.name, b.name, r.reason, r.weight"
        )
        assert result.has_next()
        row = result.get_next()
        assert row[0] == "Calculus"
        assert row[1] == "Mathematics"
        assert row[2] == "subfield"
        assert row[3] == 1.0

    def test_concept_stores_community_id(self, kuzu_path):
        _, conn = init_kuzu(kuzu_path)
        conn.execute("CREATE (:Concept {name: 'TestConcept'})")
        conn.execute(
            "MATCH (c:Concept {name: 'TestConcept'}) SET c.community_id = 3"
        )
        result = conn.execute(
            "MATCH (c:Concept {name: 'TestConcept'}) RETURN c.community_id"
        )
        assert result.has_next()
        assert result.get_next()[0] == 3

    def test_update_node_communities_sets_community_ids(self, kuzu_path):
        from backend.db.kuzu import update_node_communities

        _, conn = init_kuzu(kuzu_path)
        conn.execute("CREATE (:Concept {name: 'Alpha'})")
        conn.execute("CREATE (:Concept {name: 'Beta'})")

        update_node_communities(conn, {"Alpha": 0, "Beta": 1})

        r1 = conn.execute("MATCH (c:Concept {name: 'Alpha'}) RETURN c.community_id")
        r2 = conn.execute("MATCH (c:Concept {name: 'Beta'}) RETURN c.community_id")
        assert r1.get_next()[0] == 0
        assert r2.get_next()[0] == 1

    def test_get_kuzu_engine_repairs_broken_catalog_and_rebuilds_from_lancedb(
        self,
        monkeypatch,
        lance_path,
        kuzu_path,
    ):
        _db, table = init_lancedb(lance_path)
        table.add(
            [
                {
                    "chunk_id": "chunk-1",
                    "doc_id": "doc-1",
                    "doc_name": "Math Notes",
                    "text": "Calculus and derivatives.",
                    "concepts": ["Calculus", "Derivatives"],
                    "vector": [0.0] * 384,
                },
                {
                    "chunk_id": "chunk-2",
                    "doc_id": "doc-1",
                    "doc_name": "Math Notes",
                    "text": "Calculus and limits.",
                    "concepts": ["Calculus", "Limits"],
                    "vector": [0.0] * 384,
                },
            ]
        )
        Path(kuzu_path).write_text("not a valid kuzu catalog")
        monkeypatch.setattr(kuzu_module, "_db_instance", None)

        repaired_db = kuzu_module.get_kuzu_engine(kuzu_path, lance_path)
        conn = kuzu_module.kuzu.Connection(repaired_db)

        try:
            result = conn.execute(
                "MATCH (c:Concept) RETURN c.name, c.colorScore, c.community_id"
            )
            nodes = []
            while result.has_next():
                nodes.append(result.get_next())

            assert sorted(name for name, _, _ in nodes) == [
                "Calculus",
                "Derivatives",
                "Limits",
            ]
            assert all(color_score == 0.5 for _, color_score, _ in nodes)
            assert all(community_id is not None for _, _, community_id in nodes)

            edge_result = conn.execute(
                "MATCH (a:Concept {name: 'Calculus'})-[r:RELATED_TO]->"
                "(b:Concept {name: 'Derivatives'}) RETURN r.weight, r.reason"
            )
            assert edge_result.has_next()
            assert edge_result.get_next() == [1.0, "shared_document"]
        finally:
            conn.close()
            repaired_db.close()

        backups = list(Path(kuzu_path).parent.glob(f"{Path(kuzu_path).name}.invalid.*"))
        assert backups

    def test_merge_concepts_moves_edges_sums_weights_and_deletes_source(self, kuzu_path):
        _, conn = init_kuzu(kuzu_path)
        conn.execute("CREATE (:Concept {name: 'Definite Integrals'})")
        conn.execute("CREATE (:Concept {name: 'Integrals'})")
        conn.execute("CREATE (:Concept {name: 'Chain Rule'})")
        conn.execute("CREATE (:Concept {name: 'Calculus'})")

        conn.execute(
            "MATCH (a:Concept {name: 'Definite Integrals'}), (b:Concept {name: 'Chain Rule'}) "
            "CREATE (a)-[:RELATED_TO {reason: 'shared_document', weight: 2.0, edge_type: 'RELATED_TO'}]->(b)"
        )
        conn.execute(
            "MATCH (a:Concept {name: 'Integrals'}), (b:Concept {name: 'Chain Rule'}) "
            "CREATE (a)-[:RELATED_TO {reason: 'shared_document', weight: 1.5, edge_type: 'RELATED_TO'}]->(b)"
        )
        conn.execute(
            "MATCH (a:Concept {name: 'Calculus'}), (b:Concept {name: 'Definite Integrals'}) "
            "CREATE (a)-[:RELATED_TO {reason: 'shared_document', weight: 1.0, edge_type: 'RELATED_TO'}]->(b)"
        )

        merge_concepts(conn, "Definite Integrals", "Integrals")

        source = conn.execute("MATCH (c:Concept {name: 'Definite Integrals'}) RETURN count(c)")
        assert source.get_next()[0] == 0

        outgoing = conn.execute(
            "MATCH (a:Concept {name: 'Integrals'})-[r:RELATED_TO]->(b:Concept {name: 'Chain Rule'}) "
            "RETURN r.weight"
        )
        assert outgoing.has_next()
        assert outgoing.get_next()[0] == 3.5

        incoming = conn.execute(
            "MATCH (a:Concept {name: 'Calculus'})-[r:RELATED_TO]->(b:Concept {name: 'Integrals'}) "
            "RETURN r.weight"
        )
        assert incoming.has_next()
        assert incoming.get_next()[0] == 1.0

    def test_merge_concepts_noops_when_source_equals_target(self, kuzu_path):
        _, conn = init_kuzu(kuzu_path)
        conn.execute("CREATE (:Concept {name: 'Integrals'})")

        merge_concepts(conn, "Integrals", "Integrals")

        result = conn.execute("MATCH (c:Concept {name: 'Integrals'}) RETURN count(c)")
        assert result.get_next()[0] == 1
