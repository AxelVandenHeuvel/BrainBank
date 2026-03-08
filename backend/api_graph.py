import kuzu
from fastapi import APIRouter, Depends, HTTPException

from backend.db.kuzu import get_db_connection, update_node_communities
from backend.db.lance import init_lancedb
from backend.services.clustering import run_leiden_clustering
from backend.schemas import (
    DiscoveryItemResponse,
    DiscoveryResponse,
    DocumentResponse,
    GraphEdgeResponse,
    RelationshipDetailsResponse,
)

graph_router = APIRouter(prefix="/api")


def _average_vectors(vectors: list[list[float]]) -> list[float]:
    if not vectors:
        return []

    size = len(vectors[0])
    centroid = [0.0] * size
    for vector in vectors:
        for index, value in enumerate(vector):
            centroid[index] += float(value)

    count = float(len(vectors))
    return [value / count for value in centroid]


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
    centroids_table = db.open_table("document_centroids")

    chunks_df = chunks_table.to_pandas()
    if chunks_df.empty:
        return DiscoveryResponse(concept_name=concept_name, results=[])

    exploded = chunks_df[["doc_id", "vector", "concepts"]].explode("concepts")
    concept_rows = exploded[exploded["concepts"] == concept_name]
    if concept_rows.empty:
        return DiscoveryResponse(concept_name=concept_name, results=[])

    concept_centroid = _average_vectors(concept_rows["vector"].tolist())
    if not concept_centroid:
        return DiscoveryResponse(concept_name=concept_name, results=[])

    existing_doc_ids = set(concept_rows["doc_id"].astype(str))
    search_result = centroids_table.search(concept_centroid).limit(50).to_pandas()

    results: list[DiscoveryItemResponse] = []
    for _, row in search_result.iterrows():
        if str(row["doc_id"]) in existing_doc_ids:
            continue

        distance = float(row.get("_distance", 0.0))
        similarity_score = 1.0 / (1.0 + distance)
        results.append(
            DiscoveryItemResponse(
                doc_name=str(row["doc_name"]),
                similarity_score=similarity_score,
            )
        )

        if len(results) == 5:
            break

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
