import kuzu as _kuzu

from backend.db.kuzu import init_kuzu
from backend.db.lance import init_lancedb
from backend.retrieval.context import build_context_text
from backend.retrieval.local_search import run_local_search
from backend.retrieval.types import QueryResult, RetrievalConfig
from backend.services.embeddings import embed_query
from backend.services.llm import generate_answer


def _get_query_connection(shared_kuzu_db, kuzu_db_path: str):
    if shared_kuzu_db is not None:
        return shared_kuzu_db, _kuzu.Connection(shared_kuzu_db), False
    kuzu_db, conn = init_kuzu(kuzu_db_path)
    return kuzu_db, conn, True


def query_brainbank(
    user_query: str,
    lance_db_path: str = "./data/lancedb",
    kuzu_db_path: str = "./data/kuzu",
    shared_kuzu_db=None,
    config: RetrievalConfig | None = None,
) -> dict:
    if config is None:
        config = RetrievalConfig()

    _, table = init_lancedb(lance_db_path)
    kuzu_db, conn, own_db = _get_query_connection(shared_kuzu_db, kuzu_db_path)
    query_vector = embed_query(user_query)

    try:
        search_result = run_local_search(table, conn, query_vector, config)
        if not search_result.seed_chunks:
            return QueryResult(
                answer="No relevant information found.",
                source_concepts=(),
                discovery_concepts=(),
            ).to_response()

        source_concepts = tuple(sorted(search_result.source_concepts))
        discovery_concept_names = tuple(
            sorted(concept.name for concept in search_result.discovery_concepts)
        )
        all_concepts = list(source_concepts) + list(discovery_concept_names)
        context = build_context_text(
            search_result.seed_chunks,
            search_result.discovery_chunks,
            config.max_context_words,
        )
        answer = generate_answer(user_query, context, all_concepts)

        return QueryResult(
            answer=answer,
            source_concepts=source_concepts,
            discovery_concepts=discovery_concept_names,
        ).to_response()
    finally:
        conn.close()
        if own_db:
            kuzu_db.close()
