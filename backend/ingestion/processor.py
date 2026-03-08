import kuzu as _kuzu
import uuid
from itertools import combinations

from backend.db.kuzu import init_kuzu, update_node_communities
from backend.db.lance import init_lancedb
from backend.ingestion.chunker import semantic_chunk_text as chunk_text
from backend.services.clustering import run_leiden_clustering
from backend.services.embeddings import (
    calculate_color_score,
    calculate_document_centroid,
    embed_texts,
)
from backend.services.llm import extract_concepts


SHARED_DOCUMENT_REASON = "shared_document"


def ingest_markdown(
    text: str,
    doc_name: str,
    lance_db_path: str = "./data/lancedb",
    kuzu_db_path: str = "./data/kuzu",
    shared_kuzu_db=None,
) -> dict:
    db, table = init_lancedb(lance_db_path)
    centroids_table = db.open_table("document_centroids")

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

        # Extract concepts via LLM (graceful fallback: note saves even if LLM is unavailable)
        try:
            extraction = extract_concepts(text, doc_name)
            concepts = extraction.get("concepts", [])
        except Exception:
            concepts = []

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

        centroid_vector = calculate_document_centroid(doc_id, table)
        centroids_table.add(
            [
                {
                    "doc_id": doc_id,
                    "doc_name": doc_name,
                    "centroid_vector": centroid_vector,
                }
            ]
        )

        unique_concepts = sorted(set(concepts))

        # Upsert Concept nodes in Kuzu with semantic color score
        for concept in unique_concepts:
            score = calculate_color_score(concept)
            conn.execute(
                "MERGE (c:Concept {name: $name})", parameters={"name": concept}
            )
            conn.execute(
                "MATCH (c:Concept {name: $name}) SET c.colorScore = $score",
                parameters={"name": concept, "score": score},
            )

        # Shared-document weighting: increment RELATED_TO for each concept pair
        for from_concept, to_concept in combinations(unique_concepts, 2):
            conn.execute(
                "MATCH (a:Concept {name: $from_c}), (b:Concept {name: $to_c}) "
                "MERGE (a)-[r:RELATED_TO]->(b) "
                "ON CREATE SET r.weight = 1.0, r.reason = $reason "
                "ON MATCH SET r.weight = r.weight + 1.0",
                parameters={
                    "from_c": from_concept,
                    "to_c": to_concept,
                    "reason": SHARED_DOCUMENT_REASON,
                },
            )

        community_map = run_leiden_clustering(conn)
        update_node_communities(conn, community_map)

        return {"doc_id": doc_id, "chunks": len(chunks), "concepts": concepts}
    finally:
        conn.close()
        if own_db:
            kuzu_db.close()
