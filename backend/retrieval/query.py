from backend.db.kuzu import init_kuzu
from backend.db.lance import init_lancedb
from backend.services.embeddings import embed_query
from backend.services.llm import generate_answer


def query_brainbank(
    user_query: str,
    lance_db_path: str = "./data/lancedb",
    kuzu_db_path: str = "./data/kuzu",
) -> dict:
    db, table = init_lancedb(lance_db_path)
    kuzu_db, conn = init_kuzu(kuzu_db_path)

    # Step 1: Vector search for top 5 chunks
    query_vector = embed_query(user_query)
    df = table.to_pandas()

    if df.empty:
        return {
            "answer": "No relevant information found.",
            "source_concepts": [],
            "discovery_concepts": [],
        }

    results = table.search(query_vector).limit(5).to_pandas()
    initial_chunk_ids = results["chunk_id"].tolist()
    initial_texts = results["text"].tolist()

    # Step 2: Find connected Concept nodes for those chunks
    source_concepts = set()
    for chunk_id in initial_chunk_ids:
        result = conn.execute(
            "MATCH (d:Document)-[m:MENTIONS]->(c:Concept) "
            "WHERE list_contains(m.chunk_ids, $cid) "
            "RETURN c.name",
            parameters={"cid": chunk_id},
        )
        while result.has_next():
            source_concepts.add(result.get_next()[0])

    # Step 3: Graph expansion - find 1-hop RELATED_TO neighbors
    discovery_concepts = set()
    for concept in source_concepts:
        result = conn.execute(
            "MATCH (c:Concept {name: $name})-[:RELATED_TO]-(neighbor:Concept) "
            "RETURN neighbor.name",
            parameters={"name": concept},
        )
        while result.has_next():
            neighbor = result.get_next()[0]
            if neighbor not in source_concepts:
                discovery_concepts.add(neighbor)

    # Step 4: Retrieve chunk texts for discovery concepts
    all_texts = list(initial_texts)
    for concept in discovery_concepts:
        result = conn.execute(
            "MATCH (d:Document)-[m:MENTIONS]->(c:Concept {name: $name}) "
            "RETURN m.chunk_ids",
            parameters={"name": concept},
        )
        while result.has_next():
            extra_chunk_ids = result.get_next()[0]
            for cid in extra_chunk_ids:
                if cid not in initial_chunk_ids:
                    row = df[df["chunk_id"] == cid]
                    if not row.empty:
                        all_texts.append(row.iloc[0]["text"])

    # Step 5: Generate grounded answer
    all_concepts = list(source_concepts | discovery_concepts)
    context = "\n\n---\n\n".join(all_texts)
    answer = generate_answer(user_query, context, all_concepts)

    return {
        "answer": answer,
        "source_concepts": list(source_concepts),
        "discovery_concepts": list(discovery_concepts),
    }
