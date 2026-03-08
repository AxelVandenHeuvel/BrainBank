from backend.db.lance import init_lancedb, find_existing_document
from tests.conftest import mock_embed_texts


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


class TestFindExistingDocument:
    def test_returns_none_when_no_match(self, lance_path):
        """Should return None when no document with the given title exists."""
        result = find_existing_document("Nonexistent Doc", lance_path)
        assert result is None

    def test_returns_doc_info_when_match_exists(self, lance_path):
        """Should return doc_id and doc_name when a matching document exists."""
        db, table = init_lancedb(lance_path)
        vec = mock_embed_texts(["test chunk"])[0]
        table.add([{
            "chunk_id": "chunk-1",
            "doc_id": "doc-123",
            "doc_name": "Math Notes",
            "text": "test chunk",
            "concepts": ["Calculus"],
            "vector": vec,
        }])

        result = find_existing_document("Math Notes", lance_path)
        assert result is not None
        assert result["doc_id"] == "doc-123"
        assert result["doc_name"] == "Math Notes"

    def test_returns_none_for_different_title(self, lance_path):
        """Should not match documents with different titles."""
        db, table = init_lancedb(lance_path)
        vec = mock_embed_texts(["test chunk"])[0]
        table.add([{
            "chunk_id": "chunk-1",
            "doc_id": "doc-123",
            "doc_name": "Math Notes",
            "text": "test chunk",
            "concepts": ["Calculus"],
            "vector": vec,
        }])

        result = find_existing_document("Physics Notes", lance_path)
        assert result is None
