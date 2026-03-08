import kuzu as _kuzu

from backend.db.kuzu import get_open_database_for_path, init_kuzu
from backend.db.lance import init_lancedb
from backend.retrieval.context import build_local_context
from backend.retrieval.global_search import run_global_search
from backend.retrieval.local_search import run_local_search
from backend.retrieval.provenance import build_local_answer_provenance
from backend.retrieval.traversal import build_traversal_plan
from backend.retrieval.routing import QueryRoute, classify_query_route
from backend.retrieval.types import (
    DocumentCitation,
    LocalQueryPreparation,
    QueryPreparation,
    QueryResult,
    RetrievalConfig,
)
from backend.services.embeddings import embed_query
from backend.services.llm import (
    generate_answer,
    generate_partial_answer,
    synthesize_answers,
)

EMPTY_BRAINBANK_MESSAGE = (
    "No ingested documents found. Upload or import notes before querying BrainBank."
)
GLOBAL_DOCUMENT_CITATION_LIMIT = 5


def _build_documents_for_concepts(table, concepts: tuple[str, ...], limit: int) -> tuple[DocumentCitation, ...]:
    if not concepts or limit < 1:
        return ()

    chunks_df = table.to_pandas()
    if chunks_df.empty:
        return ()

    ranked_concepts = {concept: index for index, concept in enumerate(concepts)}

    def normalize_chunk_concepts(chunk_concepts) -> list[str]:
        if chunk_concepts is None:
            return []
        if isinstance(chunk_concepts, str):
            return [chunk_concepts]
        return [str(concept) for concept in list(chunk_concepts)]

    concept_matches = chunks_df[chunks_df["concepts"].apply(
        lambda chunk_concepts: any(
            concept in normalize_chunk_concepts(chunk_concepts)
            for concept in concepts
        )
    )]
    if concept_matches.empty:
        return ()

    scored_documents: list[tuple[int, str, str]] = []
    for doc_id, group in concept_matches.groupby("doc_id", sort=False):
        best_rank = min(
            ranked_concepts[concept]
            for chunk_concepts in group["concepts"]
            for concept in normalize_chunk_concepts(chunk_concepts)
            if concept in ranked_concepts
        )
        scored_documents.append((best_rank, str(doc_id), str(group["doc_name"].iloc[0])))

    scored_documents.sort(key=lambda item: (item[0], item[2], item[1]))
    return tuple(
        DocumentCitation(doc_id=doc_id, name=doc_name)
        for _, doc_id, doc_name in scored_documents[:limit]
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


def _prepare_local_query(
    db,
    table,
    conn,
    user_query: str,
    query_vector: list[float],
    config: RetrievalConfig,
) -> LocalQueryPreparation:
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
        return LocalQueryPreparation(
            user_query=user_query,
            source_concepts=(),
            discovery_concepts=(),
            context="",
            traversal_plan=None,
            immediate_response=QueryResult(
                answer=answer,
                source_concepts=(),
                discovery_concepts=(),
            ),
        )

    source_concepts = tuple(hit.name for hit in search_result.source_concepts)
    discovery_concepts = tuple(hit.name for hit in search_result.discovery_concepts)
    context = build_local_context(search_result, config.max_context_words)
    provenance = build_local_answer_provenance(search_result, conn, config.max_context_words)

    return LocalQueryPreparation(
        user_query=user_query,
        source_concepts=source_concepts,
        discovery_concepts=discovery_concepts,
        context=context,
        traversal_plan=build_traversal_plan(conn, search_result, config),
        source_documents=provenance["source_documents"],
        discovery_documents=provenance["discovery_documents"],
        source_chunks=provenance["source_chunks"],
        discovery_chunks=provenance["discovery_chunks"],
        supporting_relationships=provenance["supporting_relationships"],
    )


def prepare_brainbank_query(
    user_query: str,
    lance_db_path: str = "./data/lancedb",
    kuzu_db_path: str = "./data/kuzu",
    shared_kuzu_db=None,
    config: RetrievalConfig | None = None,
) -> QueryPreparation:
    if config is None:
        config = RetrievalConfig()

    db, table = init_lancedb(lance_db_path)
    kuzu_db, conn, own_db = _get_query_connection(shared_kuzu_db, kuzu_db_path)
    query_vector = embed_query(user_query)

    try:
        route = classify_query_route(user_query)
        if route == QueryRoute.GLOBAL:
            return QueryPreparation(route=route, requires_direct_query=True)

        preparation = _prepare_local_query(
            db,
            table,
            conn,
            user_query,
            query_vector,
            config,
        )
        return QueryPreparation(
            route=route,
            requires_direct_query=False,
            source_concepts=preparation.source_concepts,
            discovery_concepts=preparation.discovery_concepts,
            traversal_plan=preparation.traversal_plan,
            prepared_local_query=preparation,
        )
    finally:
        conn.close()
        if own_db:
            kuzu_db.close()


def answer_prepared_local_query(
    preparation: LocalQueryPreparation,
    history: list[dict] | None = None,
) -> dict:
    if preparation.immediate_response is not None:
        return preparation.to_answer_response()

    answer = generate_answer(
        preparation.user_query,
        preparation.context,
        list(preparation.source_concepts) + list(preparation.discovery_concepts),
        history=history or None,
    )
    return preparation.to_answer_response(answer=answer)


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
                    source_documents=_build_documents_for_concepts(
                        table,
                        global_result.source_concepts,
                        GLOBAL_DOCUMENT_CITATION_LIMIT,
                    ),
                ).to_response()

        preparation = _prepare_local_query(
            db,
            table,
            conn,
            user_query,
            query_vector,
            config,
        )
        return answer_prepared_local_query(preparation, history=history)
    finally:
        conn.close()
        if own_db:
            kuzu_db.close()
