from backend.db.kuzu import init_kuzu
from backend.db.lance import init_lancedb
from backend.services.embeddings import embed_query
from backend.services.llm import generate_answer


def normalize_concepts(value) -> list[str]:
    if value is None:
        return []

    return list(value)


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

    # Step 2: Read source concepts directly from LanceDB chunk metadata.
    source_concepts = {
        concept
        for concepts in results["concepts"].tolist()
        for concept in normalize_concepts(concepts)
    }

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

    # Step 4: Retrieve chunk texts for discovery concepts from LanceDB metadata.
    all_texts = list(initial_texts)
    for concept in discovery_concepts:
        matching_rows = df[
            df["concepts"].apply(
                lambda concepts: concept in normalize_concepts(concepts)
            )
        ]
        for _, row in matching_rows.iterrows():
            if row["chunk_id"] not in initial_chunk_ids:
                all_texts.append(row["text"])

    # Step 5: Generate grounded answer
    source_concept_list = sorted(source_concepts)
    discovery_concept_list = sorted(discovery_concepts)
    all_concepts = source_concept_list + discovery_concept_list
    context = "\n\n---\n\n".join(all_texts)
    answer = generate_answer(user_query, context, all_concepts)

    return {
        "answer": answer,
        "source_concepts": source_concept_list,
        "discovery_concepts": discovery_concept_list,
    }
