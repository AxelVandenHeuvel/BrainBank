import io

import pymupdf
import pytest

from backend.services.pdf import pdf_to_text


def _make_pdf(text: str) -> bytes:
    """Create a minimal PDF with the given text."""
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((72, 72), text)
    data = doc.tobytes()
    doc.close()
    return data


def test_extracts_text_from_pdf():
    pdf_bytes = _make_pdf("Hello world from a PDF")
    result = pdf_to_text(pdf_bytes)
    assert "Hello world from a PDF" in result


def test_multipage_pdf():
    doc = pymupdf.open()
    for i in range(3):
        page = doc.new_page()
        page.insert_text((72, 72), f"Page {i + 1} content")
    data = doc.tobytes()
    doc.close()

    result = pdf_to_text(data)
    assert "Page 1 content" in result
    assert "Page 2 content" in result
    assert "Page 3 content" in result


def test_empty_pdf():
    doc = pymupdf.open()
    doc.new_page()
    data = doc.tobytes()
    doc.close()

    result = pdf_to_text(data)
    assert result.strip() == ""


def test_invalid_pdf_raises():
    with pytest.raises(Exception):
        pdf_to_text(b"not a pdf at all")
