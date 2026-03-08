from backend.db.lance import init_lancedb, find_existing_document, delete_document_chunks
from tests.conftest import mock_embed_texts


class TestInitLanceDB:
    def test_returns_db_and_table(self, lance_path):
        db, table = init_lancedb(lance_path)
        assert db is not None
        assert table is not None

    def test_table_has_correct_columns(self, lance_path):
        _, table = init_lancedb(lance_path)
        schema = table.schema
        field_names = [f.name for f in schema]
        assert "chunk_id" in field_names
        assert "doc_id" in field_names
        assert "text" in field_names
        assert "vector" in field_names

    def test_idempotent_init(self, lance_path):
        """Calling init twice should not error or duplicate tables."""
        _, _table1 = init_lancedb(lance_path)
        _, table2 = init_lancedb(lance_path)
        assert table2 is not None


class TestFindExistingDocument:
    def test_returns_none_when_no_match(self, lance_path):
        """Should return None when no document with the given title exists."""
        result = find_existing_document("Nonexistent Doc", lance_path)
        assert result is None

    def test_returns_doc_info_when_match_exists(self, lance_path):
        """Should return doc_id and doc_name when a matching document exists."""
        _, table = init_lancedb(lance_path)
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
        _, table = init_lancedb(lance_path)
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

    def test_creates_document_centroids_table(self, lance_path):
        db, _ = init_lancedb(lance_path)
        centroid_table = db.open_table("document_centroids")

        schema = centroid_table.schema
        field_names = [f.name for f in schema]
        assert "doc_id" in field_names
        assert "doc_name" in field_names
        assert "centroid_vector" in field_names

    def test_creates_concept_centroids_table(self, lance_path):
        db, _ = init_lancedb(lance_path)
        concept_table = db.open_table("concept_centroids")

        schema = concept_table.schema
        field_names = [f.name for f in schema]
        assert "concept_name" in field_names
        assert "centroid_vector" in field_names
        assert "document_count" in field_names

    def test_creates_community_summaries_table(self, lance_path):
        db, _ = init_lancedb(lance_path)
        community_table = db.open_table("community_summaries")

        schema = community_table.schema
        field_names = [f.name for f in schema]
        assert "community_id" in field_names
        assert "member_concepts" in field_names
        assert "summary" in field_names
        assert "summary_vector" in field_names


class TestDeleteDocumentChunks:
    def test_deletes_chunks_for_given_doc_id(self, lance_path):
        """Should delete all chunks belonging to the specified doc_id."""
        _, table = init_lancedb(lance_path)
        vec = mock_embed_texts(["chunk"])[0]
        table.add([
            {"chunk_id": "c1", "doc_id": "doc-1", "doc_name": "Doc A", "text": "a", "concepts": ["X"], "vector": vec},
            {"chunk_id": "c2", "doc_id": "doc-1", "doc_name": "Doc A", "text": "b", "concepts": ["X"], "vector": vec},
            {"chunk_id": "c3", "doc_id": "doc-2", "doc_name": "Doc B", "text": "c", "concepts": ["Y"], "vector": vec},
        ])

        deleted = delete_document_chunks(lance_path, "doc-1")
        assert deleted == 2

        # Re-open to see the updated state
        _, fresh_table = init_lancedb(lance_path)
        df = fresh_table.to_pandas()
        assert len(df) == 1
        assert df.iloc[0]["doc_id"] == "doc-2"

    def test_deletes_centroid_for_given_doc_id(self, lance_path):
        """Should also delete the document centroid row."""
        db, table = init_lancedb(lance_path)
        vec = mock_embed_texts(["chunk"])[0]
        table.add([
            {"chunk_id": "c1", "doc_id": "doc-1", "doc_name": "Doc A", "text": "a", "concepts": ["X"], "vector": vec},
        ])
        centroids = db.open_table("document_centroids")
        centroids.add([{"doc_id": "doc-1", "doc_name": "Doc A", "centroid_vector": vec}])

        delete_document_chunks(lance_path, "doc-1")

        # Re-open to see the updated state
        fresh_db, _ = init_lancedb(lance_path)
        fresh_centroids = fresh_db.open_table("document_centroids")
        centroid_df = fresh_centroids.to_pandas()
        assert len(centroid_df[centroid_df["doc_id"] == "doc-1"]) == 0

    def test_returns_zero_for_nonexistent_doc_id(self, lance_path):
        """Should return 0 when no chunks match the doc_id."""
        init_lancedb(lance_path)
        deleted = delete_document_chunks(lance_path, "nonexistent")
        assert deleted == 0

    def test_preserves_other_documents(self, lance_path):
        """Should not touch chunks or centroids belonging to other doc_ids."""
        db, table = init_lancedb(lance_path)
        vec = mock_embed_texts(["chunk"])[0]
        table.add([
            {"chunk_id": "c1", "doc_id": "doc-1", "doc_name": "Doc A", "text": "a", "concepts": ["X"], "vector": vec},
            {"chunk_id": "c2", "doc_id": "doc-2", "doc_name": "Doc B", "text": "b", "concepts": ["Y"], "vector": vec},
        ])
        centroids = db.open_table("document_centroids")
        centroids.add([
            {"doc_id": "doc-1", "doc_name": "Doc A", "centroid_vector": vec},
            {"doc_id": "doc-2", "doc_name": "Doc B", "centroid_vector": vec},
        ])

        delete_document_chunks(lance_path, "doc-1")

        # Re-open to see the updated state
        fresh_db, _ = init_lancedb(lance_path)
        fresh_centroids = fresh_db.open_table("document_centroids")
        centroid_df = fresh_centroids.to_pandas()
        assert len(centroid_df) == 1
        assert centroid_df.iloc[0]["doc_id"] == "doc-2"
