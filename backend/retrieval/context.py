from dataclasses import replace

from backend.retrieval.types import ChunkHit


def _normalize_text(text: str) -> str:
    return " ".join(text.split())


def assemble_context_chunks(
    seed_chunks: list[ChunkHit] | tuple[ChunkHit, ...],
    discovery_chunks: list[ChunkHit] | tuple[ChunkHit, ...],
    max_words: int,
) -> list[ChunkHit]:
    if max_words < 1:
        return []

    selected = []
    seen_chunk_ids = set()
    seen_texts = set()
    used_words = 0

    for chunk in [*seed_chunks, *discovery_chunks]:
        normalized_text = _normalize_text(chunk.text)
        if not normalized_text:
            continue
        if chunk.chunk_id in seen_chunk_ids or normalized_text in seen_texts:
            continue

        seen_chunk_ids.add(chunk.chunk_id)
        seen_texts.add(normalized_text)

        words = normalized_text.split()
        if not selected and len(words) > max_words:
            selected.append(replace(chunk, text=" ".join(words[:max_words])))
            break

        if used_words + len(words) > max_words:
            continue

        selected.append(replace(chunk, text=normalized_text))
        used_words += len(words)

    return selected


def build_context_text(
    seed_chunks: list[ChunkHit] | tuple[ChunkHit, ...],
    discovery_chunks: list[ChunkHit] | tuple[ChunkHit, ...],
    max_words: int,
) -> str:
    selected = assemble_context_chunks(seed_chunks, discovery_chunks, max_words)
    return "\n\n---\n\n".join(chunk.text for chunk in selected)
