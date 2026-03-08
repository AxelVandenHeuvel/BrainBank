import kuzu

from backend.retrieval.context import assemble_context_chunks
from backend.retrieval.types import (
    ChunkCitation,
    DocumentCitation,
    LocalSearchResult,
    RelationshipCitation,
)


def _document_citations_from_chunks(chunks) -> tuple[DocumentCitation, ...]:
    citations: list[DocumentCitation] = []
    seen_doc_ids: set[str] = set()

    for chunk in chunks:
        if chunk.doc_id in seen_doc_ids:
            continue
        seen_doc_ids.add(chunk.doc_id)
        citations.append(DocumentCitation(doc_id=chunk.doc_id, name=chunk.doc_name))

    return tuple(citations)


def _chunk_citations_from_chunks(chunks) -> tuple[ChunkCitation, ...]:
    return tuple(
        ChunkCitation(
            chunk_id=chunk.chunk_id,
            doc_id=chunk.doc_id,
            doc_name=chunk.doc_name,
            text=chunk.text,
        )
        for chunk in chunks
    )


def collect_supporting_relationships(
    conn: kuzu.Connection,
    concept_names: list[str] | tuple[str, ...],
) -> tuple[RelationshipCitation, ...]:
    if not concept_names:
        return ()

    concept_set = set(concept_names)
    relationships: list[RelationshipCitation] = []
    seen_edges: set[tuple[frozenset[str], str]] = set()

    for concept_name in concept_names:
        result = conn.execute(
            "MATCH (a:Concept {name: $source})-[r:RELATED_TO]-(b:Concept) "
            "RETURN b.name, r.reason, r.edge_type",
            parameters={"source": concept_name},
        )

        while result.has_next():
            neighbor_name, reason, edge_type = result.get_next()
            neighbor_name = str(neighbor_name)
            if neighbor_name not in concept_set:
                continue

            relationship_type = str(edge_type) if edge_type else "RELATED_TO"
            edge_key = (frozenset((concept_name, neighbor_name)), relationship_type)
            if edge_key in seen_edges:
                continue
            seen_edges.add(edge_key)

            relationships.append(
                RelationshipCitation(
                    source=concept_name,
                    target=neighbor_name,
                    type=relationship_type,
                    reason=str(reason) if reason is not None else None,
                )
            )

    relationships.sort(key=lambda relationship: (relationship.source, relationship.target, relationship.type))
    return tuple(relationships)


def build_local_answer_provenance(
    search_result: LocalSearchResult,
    conn: kuzu.Connection,
    max_context_words: int,
) -> dict:
    selected_source_chunks = tuple(assemble_context_chunks(search_result.seed_chunks, (), max_context_words))
    selected_discovery_chunks = tuple(
        assemble_context_chunks(search_result.discovery_chunks, (), max_context_words)
    )
    related_concepts = [
        *[hit.name for hit in search_result.source_concepts],
        *[hit.name for hit in search_result.discovery_concepts],
    ]

    return {
        "source_documents": _document_citations_from_chunks(selected_source_chunks),
        "discovery_documents": _document_citations_from_chunks(selected_discovery_chunks),
        "source_chunks": _chunk_citations_from_chunks(selected_source_chunks),
        "discovery_chunks": _chunk_citations_from_chunks(selected_discovery_chunks),
        "supporting_relationships": collect_supporting_relationships(conn, related_concepts),
    }
