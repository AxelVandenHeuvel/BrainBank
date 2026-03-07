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
        """Calling init twice should not error."""
        db1, conn1 = init_kuzu(kuzu_path)
        db2, conn2 = init_kuzu(kuzu_path)
        assert conn2 is not None
