from dataclasses import replace

from backend.retrieval.types import (
    ChunkHit,
    LocalSearchResult,
)


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


def _append_line(lines: list[str], used_words: int, line: str, max_words: int) -> int:
    normalized = _normalize_text(line)
    if not normalized:
        return used_words

    words = normalized.split()
    if used_words == 0 and len(words) > max_words:
        lines.append(" ".join(words[:max_words]))
        return max_words

    if used_words + len(words) > max_words:
        return used_words

    lines.append(normalized)
    return used_words + len(words)


def build_local_context(search_result: LocalSearchResult, max_words: int) -> str:
    if max_words < 1:
        return ""

    lines: list[str] = []
    used_words = 0

    used_words = _append_line(lines, used_words, "Source concepts:", max_words)
    for hit in search_result.source_concepts:
        used_words = _append_line(
            lines,
            used_words,
            f"- {hit.name} (score={hit.score:.2f})",
            max_words,
        )

    if search_result.discovery_concepts:
        used_words = _append_line(lines, used_words, "Discovered concepts:", max_words)
        for hit in search_result.discovery_concepts:
            used_words = _append_line(
                lines,
                used_words,
                (
                    f"- {hit.name} (score={hit.score:.2f}, hop={hit.min_hop}, "
                    f"seeds={', '.join(hit.supporting_seed_concepts)})"
                ),
                max_words,
            )

    selected_seed = assemble_context_chunks(search_result.seed_chunks, (), max_words)
    selected_latent = assemble_context_chunks(search_result.discovery_chunks, (), max_words)

    if selected_seed:
        used_words = _append_line(lines, used_words, "Seed evidence:", max_words)
        for chunk in selected_seed:
            used_words = _append_line(lines, used_words, chunk.text, max_words)

    if selected_latent:
        used_words = _append_line(lines, used_words, "Latent document evidence:", max_words)
        for chunk in selected_latent:
            used_words = _append_line(lines, used_words, chunk.text, max_words)

    return "\n".join(lines)
