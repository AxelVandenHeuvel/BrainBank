"""Extract text from PDF files using PyMuPDF."""

import pymupdf


def pdf_to_text(data: bytes) -> str:
    """Extract all text from a PDF byte string."""
    doc = pymupdf.open(stream=data, filetype="pdf")
    pages = [page.get_text() for page in doc]
    doc.close()
    return "\n".join(pages)
