import kuzu as _kuzu

from backend.db.kuzu import get_open_database_for_path, init_kuzu
from backend.db.lance import init_lancedb
from backend.retrieval.context import build_local_context
from backend.retrieval.global_search import run_global_search
from backend.retrieval.local_search import run_local_search
from backend.retrieval.routing import QueryRoute, classify_query_route
from backend.retrieval.types import QueryResult, RetrievalConfig
from backend.services.embeddings import embed_query
from backend.services.llm import (
    generate_answer,
    generate_partial_answer,
    synthesize_answers,
)

EMPTY_BRAINBANK_MESSAGE = (
    "No ingested documents found. Upload or import notes before querying BrainBank."
)


def _get_query_connection(shared_kuzu_db, kuzu_db_path: str):
    if shared_kuzu_db is not None:
        return shared_kuzu_db, _kuzu.Connection(shared_kuzu_db), False

    try:
        kuzu_db, conn = init_kuzu(kuzu_db_path)
        return kuzu_db, conn, True
    except RuntimeError as error:
        if "Could not set lock on file" not in str(error):
            raise

        existing_db = get_open_database_for_path(kuzu_db_path)
        if existing_db is None:
            raise
        return existing_db, _kuzu.Connection(existing_db), False


def query_brainbank(
    user_query: str,
    lance_db_path: str = "./data/lancedb",
    kuzu_db_path: str = "./data/kuzu",
    shared_kuzu_db=None,
    config: RetrievalConfig | None = None,
    history: list[dict] | None = None,
) -> dict:
    if config is None:
        config = RetrievalConfig()

    db, table = init_lancedb(lance_db_path)
    kuzu_db, conn, own_db = _get_query_connection(shared_kuzu_db, kuzu_db_path)
    query_vector = embed_query(user_query)

    try:
        route = classify_query_route(user_query)
        if route == QueryRoute.GLOBAL:
            global_result = run_global_search(
                db,
                user_query,
                query_vector,
                config,
                partial_answer_fn=generate_partial_answer,
                synthesize_fn=synthesize_answers,
            )
            if global_result is not None:
                return QueryResult(
                    answer=global_result.answer,
                    source_concepts=global_result.source_concepts,
                    discovery_concepts=global_result.discovery_concepts,
                ).to_response()

        search_result = run_local_search(
            db,
            table,
            conn,
            user_query,
            query_vector,
            config,
        )
        if not search_result.seed_chunks:
            if table.to_pandas().empty:
                answer = EMPTY_BRAINBANK_MESSAGE
            else:
                answer = "No relevant information found."
            return QueryResult(
                answer=answer,
                source_concepts=(),
                discovery_concepts=(),
            ).to_response()

        source_concepts = tuple(hit.name for hit in search_result.source_concepts)
        discovery_concepts = tuple(hit.name for hit in search_result.discovery_concepts)
        context = build_local_context(search_result, config.max_context_words)
        answer = generate_answer(
            user_query,
            context,
            list(source_concepts) + list(discovery_concepts),
            history=history or None,
        )

        return QueryResult(
            answer=answer,
            source_concepts=source_concepts,
            discovery_concepts=discovery_concepts,
        ).to_response()
    finally:
        conn.close()
        if own_db:
            kuzu_db.close()
