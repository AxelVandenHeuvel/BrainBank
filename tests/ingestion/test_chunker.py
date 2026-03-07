from backend.ingestion.chunker import chunk_text


class TestChunkText:
    def test_single_paragraph(self):
        text = "This is a single paragraph."
        chunks = chunk_text(text)
        assert len(chunks) == 1
        assert chunks[0] == text

    def test_multiple_paragraphs(self):
        text = "First paragraph.\n\nSecond paragraph.\n\nThird paragraph."
        chunks = chunk_text(text)
        assert len(chunks) >= 1
        combined = " ".join(chunks)
        assert "First paragraph" in combined
        assert "Third paragraph" in combined

    def test_empty_text_returns_original(self):
        chunks = chunk_text("")
        assert len(chunks) == 1

    def test_respects_chunk_size(self):
        text = "Word " * 200 + "\n\n" + "Word " * 200
        chunks = chunk_text(text, chunk_size=500)
        assert len(chunks) >= 2
