import os
import tempfile

import pytest

from backend.services.notes_fs import (
    write_note,
    read_note,
    list_notes,
    delete_note,
    note_path,
    rename_note,
    generate_doc_id,
)


@pytest.fixture
def notes_dir():
    with tempfile.TemporaryDirectory() as d:
        yield d


class TestWriteNote:
    def test_creates_md_file_with_content(self, notes_dir):
        path = write_note(notes_dir, "My Title", "Hello world")

        assert os.path.exists(path)
        assert path.endswith(".md")
        with open(path, encoding="utf-8") as f:
            assert f.read() == "Hello world"

    def test_filename_derived_from_title(self, notes_dir):
        path = write_note(notes_dir, "Calculus Notes", "content")

        assert os.path.basename(path) == "Calculus Notes.md"

    def test_overwrites_existing_file(self, notes_dir):
        write_note(notes_dir, "Draft", "version 1")
        path = write_note(notes_dir, "Draft", "version 2")

        with open(path, encoding="utf-8") as f:
            assert f.read() == "version 2"

    def test_creates_notes_dir_if_missing(self, notes_dir):
        nested = os.path.join(notes_dir, "sub", "folder")
        path = write_note(nested, "Deep", "content")

        assert os.path.exists(path)

    def test_sanitizes_dangerous_characters_in_title(self, notes_dir):
        path = write_note(notes_dir, "A/B\\C:D", "content")

        basename = os.path.basename(path)
        assert "/" not in basename
        assert "\\" not in basename
        assert ":" not in basename


class TestReadNote:
    def test_reads_existing_note(self, notes_dir):
        write_note(notes_dir, "Test", "some content")

        title, text = read_note(notes_dir, "Test")

        assert title == "Test"
        assert text == "some content"

    def test_returns_none_for_missing_note(self, notes_dir):
        result = read_note(notes_dir, "Nonexistent")

        assert result is None


class TestListNotes:
    def test_lists_all_md_files(self, notes_dir):
        write_note(notes_dir, "Alpha", "a")
        write_note(notes_dir, "Beta", "b")

        notes = list_notes(notes_dir)

        titles = [n["title"] for n in notes]
        assert "Alpha" in titles
        assert "Beta" in titles

    def test_returns_empty_for_empty_dir(self, notes_dir):
        assert list_notes(notes_dir) == []

    def test_ignores_non_md_files(self, notes_dir):
        write_note(notes_dir, "Real", "content")
        with open(os.path.join(notes_dir, "image.png"), "wb") as f:
            f.write(b"\x89PNG")

        notes = list_notes(notes_dir)

        assert len(notes) == 1
        assert notes[0]["title"] == "Real"


class TestDeleteNote:
    def test_deletes_existing_note(self, notes_dir):
        write_note(notes_dir, "ToDelete", "bye")

        deleted = delete_note(notes_dir, "ToDelete")

        assert deleted is True
        assert not os.path.exists(note_path(notes_dir, "ToDelete"))

    def test_returns_false_for_missing_note(self, notes_dir):
        assert delete_note(notes_dir, "Ghost") is False


class TestRenameNote:
    def test_renames_file_on_disk(self, notes_dir):
        write_note(notes_dir, "Old Title", "content here")

        new_path = rename_note(notes_dir, "Old Title", "New Title")

        assert os.path.exists(new_path)
        assert not os.path.exists(note_path(notes_dir, "Old Title"))
        assert os.path.basename(new_path) == "New Title.md"
        with open(new_path, encoding="utf-8") as f:
            assert f.read() == "content here"

    def test_returns_none_if_source_missing(self, notes_dir):
        result = rename_note(notes_dir, "Ghost", "New Name")

        assert result is None

    def test_noop_if_same_title(self, notes_dir):
        path = write_note(notes_dir, "Same", "content")

        new_path = rename_note(notes_dir, "Same", "Same")

        assert new_path == path
        assert os.path.exists(path)


class TestGenerateDocId:
    def test_returns_hex_string(self):
        doc_id = generate_doc_id()

        assert isinstance(doc_id, str)
        assert len(doc_id) == 32  # uuid4().hex is 32 hex chars
        int(doc_id, 16)  # should not raise

    def test_returns_unique_ids(self):
        ids = {generate_doc_id() for _ in range(100)}

        assert len(ids) == 100


class TestNotePath:
    def test_returns_expected_path(self, notes_dir):
        path = note_path(notes_dir, "My Note")

        assert path == os.path.join(notes_dir, "My Note.md")
