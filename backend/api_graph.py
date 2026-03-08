from fastapi import APIRouter

from backend.db.kuzu import init_kuzu
from backend.db.lance import init_lancedb
from backend.schemas import DocumentResponse

graph_router = APIRouter(prefix="/api")

# 🚀 THE FIX: Initialize embedded databases EXACTLY ONCE globally
kuzu_db, conn = init_kuzu()
_, table = init_lancedb()


@graph_router.get("/graph")
def get_graph():
    """Return all nodes and edges for frontend visualization."""
    nodes = []
    edges = []

    # Concept nodes from Kuzu
    result = conn.execute("MATCH (c:Concept) RETURN c.name, c.colorScore")
    while result.has_next():
        row = result.get_next()
        name, color_score = row[0], row[1]
        nodes.append({"id": f"concept:{name}", "type": "Concept", "name": name, "colorScore": color_score})

    # RELATED_TO edges from Kuzu
    result = conn.execute(
        "MATCH (a:Concept)-[r:RELATED_TO]->(b:Concept) RETURN a.name, b.name, r.reason"
    )
    while result.has_next():
        row = result.get_next()
        edges.append(
            {"source": f"concept:{row[0]}", "target": f"concept:{row[1]}", "type": row[2]}
        )
    print(f"Nodes: {nodes}")
    print(f"Edges: {edges}")
    return {"nodes": nodes, "edges": edges}


@graph_router.get("/concepts")
def get_concepts():
    """Return all concepts with document counts and related concepts."""
    df = table.to_pandas()

    concepts = []
    result = conn.execute("MATCH (c:Concept) RETURN c.name")
    while result.has_next():
        name = result.get_next()[0]

        if df.empty:
            doc_count = 0
        else:
            exploded = df[["doc_id", "concepts"]].explode("concepts")
            doc_count = int(
                exploded[exploded["concepts"] == name]["doc_id"].nunique()
            )

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
    df = table.to_pandas()

    if df.empty:
        return {"documents": []}

    documents = []
    for doc_id, group in df.groupby("doc_id", sort=False):
        doc_name = group["doc_name"].iloc[0]
        chunk_count = len(group)
        all_concepts = group["concepts"].explode().dropna().unique().tolist()
        documents.append(
            {"doc_id": doc_id, "name": doc_name, "chunk_count": chunk_count, "concepts": all_concepts}
        )

    return {"documents": documents}


@graph_router.get("/concepts/{concept_name}/documents", response_model=list[DocumentResponse])
def get_concept_documents(concept_name: str):
    """Return full text of every document whose chunks are tagged with concept_name."""
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
        full_text = "\n\n".join(group["text"].tolist())
        name = group["doc_name"].iloc[0]
        documents.append(DocumentResponse(doc_id=doc_id, name=name, full_text=full_text))

    return documents


@graph_router.get("/stats")
def get_stats():
    """Return aggregate counts across the knowledge graph."""
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