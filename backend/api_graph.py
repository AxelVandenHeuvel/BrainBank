from fastapi import APIRouter

from backend.db.kuzu import init_kuzu
from backend.db.lance import init_lancedb

graph_router = APIRouter(prefix="/api")


@graph_router.get("/graph")
def get_graph():
    """Return all nodes and edges for frontend visualization."""
    _, conn = init_kuzu()

    nodes = []
    edges = []

    # Concept nodes
    result = conn.execute("MATCH (c:Concept) RETURN c.name")
    while result.has_next():
        name = result.get_next()[0]
        nodes.append({"id": f"concept:{name}", "type": "Concept", "name": name})

    # Document nodes
    result = conn.execute("MATCH (d:Document) RETURN d.doc_id, d.name")
    while result.has_next():
        row = result.get_next()
        nodes.append({"id": f"doc:{row[0]}", "type": "Document", "name": row[1]})

    # MENTIONS edges
    result = conn.execute(
        "MATCH (d:Document)-[:MENTIONS]->(c:Concept) RETURN d.doc_id, c.name"
    )
    while result.has_next():
        row = result.get_next()
        edges.append(
            {"source": f"doc:{row[0]}", "target": f"concept:{row[1]}", "type": "MENTIONS"}
        )

    # RELATED_TO edges
    result = conn.execute(
        "MATCH (a:Concept)-[r:RELATED_TO]->(b:Concept) "
        "RETURN a.name, b.name, r.relationship"
    )
    while result.has_next():
        row = result.get_next()
        edges.append(
            {"source": f"concept:{row[0]}", "target": f"concept:{row[1]}", "type": row[2]}
        )

    return {"nodes": nodes, "edges": edges}


@graph_router.get("/concepts")
def get_concepts():
    """Return all concepts with document counts and related concepts."""
    _, conn = init_kuzu()

    concepts = []
    result = conn.execute("MATCH (c:Concept) RETURN c.name")
    while result.has_next():
        name = result.get_next()[0]

        # Count documents that mention this concept
        doc_result = conn.execute(
            "MATCH (d:Document)-[:MENTIONS]->(c:Concept {name: $name}) "
            "RETURN count(d)",
            parameters={"name": name},
        )
        doc_count = doc_result.get_next()[0]

        # Find related concepts
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
    _, conn = init_kuzu()
    _, table = init_lancedb()

    df = table.to_pandas()

    documents = []
    result = conn.execute("MATCH (d:Document) RETURN d.doc_id, d.name")
    while result.has_next():
        row = result.get_next()
        doc_id, name = row[0], row[1]

        chunk_count = len(df[df["doc_id"] == doc_id])

        # Find concepts mentioned by this document
        concept_result = conn.execute(
            "MATCH (d:Document {doc_id: $doc_id})-[:MENTIONS]->(c:Concept) "
            "RETURN c.name",
            parameters={"doc_id": doc_id},
        )
        concepts = []
        while concept_result.has_next():
            concepts.append(concept_result.get_next()[0])

        documents.append(
            {"doc_id": doc_id, "name": name, "chunk_count": chunk_count, "concepts": concepts}
        )

    return {"documents": documents}


@graph_router.get("/stats")
def get_stats():
    """Return aggregate counts across the knowledge graph."""
    _, conn = init_kuzu()
    _, table = init_lancedb()

    df = table.to_pandas()

    doc_result = conn.execute("MATCH (d:Document) RETURN count(d)")
    concept_result = conn.execute("MATCH (c:Concept) RETURN count(c)")
    rel_result = conn.execute(
        "MATCH ()-[r:RELATED_TO]->() RETURN count(r)"
    )

    return {
        "total_documents": doc_result.get_next()[0],
        "total_chunks": len(df),
        "total_concepts": concept_result.get_next()[0],
        "total_relationships": rel_result.get_next()[0],
    }
