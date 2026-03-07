from fastapi import APIRouter

from backend.db.kuzu import init_kuzu
from backend.db.lance import init_lancedb
from backend.schemas import DocumentResponse

graph_router = APIRouter(prefix="/api")

db, conn = init_kuzu()

@graph_router.get("/graph")
def get_graph():
    """Return all nodes and edges for frontend visualization."""
    try:
        _, table = init_lancedb()
        df = table.to_pandas()

        nodes = []
        edges = []

        # Concept nodes from Kuzu
        result = conn.execute("MATCH (c:Concept) RETURN c.name")
        while result.has_next():
            name = result.get_next()[0]
            nodes.append({"id": f"concept:{name}", "type": "Concept", "name": name})

        # Document nodes from LanceDB (distinct docs)
        if not df.empty:
            for _, row in df.drop_duplicates("doc_id")[["doc_id", "doc_name"]].iterrows():
                nodes.append(
                    {"id": f"doc:{row['doc_id']}", "type": "Document", "name": row["doc_name"]}
                )

            # MENTIONS edges from LanceDB (one edge per unique doc→concept pair)
            for _, row in df[["doc_id", "concepts"]].explode("concepts").drop_duplicates().iterrows():
                if row["concepts"]:
                    edges.append(
                        {
                            "source": f"doc:{row['doc_id']}",
                            "target": f"concept:{row['concepts']}",
                            "type": "MENTIONS",
                        }
                    )

        # RELATED_TO edges from Kuzu
        result = conn.execute(
            "MATCH (a:Concept)-[r:RELATED_TO]->(b:Concept) RETURN a.name, b.name, r.reason"
        )
        while result.has_next():
            row = result.get_next()
            edges.append(
                {"source": f"concept:{row[0]}", "target": f"concept:{row[1]}", "type": row[2]}
            )

        return {"nodes": nodes, "edges": edges}
    finally:
        conn.close()
        db.close()


@graph_router.get("/concepts")
def get_concepts():
    """Return all concepts with document counts and related concepts."""
    try:
        _, table = init_lancedb()
        df = table.to_pandas()

        concepts = []
        result = conn.execute("MATCH (c:Concept) RETURN c.name")
        while result.has_next():
            name = result.get_next()[0]

            # Count distinct documents that have chunks tagged with this concept
            if df.empty:
                doc_count = 0
            else:
                exploded = df[["doc_id", "concepts"]].explode("concepts")
                doc_count = int(
                    exploded[exploded["concepts"] == name]["doc_id"].nunique()
                )

            # Related concepts from Kuzu
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
        db.close()


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
        # Union of all concepts across chunks, deduplicated
        all_concepts = group["concepts"].explode().dropna().unique().tolist()
        documents.append(
            {"doc_id": doc_id, "name": doc_name, "chunk_count": chunk_count, "concepts": all_concepts}
        )

    return {"documents": documents}


@graph_router.get("/concepts/{concept_name}/documents", response_model=list[DocumentResponse])
def get_concept_documents(concept_name: str):
    """Return full text of every document whose chunks are tagged with concept_name."""
    _, table = init_lancedb()
    df = table.to_pandas()

    if df.empty:
        return []

    # Filter to chunks that mention this concept
    exploded = df[["doc_id", "doc_name", "text", "concepts"]].explode("concepts")
    matching_doc_ids = exploded[exploded["concepts"] == concept_name]["doc_id"].unique()
    matching = df[df["doc_id"].isin(matching_doc_ids)]
    if matching.empty:
        return []

    # Group chunks by document, join text to form the full readable document
    documents = []
    for doc_id, group in matching.groupby("doc_id", sort=False):
        full_text = "\n\n".join(group["text"].tolist())
        name = group["doc_name"].iloc[0]
        documents.append(DocumentResponse(doc_id=doc_id, name=name, full_text=full_text))

    return documents


@graph_router.get("/stats")
def get_stats():
    """Return aggregate counts across the knowledge graph."""
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
        db.close()
