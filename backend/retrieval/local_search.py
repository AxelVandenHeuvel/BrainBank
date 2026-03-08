from collections import deque

import kuzu

from backend.retrieval.types import (
    ChunkHit,
    DiscoveredConcept,
    LocalSearchResult,
    RetrievalConfig,
)


def normalize_concepts(value) -> list[str]:
    if value is None:
        return []
    return [str(item) for item in list(value)]


def build_chunk_seed_set(table, query_vector: list[float], limit: int) -> tuple[list[ChunkHit], list[str]]:
    results = table.search(query_vector).limit(limit).to_pandas()
    if results.empty:
        return [], []

    seed_chunks = []
    source_concepts = []
    seen_concepts = set()

    for rank, row in enumerate(results.itertuples(index=False)):
        concepts = tuple(normalize_concepts(row.concepts))
        seed_chunks.append(
            ChunkHit(
                chunk_id=row.chunk_id,
                doc_id=row.doc_id,
                doc_name=row.doc_name,
                text=row.text,
                concepts=concepts,
                rank=rank,
            )
        )
        for concept in concepts:
            if concept not in seen_concepts:
                seen_concepts.add(concept)
                source_concepts.append(concept)

    return seed_chunks, source_concepts


def expand_related_concepts(
    conn: kuzu.Connection,
    source_concepts: list[str],
    max_hops: int,
    max_discovery_concepts: int,
) -> list[DiscoveredConcept]:
    if max_hops < 1 or not source_concepts:
        return []

    deduped_sources = list(dict.fromkeys(source_concepts))
    source_set = set(deduped_sources)
    visited = {(source, source) for source in deduped_sources}
    frontier = deque((source, source, 0) for source in deduped_sources)
    discovered: dict[str, dict[str, object]] = {}

    while frontier:
        current_concept, origin_source, depth = frontier.popleft()
        if depth >= max_hops:
            continue

        result = conn.execute(
            "MATCH (c:Concept {name: $name})-[:RELATED_TO]-(neighbor:Concept) "
            "RETURN neighbor.name",
            parameters={"name": current_concept},
        )

        neighbors = []
        while result.has_next():
            neighbors.append(result.get_next()[0])

        next_depth = depth + 1
        for neighbor in neighbors:
            visit_key = (origin_source, neighbor)
            if visit_key in visited:
                continue
            visited.add(visit_key)

            if neighbor not in source_set:
                entry = discovered.setdefault(
                    neighbor,
                    {"min_hop": next_depth, "supporting_sources": set()},
                )
                entry["min_hop"] = min(entry["min_hop"], next_depth)
                entry["supporting_sources"].add(origin_source)

            if next_depth < max_hops:
                frontier.append((neighbor, origin_source, next_depth))

    ranked = [
        DiscoveredConcept(
            name=name,
            min_hop=entry["min_hop"],
            supporting_seed_concepts=tuple(sorted(entry["supporting_sources"])),
        )
        for name, entry in discovered.items()
    ]
    ranked.sort(
        key=lambda concept: (
            concept.min_hop,
            -len(concept.supporting_seed_concepts),
            concept.name,
        )
    )
    return ranked[:max_discovery_concepts]


def select_discovery_chunks(
    df,
    discovery_concepts: list[DiscoveredConcept],
    excluded_chunk_ids: set[str],
    max_chunks: int,
) -> list[ChunkHit]:
    if df.empty or not discovery_concepts or max_chunks < 1:
        return []

    concept_rank = {
        concept.name: index for index, concept in enumerate(discovery_concepts)
    }
    candidates = []

    for original_index, row in enumerate(df.itertuples(index=False)):
        if row.chunk_id in excluded_chunk_ids:
            continue

        concepts = normalize_concepts(row.concepts)
        matching_concepts = [concept for concept in concepts if concept in concept_rank]
        if not matching_concepts:
            continue

        best_rank = min(concept_rank[concept] for concept in matching_concepts)
        match_count = len(set(matching_concepts))
        candidates.append((best_rank, -match_count, original_index, row))

    candidates.sort(key=lambda candidate: candidate[:3])

    selected = []
    for rank, (_, _, _, row) in enumerate(candidates[:max_chunks]):
        selected.append(
            ChunkHit(
                chunk_id=row.chunk_id,
                doc_id=row.doc_id,
                doc_name=row.doc_name,
                text=row.text,
                concepts=tuple(normalize_concepts(row.concepts)),
                rank=rank,
            )
        )

    return selected


def run_local_search(
    table,
    conn: kuzu.Connection,
    query_vector: list[float],
    config: RetrievalConfig,
) -> LocalSearchResult:
    df = table.to_pandas()
    if df.empty:
        return LocalSearchResult((), (), (), ())

    seed_chunks, source_concepts = build_chunk_seed_set(
        table,
        query_vector,
        config.seed_chunk_limit,
    )
    if not seed_chunks:
        return LocalSearchResult((), (), (), ())

    discovery_concepts = expand_related_concepts(
        conn,
        source_concepts,
        max_hops=config.max_graph_hops,
        max_discovery_concepts=config.max_discovery_concepts,
    )
    discovery_chunks = select_discovery_chunks(
        df,
        discovery_concepts,
        excluded_chunk_ids={chunk.chunk_id for chunk in seed_chunks},
        max_chunks=config.max_discovery_chunks,
    )

    return LocalSearchResult(
        seed_chunks=tuple(seed_chunks),
        source_concepts=tuple(source_concepts),
        discovery_concepts=tuple(discovery_concepts),
        discovery_chunks=tuple(discovery_chunks),
    )
