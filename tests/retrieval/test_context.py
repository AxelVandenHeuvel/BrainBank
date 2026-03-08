from backend.retrieval.context import assemble_context_chunks, build_context_text
from backend.retrieval.types import ChunkHit


def _chunk(
    chunk_id: str,
    text: str,
    *,
    rank: int,
    concepts: tuple[str, ...] = (),
) -> ChunkHit:
    return ChunkHit(
        chunk_id=chunk_id,
        doc_id=f"doc-{chunk_id}",
        doc_name=f"Doc {chunk_id}",
        text=text,
        concepts=concepts,
        rank=rank,
    )


class TestContextAssembly:
    def test_seed_chunks_stay_ahead_of_discovery_chunks(self):
        selected = assemble_context_chunks(
            [_chunk("seed-1", "seed text", rank=0)],
            [_chunk("discovery-1", "discovery text", rank=0)],
            max_words=10,
        )

        assert [chunk.chunk_id for chunk in selected] == ["seed-1", "discovery-1"]

    def test_deduplicates_by_chunk_id_then_normalized_text(self):
        selected = assemble_context_chunks(
            [
                _chunk("same-id", "seed text", rank=0),
                _chunk("same-id", "seed text changed", rank=1),
            ],
            [
                _chunk("other-id", "seed   text", rank=0),
                _chunk("new-id", "new text", rank=1),
            ],
            max_words=10,
        )

        assert [chunk.chunk_id for chunk in selected] == ["same-id", "new-id"]

    def test_truncates_the_first_chunk_when_it_exceeds_the_budget(self):
        selected = assemble_context_chunks(
            [_chunk("seed-1", "one two three four", rank=0)],
            [],
            max_words=2,
        )

        assert len(selected) == 1
        assert selected[0].text == "one two"

    def test_skips_later_chunks_that_would_exceed_the_budget(self):
        selected = assemble_context_chunks(
            [
                _chunk("seed-1", "one two", rank=0),
                _chunk("seed-2", "three four five", rank=1),
            ],
            [_chunk("discovery-1", "six", rank=0)],
            max_words=3,
        )

        assert [chunk.chunk_id for chunk in selected] == ["seed-1", "discovery-1"]

    def test_build_context_text_joins_selected_chunks_with_separator(self):
        context = build_context_text(
            [_chunk("seed-1", "alpha", rank=0)],
            [_chunk("discovery-1", "beta", rank=0)],
            max_words=10,
        )

        assert context == "alpha\n\n---\n\nbeta"
