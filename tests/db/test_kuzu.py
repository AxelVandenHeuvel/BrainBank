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

    def test_document_table_exists(self, kuzu_path):
        db, conn = init_kuzu(kuzu_path)
        result = conn.execute("MATCH (d:Document) RETURN count(d)")
        assert result.has_next()
        assert result.get_next()[0] == 0

    def test_idempotent_init(self, kuzu_path):
        """Calling init twice (sequentially) should not error."""
        db1, conn1 = init_kuzu(kuzu_path)
        conn1.close()
        db1.close()
        db2, conn2 = init_kuzu(kuzu_path)
        assert conn2 is not None

    # --- New node table tests ---

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

    # --- New relationship table tests ---

    def test_part_of_relationship(self, kuzu_path):
        db, conn = init_kuzu(kuzu_path)
        conn.execute("CREATE (:Concept {name: 'Calculus'})")
        conn.execute("CREATE (:Concept {name: 'Mathematics'})")
        conn.execute("MATCH (a:Concept {name: 'Calculus'}), (b:Concept {name: 'Mathematics'}) CREATE (a)-[:PART_OF]->(b)")
        result = conn.execute("MATCH (a:Concept)-[:PART_OF]->(b:Concept) RETURN a.name, b.name")
        assert result.has_next()
        row = result.get_next()
        assert row[0] == "Calculus"
        assert row[1] == "Mathematics"

    def test_inspired_by_relationship(self, kuzu_path):
        db, conn = init_kuzu(kuzu_path)
        conn.execute("CREATE (:Concept {name: 'Zettelkasten'})")
        conn.execute("CREATE (:Concept {name: 'PKM'})")
        conn.execute("MATCH (a:Concept {name: 'PKM'}), (b:Concept {name: 'Zettelkasten'}) CREATE (a)-[:INSPIRED_BY]->(b)")
        result = conn.execute("MATCH (a:Concept)-[:INSPIRED_BY]->(b:Concept) RETURN a.name")
        assert result.has_next()
        assert result.get_next()[0] == "PKM"

    def test_depends_on_relationship(self, kuzu_path):
        db, conn = init_kuzu(kuzu_path)
        conn.execute("CREATE (:Concept {name: 'Integration'})")
        conn.execute("CREATE (:Concept {name: 'Limits'})")
        conn.execute("MATCH (a:Concept {name: 'Integration'}), (b:Concept {name: 'Limits'}) CREATE (a)-[:DEPENDS_ON]->(b)")
        result = conn.execute("MATCH (a:Concept)-[:DEPENDS_ON]->(b:Concept) RETURN b.name")
        assert result.has_next()
        assert result.get_next()[0] == "Limits"

    def test_learned_from_relationship(self, kuzu_path):
        db, conn = init_kuzu(kuzu_path)
        conn.execute("CREATE (:Concept {name: 'TDD'})")
        conn.execute("CREATE (:Concept {name: 'XP'})")
        conn.execute("MATCH (a:Concept {name: 'TDD'}), (b:Concept {name: 'XP'}) CREATE (a)-[:LEARNED_FROM]->(b)")
        result = conn.execute("MATCH (a:Concept)-[:LEARNED_FROM]->(b:Concept) RETURN a.name")
        assert result.has_next()
        assert result.get_next()[0] == "TDD"

    def test_has_task_relationship(self, kuzu_path):
        db, conn = init_kuzu(kuzu_path)
        conn.execute("CREATE (:Project {name: 'BrainBank', status: 'active'})")
        conn.execute("CREATE (:Task {task_id: 't2', name: 'Add schema', status: 'open'})")
        conn.execute("MATCH (p:Project {name: 'BrainBank'}), (t:Task {task_id: 't2'}) CREATE (p)-[:HAS_TASK]->(t)")
        result = conn.execute("MATCH (p:Project)-[:HAS_TASK]->(t:Task) RETURN t.name")
        assert result.has_next()
        assert result.get_next()[0] == "Add schema"

    def test_uses_concept_relationship(self, kuzu_path):
        db, conn = init_kuzu(kuzu_path)
        conn.execute("CREATE (:Project {name: 'BrainBank', status: 'active'})")
        conn.execute("CREATE (:Concept {name: 'RAG'})")
        conn.execute("MATCH (p:Project {name: 'BrainBank'}), (c:Concept {name: 'RAG'}) CREATE (p)-[:USES_CONCEPT]->(c)")
        result = conn.execute("MATCH (p:Project)-[:USES_CONCEPT]->(c:Concept) RETURN c.name")
        assert result.has_next()
        assert result.get_next()[0] == "RAG"

    def test_has_reflection_relationship(self, kuzu_path):
        db, conn = init_kuzu(kuzu_path)
        conn.execute("CREATE (:Document {doc_id: 'd1', name: 'Journal'})")
        conn.execute("CREATE (:Reflection {reflection_id: 'r2', text: 'Key insight'})")
        conn.execute("MATCH (d:Document {doc_id: 'd1'}), (r:Reflection {reflection_id: 'r2'}) CREATE (d)-[:HAS_REFLECTION]->(r)")
        result = conn.execute("MATCH (d:Document)-[:HAS_REFLECTION]->(r:Reflection) RETURN r.text")
        assert result.has_next()
        assert result.get_next()[0] == "Key insight"

    def test_mentions_project_relationship(self, kuzu_path):
        db, conn = init_kuzu(kuzu_path)
        conn.execute("CREATE (:Document {doc_id: 'd2', name: 'Notes'})")
        conn.execute("CREATE (:Project {name: 'SideProject', status: 'active'})")
        conn.execute("MATCH (d:Document {doc_id: 'd2'}), (p:Project {name: 'SideProject'}) CREATE (d)-[:MENTIONS_PROJECT]->(p)")
        result = conn.execute("MATCH (d:Document)-[:MENTIONS_PROJECT]->(p:Project) RETURN p.name")
        assert result.has_next()
        assert result.get_next()[0] == "SideProject"

    def test_mentions_task_relationship(self, kuzu_path):
        db, conn = init_kuzu(kuzu_path)
        conn.execute("CREATE (:Document {doc_id: 'd3', name: 'Meeting notes'})")
        conn.execute("CREATE (:Task {task_id: 't3', name: 'Follow up', status: 'open'})")
        conn.execute("MATCH (d:Document {doc_id: 'd3'}), (t:Task {task_id: 't3'}) CREATE (d)-[:MENTIONS_TASK]->(t)")
        result = conn.execute("MATCH (d:Document)-[:MENTIONS_TASK]->(t:Task) RETURN t.name")
        assert result.has_next()
        assert result.get_next()[0] == "Follow up"
