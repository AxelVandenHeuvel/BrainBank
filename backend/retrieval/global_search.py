from backend.retrieval.latent_discovery import similarity_from_distance
from backend.retrieval.local_search import normalize_concepts
from backend.retrieval.types import (
    GlobalCommunityHit,
    GlobalSearchResult,
    RetrievalConfig,
)
from backend.services.llm import generate_partial_answer, synthesize_answers


def run_global_search(
    db,
    user_query: str,
    query_vector: list[float],
    config: RetrievalConfig,
    partial_answer_fn=None,
    synthesize_fn=None,
) -> GlobalSearchResult | None:
    if partial_answer_fn is None:
        partial_answer_fn = generate_partial_answer
    if synthesize_fn is None:
        synthesize_fn = synthesize_answers

    try:
        table = db.open_table("community_summaries")
    except Exception:
        return None

    summary_df = table.to_pandas()
    if summary_df.empty:
        return None

    search_result = table.search(query_vector).limit(config.community_seed_limit).to_pandas()
    if search_result.empty:
        return None

    community_hits = []
    for row in search_result.itertuples(index=False):
        community_hits.append(
            GlobalCommunityHit(
                community_id=str(row.community_id),
                score=similarity_from_distance(getattr(row, "_distance", 0.0)),
                member_concepts=tuple(normalize_concepts(row.member_concepts)),
                summary=str(row.summary),
            )
        )

    partial_answers = [
        partial_answer_fn(user_query, hit.summary, list(hit.member_concepts))
        for hit in community_hits
    ]
    if not partial_answers:
        return None

    if len(partial_answers) == 1:
        answer = partial_answers[0]
    else:
        answer = synthesize_fn(user_query, partial_answers)

    source_concepts = []
    seen = set()
    for hit in community_hits:
        for concept in hit.member_concepts:
            if concept in seen:
                continue
            seen.add(concept)
            source_concepts.append(concept)
            if len(source_concepts) == config.global_source_concept_limit:
                break
        if len(source_concepts) == config.global_source_concept_limit:
            break

    return GlobalSearchResult(
        answer=answer,
        community_hits=tuple(community_hits),
        source_concepts=tuple(source_concepts),
    )
