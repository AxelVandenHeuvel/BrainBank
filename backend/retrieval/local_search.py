from collections import deque

import kuzu

from backend.retrieval.latent_discovery import find_latent_document_hits
from backend.retrieval.routing import normalize_query_text
from backend.retrieval.types import (
    ChunkHit,
    LatentDocumentHit,
    LocalSearchResult,
    RetrievalConfig,
    SourceConceptHit,
    WeightedDiscoveryConcept,
)


def normalize_concepts(value) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    return [str(item) for item in list(value)]


def _vector_from_row(row) -> tuple[float, ...] | None:
    vector = getattr(row, "vector", None)
    if vector is None:
        return None
    return tuple(float(value) for value in vector)


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    mag_a = sum(x * x for x in a) ** 0.5
    mag_b = sum(x * x for x in b) ** 0.5
    if mag_a < 1e-9 or mag_b < 1e-9:
        return 0.0
    return dot / (mag_a * mag_b)


def build_chunk_seed_set(table, query_vector: list[float], limit: int) -> list[ChunkHit]:
    results = table.search(query_vector).limit(limit).to_pandas()
    if results.empty:
        return []

    seed_chunks = []
    for rank, row in enumerate(results.itertuples(index=False)):
        seed_chunks.append(
            ChunkHit(
                chunk_id=str(row.chunk_id),
                doc_id=str(row.doc_id),
                doc_name=str(row.doc_name),
                text=str(row.text),
                concepts=tuple(normalize_concepts(row.concepts)),
                rank=rank,
                score=None,
                vector=_vector_from_row(row),
            )
        )

    return seed_chunks


def score_source_concepts_from_seed_chunks(
    seed_chunks: list[ChunkHit] | tuple[ChunkHit, ...],
    user_query: str,
    limit: int,
) -> list[SourceConceptHit]:
    if not seed_chunks or limit < 1:
        return []

    normalized_query = normalize_query_text(user_query)
    scores: dict[str, float] = {}
    matched_chunk_ids: dict[str, list[str]] = {}

    for chunk in seed_chunks:
        rank_contribution = 1.0 / float(chunk.rank + 1)
        for concept in chunk.concepts:
            scores[concept] = scores.get(concept, 0.0) + rank_contribution
            matched_chunk_ids.setdefault(concept, []).append(chunk.chunk_id)

    for concept in list(scores):
        if concept.lower() in normalized_query:
            scores[concept] += 2.0

    hits = [
        SourceConceptHit(
            name=concept,
            score=score,
            matched_chunk_ids=tuple(matched_chunk_ids.get(concept, [])),
        )
        for concept, score in scores.items()
    ]
    hits.sort(key=lambda hit: (-hit.score, hit.name))
    return hits[:limit]


def expand_weighted_related_concepts(
    conn: kuzu.Connection,
    source_concepts: list[SourceConceptHit] | tuple[SourceConceptHit, ...],
    max_hops: int,
    max_discovery_concepts: int,
) -> list[WeightedDiscoveryConcept]:
    if max_hops < 1 or not source_concepts:
        return []

    deduped_sources = []
    seen_sources = set()
    for hit in source_concepts:
        if hit.name not in seen_sources:
            deduped_sources.append(hit)
            seen_sources.add(hit.name)

    source_map = {hit.name: hit for hit in deduped_sources}
    source_names = set(source_map)
    frontier = deque((hit.name, hit.name, 0) for hit in deduped_sources)
    visited: dict[tuple[str, str], int] = {(hit.name, hit.name): 0 for hit in deduped_sources}
    discovered: dict[str, dict[str, object]] = {}

    while frontier:
        current_name, origin_name, depth = frontier.popleft()
        if depth >= max_hops:
            continue

        result = conn.execute(
            "MATCH (c:Concept {name: $name})-[r:RELATED_TO]-(neighbor:Concept) "
            "RETURN neighbor.name, COALESCE(r.weight, 1.0)",
            parameters={"name": current_name},
        )

        next_depth = depth + 1
        while result.has_next():
            neighbor_name, weight = result.get_next()
            neighbor_name = str(neighbor_name)
            edge_weight = float(weight) if weight is not None else 1.0

            if neighbor_name in source_names:
                continue

            source_hit = source_map[origin_name]
            contribution = source_hit.score * edge_weight / float(next_depth)

            entry = discovered.setdefault(
                neighbor_name,
                {
                    "score": 0.0,
                    "min_hop": next_depth,
                    "supporting_seed_concepts": set(),
                },
            )
            entry["score"] += contribution
            entry["min_hop"] = min(entry["min_hop"], next_depth)
            entry["supporting_seed_concepts"].add(origin_name)

            visit_key = (origin_name, neighbor_name)
            previous_depth = visited.get(visit_key)
            if next_depth < max_hops and (previous_depth is None or next_depth < previous_depth):
                visited[visit_key] = next_depth
                frontier.append((neighbor_name, origin_name, next_depth))

    hits = [
        WeightedDiscoveryConcept(
            name=name,
            score=float(entry["score"]),
            min_hop=int(entry["min_hop"]),
            supporting_seed_concepts=tuple(sorted(entry["supporting_seed_concepts"])),
        )
        for name, entry in discovered.items()
    ]
    hits.sort(key=lambda hit: (-hit.score, hit.min_hop, hit.name))
    return hits[:max_discovery_concepts]


