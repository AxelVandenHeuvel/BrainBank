from brainbank.engine_setup import init_lancedb, init_kuzu


class TestInitLanceDB:
    def test_returns_db_and_table(self, lance_path):
        db, table = init_lancedb(lance_path)
        assert db is not None
        assert table is not None

    def test_table_has_correct_columns(self, lance_path):
        db, table = init_lancedb(lance_path)
        schema = table.schema
        field_names = [f.name for f in schema]
        assert "chunk_id" in field_names
        assert "doc_id" in field_names
        assert "text" in field_names
        assert "vector" in field_names

    def test_idempotent_init(self, lance_path):
        """Calling init twice should not error or duplicate tables."""
        db1, table1 = init_lancedb(lance_path)
        db2, table2 = init_lancedb(lance_path)
        assert table2 is not None


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
