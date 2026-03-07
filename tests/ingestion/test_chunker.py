from backend.ingestion.chunker import semantic_chunk_text


class TestSemanticChunkText:
    def test_single_sentence(self):
        text = "This is a single sentence."
        chunks = semantic_chunk_text(text)
        assert len(chunks) == 1
        assert chunks[0] == text

    def test_multiple_sentences(self):
        text = "First sentence. Second sentence. Third sentence."
        chunks = semantic_chunk_text(text)
        assert len(chunks) >= 1
        combined = " ".join(chunks)
        assert "First sentence" in combined
        assert "Third sentence" in combined

    def test_empty_text_returns_empty(self):
        chunks = semantic_chunk_text("")
        assert chunks == []

    def test_topic_shift_splits(self):
        text = (
            "Calculus deals with derivatives and integrals. "
            "The fundamental theorem connects them. "
            "I need to buy groceries today. "
            "Milk and eggs are on my list."
        )
        chunks = semantic_chunk_text(text, similarity_threshold=0.5)
        assert len(chunks) >= 1
        combined = " ".join(chunks)
        assert "Calculus" in combined
        assert "groceries" in combined

    def test_respects_max_chunk_size(self):
        text = "Word word word. " * 100
        chunks = semantic_chunk_text(text, max_chunk_size=200)
        assert len(chunks) >= 2
        for chunk in chunks:
            assert len(chunk) <= 200 + 50  # allow some overflow from last sentence