def select_top_chunks_for_documents(
    chunks_df,
    query_vector: list[float],
    latent_documents: list[LatentDocumentHit] | tuple[LatentDocumentHit, ...],
    per_document_limit: int,
) -> list[ChunkHit]:
    if chunks_df.empty or not latent_documents or per_document_limit < 1:
        return []

    selected = []
    for doc_rank, document in enumerate(latent_documents):
        doc_rows = chunks_df[chunks_df["doc_id"] == document.doc_id]
        if doc_rows.empty:
            continue

        scored_rows = []
        for row in doc_rows.itertuples(index=False):
            vector = [float(value) for value in row.vector]
            scored_rows.append(
                (
                    -_cosine_similarity(query_vector, vector),
                    str(row.chunk_id),
                    row,
                )
            )
        scored_rows.sort(key=lambda item: item[:2])

        for chunk_rank, (_, _, row) in enumerate(scored_rows[:per_document_limit]):
            selected.append(
                ChunkHit(
                    chunk_id=str(row.chunk_id),
                    doc_id=str(row.doc_id),
                    doc_name=str(row.doc_name),
                    text=str(row.text),
                    concepts=tuple(normalize_concepts(row.concepts)),
                    rank=len(selected),
                    score=getattr(document, "score", None),
                    vector=tuple(float(value) for value in row.vector),
                )
            )

    return selected


def run_local_search(
    db,
    table,
    conn: kuzu.Connection,
    user_query: str,
    query_vector: list[float],
    config: RetrievalConfig,
) -> LocalSearchResult:
    chunks_df = table.to_pandas()
    if chunks_df.empty:
        return LocalSearchResult((), (), (), (), ())

    seed_chunks = build_chunk_seed_set(
        table,
        query_vector,
        config.seed_chunk_limit,
    )
    if not seed_chunks:
        return LocalSearchResult((), (), (), (), ())

    try:
        concept_centroids_table = db.open_table("concept_centroids")
        concept_centroid_df = concept_centroids_table.to_pandas()
    except Exception:
        concept_centroids_table = None
        concept_centroid_df = None

    if concept_centroids_table is not None and concept_centroid_df is not None and not concept_centroid_df.empty:
        concept_search = concept_centroids_table.search(query_vector).limit(config.concept_seed_limit).to_pandas()
        source_concepts = []
        normalized_query = normalize_query_text(user_query)
        for row in concept_search.itertuples(index=False):
            concept_name = str(row.concept_name)
            matched = chunks_df[chunks_df["concepts"].apply(lambda concepts: concept_name in normalize_concepts(concepts))]
            score = 1.0 / (1.0 + float(getattr(row, "_distance", 0.0)))
            if concept_name.lower() in normalized_query:
                score += 2.0
            source_concepts.append(
                SourceConceptHit(
                    name=concept_name,
                    score=score,
                    matched_chunk_ids=tuple(matched["chunk_id"].astype(str).tolist()),
                )
            )
        source_concepts.sort(key=lambda hit: (-hit.score, hit.name))
        source_concepts = source_concepts[: config.source_concept_limit]
    else:
        source_concepts = score_source_concepts_from_seed_chunks(
            seed_chunks,
            user_query,
            config.source_concept_limit,
        )

    discovery_concepts = expand_weighted_related_concepts(
        conn,
        source_concepts,
        max_hops=config.max_graph_hops,
        max_discovery_concepts=config.max_discovery_concepts,
    )

    ranked_concepts = [
        (hit.name, 1.0 / float(index + 1))
        for index, hit in enumerate([*source_concepts, *discovery_concepts])
    ]
    excluded_doc_ids = {chunk.doc_id for chunk in seed_chunks}
    latent_documents = find_latent_document_hits(
        db,
        chunks_df,
        ranked_concepts=ranked_concepts,
        excluded_doc_ids=excluded_doc_ids,
        limit=config.latent_doc_limit,
        concept_centroids_table=concept_centroids_table,
    )
    discovery_chunks = select_top_chunks_for_documents(
        chunks_df,
        query_vector=query_vector,
        latent_documents=latent_documents,
        per_document_limit=config.latent_doc_chunk_limit,
    )

    return LocalSearchResult(
        seed_chunks=tuple(seed_chunks),
        source_concepts=tuple(source_concepts),
        discovery_concepts=tuple(discovery_concepts),
        latent_documents=tuple(latent_documents),
        discovery_chunks=tuple(discovery_chunks),
    )
