from fastapi import APIRouter, HTTPException

from backend.db.kuzu import init_kuzu
from backend.db.lance import init_lancedb
from backend.schemas import (
    DocumentResponse,
    GraphEdgeResponse,
    RelationshipDetailsResponse,
)

graph_router = APIRouter(prefix="/api")


def get_concept_documents_from_table(concept_name: str) -> list[DocumentResponse]:
    """Return full documents whose chunks mention the given concept."""
    _, table = init_lancedb()
    df = table.to_pandas()

    if df.empty:
        return []

    exploded = df[["doc_id", "doc_name", "text", "concepts"]].explode("concepts")
    matching_doc_ids = exploded[exploded["concepts"] == concept_name]["doc_id"].unique()
    matching = df[df["doc_id"].isin(matching_doc_ids)]
    if matching.empty:
        return []

    documents = []
    for doc_id, group in matching.groupby("doc_id", sort=False):
        documents.append(
            DocumentResponse(
                doc_id=doc_id,
                name=group["doc_name"].iloc[0],
                full_text="\n\n".join(group["text"].tolist()),
            )
        )

    return documents


def get_related_to_edges(conn) -> list[GraphEdgeResponse]:
    result = conn.execute(
        "MATCH (a:Concept)-[r:RELATED_TO]->(b:Concept) RETURN a.name, b.name, r.reason"
    )
    edges = []
    while result.has_next():
        source, target, reason = result.get_next()
        edges.append(
            GraphEdgeResponse(
                source=f"concept:{source}",
                target=f"concept:{target}",
                type="RELATED_TO",
                reason=reason,
            )
        )

    return edges


@graph_router.get("/graph")
def get_graph():
    """Return all nodes and edges for frontend visualization."""
    kuzu_db, conn = init_kuzu()
    try:
        _, table = init_lancedb()
        df = table.to_pandas()

        nodes = []
        edges = []

        result = conn.execute("MATCH (c:Concept) RETURN c.name")
        while result.has_next():
            name = result.get_next()[0]
            nodes.append({"id": f"concept:{name}", "type": "Concept", "name": name})

        if not df.empty:
            for _, row in df.drop_duplicates("doc_id")[["doc_id", "doc_name"]].iterrows():
                nodes.append(
                    {"id": f"doc:{row['doc_id']}", "type": "Document", "name": row["doc_name"]}
                )

            exploded = df[["doc_id", "concepts"]].explode("concepts").drop_duplicates()
            for _, row in exploded.iterrows():
                if row["concepts"]:
                    edges.append(
                        GraphEdgeResponse(
                            source=f"doc:{row['doc_id']}",
                            target=f"concept:{row['concepts']}",
                            type="MENTIONS",
                        ).model_dump()
                    )

        edges.extend(edge.model_dump() for edge in get_related_to_edges(conn))

        return {"nodes": nodes, "edges": edges}
    finally:
        conn.close()
        kuzu_db.close()


@graph_router.get("/relationships/details", response_model=RelationshipDetailsResponse)
def get_relationship_details(source: str, target: str):
    """Return stored evidence for one concept-to-concept relationship."""
    kuzu_db, conn = init_kuzu()
    try:
        result = conn.execute(
            "MATCH (a:Concept {name: $source})-[r:RELATED_TO]->(b:Concept {name: $target}) "
            "RETURN r.reason",
            parameters={"source": source, "target": target},
        )

        if not result.has_next():
            raise HTTPException(status_code=404, detail="Relationship not found")

        reason = result.get_next()[0]
        source_documents = get_concept_documents_from_table(source)
        target_documents = get_concept_documents_from_table(target)
        shared_document_ids = sorted(
            {document.doc_id for document in source_documents}.intersection(
                document.doc_id for document in target_documents
            )
        )

        return RelationshipDetailsResponse(
            source=source,
            target=target,
            type="RELATED_TO",
            reason=reason,
            source_documents=source_documents,
            target_documents=target_documents,
            shared_document_ids=shared_document_ids,
        )
    finally:
        conn.close()
        kuzu_db.close()


@graph_router.get("/concepts")
def get_concepts():
    """Return all concepts with document counts and related concepts."""
    kuzu_db, conn = init_kuzu()
    try:
        _, table = init_lancedb()
        df = table.to_pandas()

        concepts = []
        result = conn.execute("MATCH (c:Concept) RETURN c.name")
        while result.has_next():
            name = result.get_next()[0]

            if df.empty:
                doc_count = 0
            else:
                exploded = df[["doc_id", "concepts"]].explode("concepts")
                doc_count = int(exploded[exploded["concepts"] == name]["doc_id"].nunique())

            rel_result = conn.execute(
                "MATCH (c:Concept {name: $name})-[:RELATED_TO]-(other:Concept) "
                "RETURN other.name",
                parameters={"name": name},
            )
            related = []
            while rel_result.has_next():
                related.append(rel_result.get_next()[0])

            concepts.append(
                {"name": name, "document_count": doc_count, "related_concepts": related}
            )

        return {"concepts": concepts}
    finally:
        conn.close()
        kuzu_db.close()


@graph_router.get("/documents")
def get_documents():
    """Return all documents with chunk counts and linked concepts."""
    _, table = init_lancedb()
    df = table.to_pandas()

    if df.empty:
        return {"documents": []}

    documents = []
    for doc_id, group in df.groupby("doc_id", sort=False):
        doc_name = group["doc_name"].iloc[0]
        chunk_count = len(group)
        all_concepts = group["concepts"].explode().dropna().unique().tolist()
        documents.append(
            {
                "doc_id": doc_id,
                "name": doc_name,
                "chunk_count": chunk_count,
                "concepts": all_concepts,
            }
        )

    return {"documents": documents}


@graph_router.get("/concepts/{concept_name}/documents", response_model=list[DocumentResponse])
def get_concept_documents(concept_name: str):
    """Return full text of every document whose chunks are tagged with concept_name."""
    return get_concept_documents_from_table(concept_name)


@graph_router.get("/stats")
def get_stats():
    """Return aggregate counts across the knowledge graph."""
    kuzu_db, conn = init_kuzu()
    try:
        _, table = init_lancedb()
        df = table.to_pandas()

        concept_result = conn.execute("MATCH (c:Concept) RETURN count(c)")
        rel_result = conn.execute("MATCH ()-[r:RELATED_TO]->() RETURN count(r)")

        total_documents = int(df["doc_id"].nunique()) if not df.empty else 0

        return {
            "total_documents": total_documents,
            "total_chunks": len(df),
            "total_concepts": concept_result.get_next()[0],
            "total_relationships": rel_result.get_next()[0],
        }
    finally:
        conn.close()
        kuzu_db.close()
