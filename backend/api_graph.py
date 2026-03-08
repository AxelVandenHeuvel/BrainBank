import asyncio
from functools import partial

import kuzu
from fastapi import APIRouter, Depends, HTTPException

from backend.db.kuzu import get_db_connection, get_kuzu_engine, update_node_communities
from backend.db.lance import (
    init_lancedb,
    create_document_text,
    delete_document_chunks,
    update_document_text,
)
from backend.ingestion.processor import ingest_markdown
from backend.retrieval.latent_discovery import concept_name_from_query_rows, find_latent_document_hits
from backend.services.clustering import run_leiden_clustering
from backend.schemas import (
    DiscoveryItemResponse,
    DiscoveryResponse,
    DocumentResponse,
    GraphEdgeResponse,
    RelationshipDetailsResponse,
    UpdateDocumentRequest,
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


def get_document_from_table(doc_id: str) -> DocumentResponse | None:
    """Return one full document by doc_id."""
    _, table = init_lancedb()
    df = table.to_pandas()

    if df.empty:
        return None

    matching = df[df["doc_id"] == doc_id]
    if matching.empty:
        return None

    return DocumentResponse(
        doc_id=doc_id,
        name=matching["doc_name"].iloc[0],
        full_text="\n\n".join(matching["text"].tolist()),
    )


def get_related_to_edges(conn: kuzu.Connection) -> list[GraphEdgeResponse]:
    result = conn.execute(
        "MATCH (a:Concept)-[r:RELATED_TO]->(b:Concept) RETURN a.name, b.name, r.reason, r.weight, r.edge_type"
    )
    edges = []
    while result.has_next():
        source, target, reason, weight, edge_type = result.get_next()
        safe_weight = float(weight) if weight is not None else 1.0
        safe_type = edge_type if edge_type else "RELATED_TO"
        edges.append(
            GraphEdgeResponse(
                source=f"concept:{source}",
                target=f"concept:{target}",
                type=safe_type,
                reason=reason,
                weight=safe_weight,
            )
        )

    return edges


@graph_router.get("/graph")
def get_graph(conn: kuzu.Connection = Depends(get_db_connection)):
    """Return all concept nodes and edges for frontend visualization."""
    nodes = []
    result = conn.execute("MATCH (c:Concept) RETURN c.name, c.colorScore, c.community_id")
    while result.has_next():
        name, color_score, community_id = result.get_next()
        nodes.append({
            "id": f"concept:{name}",
            "type": "Concept",
            "name": name,
            "colorScore": color_score,
            "community_id": community_id if community_id is not None and community_id >= 0 else None,
        })

    edges = [edge.model_dump() for edge in get_related_to_edges(conn)]
    return {"nodes": nodes, "edges": edges}


@graph_router.get("/relationships/details", response_model=RelationshipDetailsResponse)
def get_relationship_details(
    source: str,
    target: str,
    conn: kuzu.Connection = Depends(get_db_connection),
):
    """Return stored evidence for one concept-to-concept relationship."""
    result = conn.execute(
        "MATCH (a:Concept {name: $source})-[r:RELATED_TO]-(b:Concept {name: $target}) "
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


@graph_router.get("/discovery/latent/{concept_name}", response_model=DiscoveryResponse)
def get_latent_discovery(concept_name: str):
    """Return semantically similar documents that do not already contain concept_name."""
    db, chunks_table = init_lancedb()
    chunks_df = chunks_table.to_pandas()
    if chunks_df.empty:
        return DiscoveryResponse(concept_name=concept_name, results=[])

    try:
        concept_centroids_table = db.open_table("concept_centroids")
    except Exception:
        concept_centroids_table = None

    excluded_doc_ids, ranked_concepts = concept_name_from_query_rows(chunks_df, concept_name)
    if not ranked_concepts:
        return DiscoveryResponse(concept_name=concept_name, results=[])

    results: list[DiscoveryItemResponse] = []
    hits = find_latent_document_hits(
        db,
        chunks_df,
        ranked_concepts=ranked_concepts,
        excluded_doc_ids=excluded_doc_ids,
        limit=5,
        concept_centroids_table=concept_centroids_table,
    )
    for hit in hits:
        results.append(
            DiscoveryItemResponse(
                doc_name=hit.doc_name,
                similarity_score=hit.score,
            )
        )

    return DiscoveryResponse(concept_name=concept_name, results=results)


@graph_router.get("/concepts")
def get_concepts(conn: kuzu.Connection = Depends(get_db_connection)):
    """Return all concepts with document counts and related concepts."""
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


@graph_router.post("/documents")
def create_document(body: UpdateDocumentRequest):
    """Fast draft save: create a lightweight document without full ingest."""
    doc_id = create_document_text("./data/lancedb", body.title, body.text)
    return {"doc_id": doc_id, "status": "saved"}


@graph_router.get("/documents/{doc_id}", response_model=DocumentResponse)
def get_document(doc_id: str):
    """Return the full text for one document id."""
    document = get_document_from_table(doc_id)
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return document


@graph_router.put("/documents/{doc_id}")
async def update_document(doc_id: str, body: UpdateDocumentRequest):
    """Lightweight save: update document text without re-running the full pipeline."""
    updated = update_document_text("./data/lancedb", doc_id, body.title, body.text)
    if not updated:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"doc_id": doc_id, "status": "saved"}


@graph_router.post("/documents/{doc_id}/reingest")
async def reingest_document(doc_id: str, body: UpdateDocumentRequest):
    """Full re-ingest: delete old chunks, re-embed, re-extract concepts, rebuild graph."""
    delete_document_chunks("./data/lancedb", doc_id)

    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        None,
        partial(
            ingest_markdown,
            body.text,
            body.title,
            shared_kuzu_db=get_kuzu_engine(),
            doc_id=doc_id,
        ),
    )
    return result


@graph_router.get("/concepts/{concept_name}/documents", response_model=list[DocumentResponse])
def get_concept_documents(concept_name: str):
    """Return full text of every document whose chunks are tagged with concept_name."""
    return get_concept_documents_from_table(concept_name)


@graph_router.get("/stats")
def get_stats(conn: kuzu.Connection = Depends(get_db_connection)):
    """Return aggregate counts across the knowledge graph."""
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


@graph_router.post("/recluster")
def recluster(conn: kuzu.Connection = Depends(get_db_connection)):
    """Run Leiden clustering over all current Concept nodes and persist results."""
    community_map = run_leiden_clustering(conn)
    update_node_communities(conn, community_map)
    return {"clustered": len(community_map)}
