from backend.db.lance import init_lancedb


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
