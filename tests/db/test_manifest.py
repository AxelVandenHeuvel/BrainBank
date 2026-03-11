import os
import threading

import pytest

from backend.db.manifest import Manifest


@pytest.fixture
def manifest_dir(tmp_path):
    return str(tmp_path / "notes")


@pytest.fixture
def manifest(manifest_dir):
    m = Manifest(manifest_dir)
    yield m
    m.close()


class TestManifestInit:
    def test_creates_db_file(self, manifest_dir):
        m = Manifest(manifest_dir)
        assert os.path.exists(os.path.join(manifest_dir, ".brainbank_manifest.db"))
        m.close()

    def test_idempotent_open(self, manifest_dir):
        m1 = Manifest(manifest_dir)
        m1.upsert("abc", "/path/to/file.md", "hash123", is_managed=True)
        m1.close()

        m2 = Manifest(manifest_dir)
        row = m2.get("abc")
        m2.close()

        assert row is not None
        assert row["content_hash"] == "hash123"


class TestManifestUpsert:
    def test_insert_new_entry(self, manifest):
        manifest.upsert("doc1", "/notes/test.md", "sha256abc", is_managed=True)

        row = manifest.get("doc1")
        assert row is not None
        assert row["doc_id"] == "doc1"
        assert row["file_path"] == "/notes/test.md"
        assert row["content_hash"] == "sha256abc"
        assert row["is_managed"] is True
        assert row["status"] == "indexed"

    def test_update_existing_entry(self, manifest):
        manifest.upsert("doc1", "/notes/test.md", "hash_v1", is_managed=True)
        manifest.upsert("doc1", "/notes/test.md", "hash_v2", is_managed=True)

        row = manifest.get("doc1")
        assert row["content_hash"] == "hash_v2"

    def test_insert_unmanaged_entry(self, manifest):
        manifest.upsert("doc2", "/notes/external.md", "hashX", is_managed=False)

        row = manifest.get("doc2")
        assert row["is_managed"] is False

    def test_upsert_sets_last_indexed_at(self, manifest):
        manifest.upsert("doc1", "/notes/test.md", "hash1", is_managed=True)

        row = manifest.get("doc1")
        assert row["last_indexed_at"] is not None

    def test_custom_status(self, manifest):
        manifest.upsert("doc1", "/notes/test.md", "hash1", is_managed=True, status="pending")

        row = manifest.get("doc1")
        assert row["status"] == "pending"


class TestManifestGet:
    def test_returns_none_for_missing_doc(self, manifest):
        assert manifest.get("nonexistent") is None

    def test_get_by_file_path(self, manifest):
        manifest.upsert("doc1", "/notes/test.md", "hash1", is_managed=True)

        row = manifest.get_by_path("/notes/test.md")

        assert row is not None
        assert row["doc_id"] == "doc1"

    def test_get_by_path_returns_none_for_missing(self, manifest):
        assert manifest.get_by_path("/nonexistent.md") is None


class TestManifestListManaged:
    def test_lists_only_managed(self, manifest):
        manifest.upsert("doc1", "/notes/a.md", "h1", is_managed=True)
        manifest.upsert("doc2", "/notes/b.md", "h2", is_managed=False)
        manifest.upsert("doc3", "/notes/c.md", "h3", is_managed=True)

        managed = manifest.list_managed()

        doc_ids = [r["doc_id"] for r in managed]
        assert "doc1" in doc_ids
        assert "doc3" in doc_ids
        assert "doc2" not in doc_ids

    def test_list_all(self, manifest):
        manifest.upsert("doc1", "/notes/a.md", "h1", is_managed=True)
        manifest.upsert("doc2", "/notes/b.md", "h2", is_managed=False)

        all_rows = manifest.list_all()

        assert len(all_rows) == 2


class TestManifestAdopt:
    def test_adopt_sets_is_managed_true(self, manifest):
        manifest.upsert("doc1", "/notes/a.md", "h1", is_managed=False)

        result = manifest.adopt("doc1")

        assert result is True
        row = manifest.get("doc1")
        assert row["is_managed"] is True

    def test_adopt_returns_false_for_missing(self, manifest):
        assert manifest.adopt("nonexistent") is False


class TestManifestDelete:
    def test_delete_removes_entry(self, manifest):
        manifest.upsert("doc1", "/notes/a.md", "h1", is_managed=True)

        manifest.delete("doc1")

        assert manifest.get("doc1") is None


class TestManifestNeedsReindex:
    def test_returns_true_when_hash_differs(self, manifest):
        manifest.upsert("doc1", "/notes/a.md", "old_hash", is_managed=True)

        assert manifest.needs_reindex("doc1", "new_hash") is True

    def test_returns_false_when_hash_matches(self, manifest):
        manifest.upsert("doc1", "/notes/a.md", "same_hash", is_managed=True)

        assert manifest.needs_reindex("doc1", "same_hash") is False

    def test_returns_true_when_doc_missing(self, manifest):
        assert manifest.needs_reindex("nonexistent", "any_hash") is True


class TestManifestUpdatePath:
    def test_update_path_changes_file_path(self, manifest):
        manifest.upsert("doc1", "/notes/old_title.md", "hash1", is_managed=True)

        result = manifest.update_path("doc1", "/notes/new_title.md")

        assert result is True
        row = manifest.get("doc1")
        assert row["file_path"] == "/notes/new_title.md"
        assert row["doc_id"] == "doc1"  # doc_id unchanged

    def test_update_path_returns_false_for_missing(self, manifest):
        assert manifest.update_path("nonexistent", "/notes/foo.md") is False

    def test_update_path_preserves_other_fields(self, manifest):
        manifest.upsert("doc1", "/notes/old.md", "hash1", is_managed=True, status="indexed")

        manifest.update_path("doc1", "/notes/new.md")

        row = manifest.get("doc1")
        assert row["content_hash"] == "hash1"
        assert row["is_managed"] is True
        assert row["status"] == "indexed"


class TestManifestThreadSafety:
    def test_concurrent_writes_do_not_corrupt(self, manifest):
        errors = []

        def writer(prefix: str, count: int):
            try:
                for i in range(count):
                    manifest.upsert(f"{prefix}_{i}", f"/notes/{prefix}_{i}.md", f"hash_{i}", is_managed=True)
            except Exception as e:
                errors.append(e)

        threads = [
            threading.Thread(target=writer, args=("a", 20)),
            threading.Thread(target=writer, args=("b", 20)),
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=10)

        assert errors == []
        all_rows = manifest.list_all()
        assert len(all_rows) == 40
