import kuzu as _kuzu
import uuid

from backend.db.kuzu import init_kuzu
from backend.db.lance import init_lancedb
from backend.ingestion.chunker import semantic_chunk_text as chunk_text
from backend.services.embeddings import calculate_color_score, embed_texts
from backend.services.llm import extract_concepts


def ingest_markdown(
    text: str,
    doc_name: str,
    lance_db_path: str = "./data/lancedb",
    kuzu_db_path: str = "./data/kuzu",
    shared_kuzu_db=None,
) -> dict:
    db, table = init_lancedb(lance_db_path)

    # When the backend is running, the caller passes the module-level Database
    # object so we reuse it instead of opening a second one (which would fail
    # with a lock conflict).  Tests pass shared_kuzu_db=None and supply their
    # own kuzu_db_path temp directory.
    if shared_kuzu_db is not None:
        kuzu_db = shared_kuzu_db
        conn = _kuzu.Connection(kuzu_db)
        own_db = False
    else:
        kuzu_db, conn = init_kuzu(kuzu_db_path)
        own_db = True
    try:
        doc_id = str(uuid.uuid4())
        chunks = chunk_text(text)
        chunk_ids = [str(uuid.uuid4()) for _ in chunks]
        vectors = embed_texts(chunks)

        # Extract concepts via LLM (graceful — note saves even if LLM is unavailable)
        try:
            extraction = extract_concepts(text, doc_name)
            concepts = extraction.get("concepts", [])
            relationships = extraction.get("relationships", [])
        except Exception:
            concepts = []
            relationships = []

        # Determine which concepts each chunk mentions
        def chunk_concepts(chunk_text_: str) -> list[str]:
            matched = [c for c in concepts if c.lower() in chunk_text_.lower()]
            return matched if matched else concepts  # fallback: tag all

        # Store chunks in LanceDB with doc_name and per-chunk concept tags.
        # This is the sole source of the document<->concept link.
        records = [
            {
                "chunk_id": cid,
                "doc_id": doc_id,
                "doc_name": doc_name,
                "text": t,
                "concepts": chunk_concepts(t),
                "vector": v,
            }
            for cid, t, v in zip(chunk_ids, chunks, vectors)
        ]
        table.add(records)

        # Upsert Concept nodes in Kuzu with semantic color score
        for concept in concepts:
            score = calculate_color_score(concept)
            conn.execute(
                "MERGE (c:Concept {name: $name})", parameters={"name": concept}
            )
            conn.execute(
                "MATCH (c:Concept {name: $name}) SET c.colorScore = $score",
                parameters={"name": concept, "score": score},
            )

        # Create RELATED_TO edges between concepts
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
                "CREATE (a)-[:RELATED_TO {reason: $reason}]->(b)",
                parameters={
                    "from_c": rel["from"],
                    "to_c": rel["to"],
                    "reason": rel.get("relationship", "related_to"),
                },
            )

        return {"doc_id": doc_id, "chunks": len(chunks), "concepts": concepts}
    finally:
        conn.close()
        if own_db:
            kuzu_db.close()
