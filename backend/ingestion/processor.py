import uuid

from backend.db.kuzu import init_kuzu
from backend.db.lance import init_lancedb
from backend.ingestion.chunker import semantic_chunk_text as chunk_text
from backend.services.embeddings import embed_texts
from backend.services.llm import extract_concepts


def ingest_markdown(
    text: str,
    doc_name: str,
    lance_db_path: str = "./data/lancedb",
    kuzu_db_path: str = "./data/kuzu",
) -> dict:
    db, table = init_lancedb(lance_db_path)
    kuzu_db, conn = init_kuzu(kuzu_db_path)

    doc_id = str(uuid.uuid4())
    chunks = chunk_text(text)
    chunk_ids = [str(uuid.uuid4()) for _ in chunks]
    vectors = embed_texts(chunks)

    # Store chunks in LanceDB
    records = [
        {"chunk_id": cid, "doc_id": doc_id, "text": t, "vector": v}
        for cid, t, v in zip(chunk_ids, chunks, vectors)
    ]
    table.add(records)

    # Extract concepts via LLM
    extraction = extract_concepts(text, doc_name)
    concepts = extraction.get("concepts", [])
    relationships = extraction.get("relationships", [])

    # Upsert Document node
    conn.execute(
        "MERGE (d:Document {doc_id: $doc_id}) SET d.name = $name",
        parameters={"doc_id": doc_id, "name": doc_name},
    )

    # Upsert Concept nodes and create MENTIONS edges
    for concept in concepts:
        # Find which chunks mention this concept
        matching = [
            cid
            for cid, t in zip(chunk_ids, chunks)
            if concept.lower() in t.lower()
        ]
        if not matching:
            matching = chunk_ids  # fallback: link to all chunks

        conn.execute(
            "MERGE (c:Concept {name: $name})", parameters={"name": concept}
        )
        conn.execute(
            "MATCH (d:Document {doc_id: $doc_id}), (c:Concept {name: $concept}) "
            "CREATE (d)-[:MENTIONS {chunk_ids: $chunk_ids}]->(c)",
            parameters={
                "doc_id": doc_id,
                "concept": concept,
                "chunk_ids": matching,
            },
        )

    # Create RELATED_TO edges
    for rel in relationships:
        conn.execute(
            "MERGE (a:Concept {name: $from_c})",
            parameters={"from_c": rel["from"]},
        )
        conn.execute(
            "MERGE (b:Concept {name: $to_c})",
            parameters={"to_c": rel["to"]},
        )
        conn.execute(
            "MATCH (a:Concept {name: $from_c}), (b:Concept {name: $to_c}) "
            "CREATE (a)-[:RELATED_TO {relationship: $rel}]->(b)",
            parameters={
                "from_c": rel["from"],
                "to_c": rel["to"],
                "rel": rel.get("relationship", "related_to"),
            },
        )

    return {"doc_id": doc_id, "chunks": len(chunks), "concepts": concepts}
