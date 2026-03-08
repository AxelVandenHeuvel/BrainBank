from backend.db.kuzu import init_kuzu


class TestInitKuzu:
    def test_returns_db_and_conn(self, kuzu_path):
        db, conn = init_kuzu(kuzu_path)
        assert db is not None
        assert conn is not None

    def test_concept_table_exists(self, kuzu_path):
        db, conn = init_kuzu(kuzu_path)
        result = conn.execute("MATCH (c:Concept) RETURN count(c)")
        assert result.has_next()
        assert result.get_next()[0] == 0

    def test_concept_stores_color_score(self, kuzu_path):
        db, conn = init_kuzu(kuzu_path)
        conn.execute("CREATE (:Concept {name: 'Calculus', colorScore: 0.15})")
        result = conn.execute("MATCH (c:Concept {name: 'Calculus'}) RETURN c.colorScore")
        assert result.has_next()
        assert abs(result.get_next()[0] - 0.15) < 1e-9

    def test_idempotent_init(self, kuzu_path):
        """Calling init twice (sequentially) should not error."""
        db1, conn1 = init_kuzu(kuzu_path)
        conn1.close()
        db1.close()
        db2, conn2 = init_kuzu(kuzu_path)
        assert conn2 is not None

    # --- Node table tests ---

    def test_project_table_exists(self, kuzu_path):
        db, conn = init_kuzu(kuzu_path)
        result = conn.execute("MATCH (p:Project) RETURN count(p)")
        assert result.has_next()
        assert result.get_next()[0] == 0

    def test_project_insert_and_query(self, kuzu_path):
        db, conn = init_kuzu(kuzu_path)
        conn.execute("CREATE (:Project {name: 'BrainBank', status: 'active'})")
        result = conn.execute("MATCH (p:Project {name: 'BrainBank'}) RETURN p.name")
        assert result.has_next()
        assert result.get_next()[0] == "BrainBank"

    def test_task_table_exists(self, kuzu_path):
        db, conn = init_kuzu(kuzu_path)
        result = conn.execute("MATCH (t:Task) RETURN count(t)")
        assert result.has_next()
        assert result.get_next()[0] == 0

    def test_task_insert_and_query(self, kuzu_path):
        db, conn = init_kuzu(kuzu_path)
        conn.execute("CREATE (:Task {task_id: 't1', name: 'Write tests', status: 'open'})")
        result = conn.execute("MATCH (t:Task {task_id: 't1'}) RETURN t.name")
        assert result.has_next()
        assert result.get_next()[0] == "Write tests"

    def test_reflection_table_exists(self, kuzu_path):
        db, conn = init_kuzu(kuzu_path)
        result = conn.execute("MATCH (r:Reflection) RETURN count(r)")
        assert result.has_next()
        assert result.get_next()[0] == 0

    def test_reflection_insert_and_query(self, kuzu_path):
        db, conn = init_kuzu(kuzu_path)
        conn.execute("CREATE (:Reflection {reflection_id: 'r1', text: 'I learned something'})")
        result = conn.execute("MATCH (r:Reflection {reflection_id: 'r1'}) RETURN r.text")
        assert result.has_next()
        assert result.get_next()[0] == "I learned something"

    # --- Relationship table tests ---

    def test_related_to_relationship(self, kuzu_path):
        db, conn = init_kuzu(kuzu_path)
        conn.execute("CREATE (:Concept {name: 'Calculus'})")
        conn.execute("CREATE (:Concept {name: 'Mathematics'})")
        conn.execute(
            "MATCH (a:Concept {name: 'Calculus'}), (b:Concept {name: 'Mathematics'}) "
            "CREATE (a)-[:RELATED_TO {reason: 'subfield'}]->(b)"
        )
        result = conn.execute(
            "MATCH (a:Concept)-[r:RELATED_TO]->(b:Concept) RETURN a.name, b.name, r.reason"
        )
        assert result.has_next()
        row = result.get_next()
        assert row[0] == "Calculus"
        assert row[1] == "Mathematics"
        assert row[2] == "subfield"

    def test_has_task_relationship(self, kuzu_path):
        db, conn = init_kuzu(kuzu_path)
        conn.execute("CREATE (:Project {name: 'BrainBank', status: 'active'})")
        conn.execute("CREATE (:Task {task_id: 't2', name: 'Add schema', status: 'open'})")
        conn.execute(
            "MATCH (p:Project {name: 'BrainBank'}), (t:Task {task_id: 't2'}) "
            "CREATE (p)-[:HAS_TASK]->(t)"
        )
        result = conn.execute("MATCH (p:Project)-[:HAS_TASK]->(t:Task) RETURN t.name")
        assert result.has_next()
        assert result.get_next()[0] == "Add schema"

    def test_applied_to_project_relationship(self, kuzu_path):
        db, conn = init_kuzu(kuzu_path)
        conn.execute("CREATE (:Concept {name: 'RAG'})")
        conn.execute("CREATE (:Project {name: 'BrainBank', status: 'active'})")
        conn.execute(
            "MATCH (c:Concept {name: 'RAG'}), (p:Project {name: 'BrainBank'}) "
            "CREATE (c)-[:APPLIED_TO_PROJECT]->(p)"
        )
        result = conn.execute(
            "MATCH (c:Concept)-[:APPLIED_TO_PROJECT]->(p:Project) RETURN p.name"
        )
        assert result.has_next()
        assert result.get_next()[0] == "BrainBank"

    def test_generated_task_relationship(self, kuzu_path):
        db, conn = init_kuzu(kuzu_path)
        conn.execute("CREATE (:Concept {name: 'TDD'})")
        conn.execute("CREATE (:Task {task_id: 't3', name: 'Write failing test', status: 'open'})")
        conn.execute(
            "MATCH (c:Concept {name: 'TDD'}), (t:Task {task_id: 't3'}) "
            "CREATE (c)-[:GENERATED_TASK]->(t)"
        )
        result = conn.execute(
            "MATCH (c:Concept)-[:GENERATED_TASK]->(t:Task) RETURN t.name"
        )
        assert result.has_next()
        assert result.get_next()[0] == "Write failing test"

    def test_sparked_reflection_relationship(self, kuzu_path):
        db, conn = init_kuzu(kuzu_path)
        conn.execute("CREATE (:Concept {name: 'Recursion'})")
        conn.execute("CREATE (:Reflection {reflection_id: 'r2', text: 'Recursion clicked today'})")
        conn.execute(
            "MATCH (c:Concept {name: 'Recursion'}), (r:Reflection {reflection_id: 'r2'}) "
            "CREATE (c)-[:SPARKED_REFLECTION]->(r)"
        )
        result = conn.execute(
            "MATCH (c:Concept)-[:SPARKED_REFLECTION]->(r:Reflection) RETURN r.text"
        )
        assert result.has_next()
        assert result.get_next()[0] == "Recursion clicked today"
