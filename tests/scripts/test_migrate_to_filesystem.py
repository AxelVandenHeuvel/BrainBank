import os

import pytest

from backend.db.lance import init_lancedb
from backend.db.manifest import Manifest
from backend.scripts.migrate_to_filesystem import migrate_lancedb_to_filesystem


@pytest.fixture
def populated_lance(lance_path):
    """Insert a few fake documents into LanceDB."""
    _, table = init_lancedb(lance_path)
    table.add([
        {
            "chunk_id": "c1",
            "doc_id": "demo:calc",
            "doc_name": "Calculus Notes",
            "text": "Calculus paragraph one.",
            "concepts": ["Calculus"],
            "vector": [0.0] * 384,
        },
        {
            "chunk_id": "c2",
            "doc_id": "demo:calc",
            "doc_name": "Calculus Notes",
            "text": "Calculus paragraph two.",
            "concepts": ["Calculus"],
            "vector": [0.0] * 384,
        },
        {
            "chunk_id": "c3",
            "doc_id": "demo:physics",
            "doc_name": "Physics Notes",
            "text": "Physics content here.",
            "concepts": ["Physics"],
            "vector": [0.0] * 384,
        },
    ])
    return lance_path


class TestMigrateToFilesystem:
    def test_writes_md_files_for_each_document(self, populated_lance, tmp_path):
        notes_dir = str(tmp_path / "notes")

        result = migrate_lancedb_to_filesystem(populated_lance, notes_dir)

        assert result["migrated"] == 2
        files = os.listdir(notes_dir)
        md_files = [f for f in files if f.endswith(".md")]
        assert len(md_files) == 2

    def test_registers_documents_in_manifest(self, populated_lance, tmp_path):
        notes_dir = str(tmp_path / "notes")

        migrate_lancedb_to_filesystem(populated_lance, notes_dir)

        manifest = Manifest(notes_dir)
        all_rows = manifest.list_all()
        manifest.close()

        doc_ids = {r["doc_id"] for r in all_rows}
        assert "demo:calc" in doc_ids
        assert "demo:physics" in doc_ids
        assert all(r["is_managed"] for r in all_rows)

    def test_file_content_is_joined_chunks(self, populated_lance, tmp_path):
        notes_dir = str(tmp_path / "notes")

        migrate_lancedb_to_filesystem(populated_lance, notes_dir)

        manifest = Manifest(notes_dir)
        row = manifest.get("demo:calc")
        manifest.close()

        with open(row["file_path"], encoding="utf-8") as f:
            text = f.read()
        assert "Calculus paragraph one." in text
        assert "Calculus paragraph two." in text

    def test_skips_documents_already_in_manifest(self, populated_lance, tmp_path):
        notes_dir = str(tmp_path / "notes")

        migrate_lancedb_to_filesystem(populated_lance, notes_dir)
        result = migrate_lancedb_to_filesystem(populated_lance, notes_dir)

        assert result["migrated"] == 0
        assert result["skipped"] == 2
