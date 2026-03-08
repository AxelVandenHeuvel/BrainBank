"""Tests for the POST /ingest/upload endpoint, including zip and duplicate detection."""

import io
import zipfile
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from backend.api import app
from backend.db.kuzu import init_kuzu as real_init_kuzu
from backend.db.lance import init_lancedb as real_init_lancedb
from tests.conftest import mock_embed_texts, mock_extract_concepts

client = TestClient(app)


@pytest.fixture(autouse=True)
def isolate_upload_data(monkeypatch, lance_path, kuzu_path):
    real_kuzu_db, _ = real_init_kuzu(kuzu_path)

    # Route the global Kuzu engine to the isolated test DB
    monkeypatch.setattr("backend.db.kuzu._db_instance", real_kuzu_db)

    monkeypatch.setattr(
        "backend.ingestion.processor.init_lancedb",
        lambda path="./data/lancedb": real_init_lancedb(lance_path),
    )
    monkeypatch.setattr(
        "backend.ingestion.processor.init_kuzu",
        lambda path="./data/kuzu": real_init_kuzu(kuzu_path),
    )
    monkeypatch.setattr(
        "backend.api.find_existing_document",
        lambda title: None,
    )


def _make_zip(files: dict[str, bytes]) -> bytes:
    """Create an in-memory zip file from a dict of {filename: content}."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, data in files.items():
            zf.writestr(name, data)
    return buf.getvalue()


class TestUploadEndpoint:
    """Tests for single-file upload via /ingest/upload."""

    @patch("backend.ingestion.processor.calculate_color_score", return_value=0.5)
    @patch("backend.ingestion.processor.embed_texts", side_effect=mock_embed_texts)
    @patch("backend.ingestion.processor.extract_concepts", side_effect=mock_extract_concepts)
    def test_upload_single_txt(self, mock_llm, mock_emb, mock_color):
        file = io.BytesIO(b"Some plain text notes about math")
        resp = client.post(
            "/ingest/upload",
            files=[("files", ("notes.txt", file, "text/plain"))],
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["imported"] == 1
        assert data["results"][0]["title"] == "notes"

    @patch("backend.ingestion.processor.calculate_color_score", return_value=0.5)
    @patch("backend.ingestion.processor.embed_texts", side_effect=mock_embed_texts)
    @patch("backend.ingestion.processor.extract_concepts", side_effect=mock_extract_concepts)
    def test_upload_single_md(self, mock_llm, mock_emb, mock_color):
        file = io.BytesIO(b"# Physics\nForce = mass * acceleration")
        resp = client.post(
            "/ingest/upload",
            files=[("files", ("physics.md", file, "text/markdown"))],
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["imported"] == 1
        assert data["results"][0]["title"] == "physics"

    @patch("backend.ingestion.processor.calculate_color_score", return_value=0.5)
    @patch("backend.ingestion.processor.embed_texts", side_effect=mock_embed_texts)
    @patch("backend.ingestion.processor.extract_concepts", side_effect=mock_extract_concepts)
    @patch("backend.api.pdf_to_text", return_value="Extracted PDF text about biology")
    def test_upload_single_pdf(self, mock_pdf, mock_llm, mock_emb, mock_color):
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

    @patch("backend.ingestion.processor.calculate_color_score", return_value=0.5)
    @patch("backend.ingestion.processor.embed_texts", side_effect=mock_embed_texts)
    @patch("backend.ingestion.processor.extract_concepts", side_effect=mock_extract_concepts)
    @patch("backend.api.pdf_to_text", return_value="PDF content")
    def test_upload_multiple_files(self, mock_pdf, mock_llm, mock_emb, mock_color):
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

    @patch("backend.ingestion.processor.calculate_color_score", return_value=0.5)
    @patch("backend.ingestion.processor.embed_texts", side_effect=mock_embed_texts)
    @patch("backend.ingestion.processor.extract_concepts", side_effect=mock_extract_concepts)
    def test_zip_with_md_and_txt(self, mock_llm, mock_emb, mock_color):
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

    @patch("backend.ingestion.processor.calculate_color_score", return_value=0.5)
    @patch("backend.ingestion.processor.embed_texts", side_effect=mock_embed_texts)
    @patch("backend.ingestion.processor.extract_concepts", side_effect=mock_extract_concepts)
    def test_zip_skips_macosx_and_hidden_files(self, mock_llm, mock_emb, mock_color):
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

    @patch("backend.ingestion.processor.calculate_color_score", return_value=0.5)
    @patch("backend.ingestion.processor.embed_texts", side_effect=mock_embed_texts)
    @patch("backend.ingestion.processor.extract_concepts", side_effect=mock_extract_concepts)
    def test_zip_skips_unsupported_files_silently(self, mock_llm, mock_emb, mock_color):
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


class TestDuplicateReplacement:
    """Tests for duplicate document replacement in /ingest/upload."""

    @patch("backend.ingestion.processor.calculate_color_score", return_value=0.5)
    @patch("backend.ingestion.processor.embed_texts", side_effect=mock_embed_texts)
    @patch("backend.ingestion.processor.extract_concepts", side_effect=mock_extract_concepts)
    def test_upload_replaces_duplicate(self, mock_llm, mock_emb, mock_color, monkeypatch):
        """When a document with the same title exists, old chunks are deleted and it re-ingests."""
        delete_called = []
        monkeypatch.setattr(
            "backend.api.find_existing_document",
            lambda title: {"doc_id": "existing-123", "doc_name": title},
        )
        monkeypatch.setattr(
            "backend.api.delete_document_chunks",
            lambda title: delete_called.append(title),
        )

        file = io.BytesIO(b"# Updated content")
        resp = client.post(
            "/ingest/upload",
            files=[("files", ("notes.md", file, "text/markdown"))],
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["imported"] == 1
        assert delete_called == ["notes"]

    @patch("backend.ingestion.processor.calculate_color_score", return_value=0.5)
    @patch("backend.ingestion.processor.embed_texts", side_effect=mock_embed_texts)
    @patch("backend.ingestion.processor.extract_concepts", side_effect=mock_extract_concepts)
    def test_upload_proceeds_when_no_duplicate(self, mock_llm, mock_emb, mock_color):
        """When find_existing_document returns None, the file should be ingested normally."""
        file = io.BytesIO(b"# New content")
        resp = client.post(
            "/ingest/upload",
            files=[("files", ("new_doc.md", file, "text/markdown"))],
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["imported"] == 1
