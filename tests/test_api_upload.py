"""Tests for the POST /ingest/upload endpoint, including zip and PDF asset preservation."""

import io
import os
import zipfile
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from backend.api import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def isolate_upload_data(monkeypatch, tmp_path):
    notes_dir = str(tmp_path / "notes")
    assets_dir = str(tmp_path / "assets")

    monkeypatch.setattr("backend.api.get_notes_dir", lambda: notes_dir)
    monkeypatch.setattr("backend.api.get_assets_dir", lambda: assets_dir)
    # Also patch in api_graph since Manifest opens from get_notes_dir
    monkeypatch.setattr("backend.api_graph.get_notes_dir", lambda: notes_dir)


def _make_zip(files: dict[str, bytes]) -> bytes:
    """Create an in-memory zip file from a dict of {filename: content}."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, data in files.items():
            zf.writestr(name, data)
    return buf.getvalue()


class TestUploadEndpoint:
    """Tests for single-file upload via /ingest/upload."""

    def test_upload_single_txt(self):
        file = io.BytesIO(b"Some plain text notes about math")
        resp = client.post(
            "/ingest/upload",
            files=[("files", ("notes.txt", file, "text/plain"))],
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["imported"] == 1
        assert data["results"][0]["title"] == "notes"

    def test_upload_single_md(self):
        file = io.BytesIO(b"# Physics\nForce = mass * acceleration")
        resp = client.post(
            "/ingest/upload",
            files=[("files", ("physics.md", file, "text/markdown"))],
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["imported"] == 1
        assert data["results"][0]["title"] == "physics"

    @patch("backend.api.pdf_to_text", return_value="Extracted PDF text about biology")
    def test_upload_single_pdf(self, mock_pdf):
        file = io.BytesIO(b"%PDF-fake-content")
        resp = client.post(
            "/ingest/upload",
            files=[("files", ("bio.pdf", file, "application/pdf"))],
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["imported"] == 1
        assert data["results"][0]["title"] == "bio"
        mock_pdf.assert_called_once()

    @patch("backend.api.pdf_to_text", return_value="PDF content")
    def test_upload_multiple_files(self, _mock_pdf):
        txt_file = io.BytesIO(b"Text notes")
        pdf_file = io.BytesIO(b"%PDF-fake")
        resp = client.post(
            "/ingest/upload",
            files=[
                ("files", ("notes.txt", txt_file, "text/plain")),
                ("files", ("paper.pdf", pdf_file, "application/pdf")),
            ],
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["imported"] == 2
        assert len(data["results"]) == 2

    def test_upload_unsupported_type(self):
        file = io.BytesIO(b"not a valid file")
        resp = client.post(
            "/ingest/upload",
            files=[("files", ("image.png", file, "image/png"))],
        )
        assert resp.status_code == 400
        assert "error" in resp.json()

    def test_upload_no_files(self):
        resp = client.post("/ingest/upload")
        assert resp.status_code == 422


class TestZipUpload:
    """Tests for zip file upload via /ingest/upload."""

    def test_zip_with_md_and_txt(self):
        zip_bytes = _make_zip({
            "notes.md": b"# Markdown file",
            "readme.txt": b"Plain text file",
        })
        resp = client.post(
            "/ingest/upload",
            files=[("files", ("archive.zip", zip_bytes, "application/zip"))],
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["imported"] == 2
        titles = {r["title"] for r in data["results"]}
        assert titles == {"notes", "readme"}

    def test_zip_skips_macosx_and_hidden_files(self):
        zip_bytes = _make_zip({
            "__MACOSX/._notes.md": b"mac metadata",
            ".hidden.md": b"hidden file",
            "visible.md": b"# Visible",
        })
        resp = client.post(
            "/ingest/upload",
            files=[("files", ("archive.zip", zip_bytes, "application/zip"))],
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["imported"] == 1
        assert data["results"][0]["title"] == "visible"

    def test_zip_empty_returns_zero(self):
        zip_bytes = _make_zip({})
        resp = client.post(
            "/ingest/upload",
            files=[("files", ("empty.zip", zip_bytes, "application/zip"))],
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["imported"] == 0
        assert data["results"] == []

    def test_zip_skips_unsupported_files_silently(self):
        zip_bytes = _make_zip({
            "image.png": b"\x89PNG",
            "data.csv": b"a,b,c",
            "notes.md": b"# Notes",
        })
        resp = client.post(
            "/ingest/upload",
            files=[("files", ("mixed.zip", zip_bytes, "application/zip"))],
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["imported"] == 1
        assert data["results"][0]["title"] == "notes"


class TestDuplicateDetection:
    """Tests for idempotent upload behavior — same file title overwrites on disk."""

    def test_upload_same_title_twice_overwrites(self):
        """Uploading the same filename twice overwrites the .md on disk (idempotent)."""
        file1 = io.BytesIO(b"# Version 1")
        resp1 = client.post(
            "/ingest/upload",
            files=[("files", ("notes.md", file1, "text/markdown"))],
        )
        assert resp1.status_code == 200

        file2 = io.BytesIO(b"# Version 2")
        resp2 = client.post(
            "/ingest/upload",
            files=[("files", ("notes.md", file2, "text/markdown"))],
        )
        assert resp2.status_code == 200
        data = resp2.json()
        assert data["imported"] == 1
        # Same doc_id since same filename → same file path → same SHA-256
        assert resp1.json()["results"][0]["doc_id"] == data["results"][0]["doc_id"]

    def test_upload_new_file_succeeds(self):
        """Uploading a new file saves to disk and returns doc_id."""
        file = io.BytesIO(b"# New content")
        resp = client.post(
            "/ingest/upload",
            files=[("files", ("new_doc.md", file, "text/markdown"))],
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["imported"] == 1
        assert "doc_id" in data["results"][0]


class TestPdfAssetPreservation:
    """Tests for PDF upload preserving the original asset and creating .md stub."""

    @patch("backend.api.pdf_to_text", return_value="Extracted text from the paper")
    def test_pdf_upload_saves_original_to_assets_dir(self, _mock_pdf, tmp_path, monkeypatch):
        assets_dir = str(tmp_path / "assets")
        monkeypatch.setattr("backend.api.get_assets_dir", lambda: assets_dir)

        file = io.BytesIO(b"%PDF-fake-content")
        resp = client.post(
            "/ingest/upload",
            files=[("files", ("paper.pdf", file, "application/pdf"))],
        )

        assert resp.status_code == 200
        assert os.path.exists(os.path.join(assets_dir, "paper.pdf"))

    @patch("backend.api.pdf_to_text", return_value="Extracted text from the paper")
    def test_pdf_upload_creates_md_with_source_footer(self, _mock_pdf, tmp_path, monkeypatch):
        notes_dir = str(tmp_path / "notes2")
        assets_dir = str(tmp_path / "assets2")
        monkeypatch.setattr("backend.api.get_notes_dir", lambda: notes_dir)
        monkeypatch.setattr("backend.api.get_assets_dir", lambda: assets_dir)

        file = io.BytesIO(b"%PDF-fake-content")
        resp = client.post(
            "/ingest/upload",
            files=[("files", ("paper.pdf", file, "application/pdf"))],
        )

        assert resp.status_code == 200
        md_path = os.path.join(notes_dir, "paper.md")
        assert os.path.exists(md_path)
        with open(md_path, encoding="utf-8") as f:
            content = f.read()
        assert "Extracted text from the paper" in content
        assert "Source: [[assets/paper.pdf]]" in content

    @patch("backend.api.pdf_to_text", return_value="PDF text")
    def test_pdf_upload_registers_in_manifest(self, _mock_pdf, tmp_path, monkeypatch):
        notes_dir = str(tmp_path / "notes3")
        monkeypatch.setattr("backend.api.get_notes_dir", lambda: notes_dir)
        monkeypatch.setattr("backend.api.get_assets_dir", lambda: str(tmp_path / "assets3"))

        file = io.BytesIO(b"%PDF-fake-content")
        resp = client.post(
            "/ingest/upload",
            files=[("files", ("report.pdf", file, "application/pdf"))],
        )

        assert resp.status_code == 200
        doc_id = resp.json()["results"][0]["doc_id"]

        from backend.db.manifest import Manifest
        manifest = Manifest(notes_dir)
        row = manifest.get(doc_id)
        manifest.close()

        assert row is not None
        assert row["is_managed"] is True
