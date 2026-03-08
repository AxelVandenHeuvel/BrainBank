from backend.retrieval.types import LatentDocumentHit


def average_vectors(vectors: list[list[float]]) -> list[float]:
    if not vectors:
        return []

    size = len(vectors[0])
    centroid = [0.0] * size
    for vector in vectors:
        for index, value in enumerate(vector):
            centroid[index] += float(value)

    count = float(len(vectors))
    return [value / count for value in centroid]


def similarity_from_distance(distance: float) -> float:
    return 1.0 / (1.0 + max(0.0, float(distance)))


def compute_concept_centroid(
    chunks_df,
    concept_name: str,
    concept_centroids_table=None,
) -> list[float]:
    if concept_centroids_table is not None:
        try:
            centroid_df = concept_centroids_table.to_pandas()
        except Exception:
            centroid_df = None
        if centroid_df is not None and not centroid_df.empty:
            match = centroid_df[centroid_df["concept_name"] == concept_name]
            if not match.empty:
                vector = match.iloc[0]["centroid_vector"]
                return [float(value) for value in vector]

    if chunks_df.empty:
        return []

    exploded = chunks_df[["vector", "concepts"]].explode("concepts")
    concept_rows = exploded[exploded["concepts"] == concept_name]
    if concept_rows.empty:
        return []

    vectors = [
        [float(value) for value in vector]
        for vector in concept_rows["vector"].tolist()
    ]
    return average_vectors(vectors)


def find_latent_document_hits(
    db,
    chunks_df,
    ranked_concepts: list[tuple[str, float]],
    excluded_doc_ids: set[str],
    limit: int,
    concept_centroids_table=None,
) -> list[LatentDocumentHit]:
    if chunks_df.empty or not ranked_concepts or limit < 1:
        return []

    try:
        centroids_table = db.open_table("document_centroids")
    except Exception:
        return []

    candidates: dict[str, dict[str, object]] = {}

    for concept_rank, (concept_name, concept_rank_weight) in enumerate(ranked_concepts):
        concept_centroid = compute_concept_centroid(
            chunks_df,
            concept_name,
            concept_centroids_table=concept_centroids_table,
        )
        if not concept_centroid:
            continue

        search_result = centroids_table.search(concept_centroid).limit(50).to_pandas()
        if search_result.empty:
            continue

        for row in search_result.itertuples(index=False):
            doc_id = str(row.doc_id)
            if doc_id in excluded_doc_ids:
                continue

            distance = float(getattr(row, "_distance", 0.0))
            similarity_score = similarity_from_distance(distance)
            doc_score = similarity_score * float(concept_rank_weight)
            entry = candidates.setdefault(
                doc_id,
                {
                    "doc_name": str(row.doc_name),
                    "score": doc_score,
                    "supporting_concepts": [concept_name],
                },
            )
            if doc_score > entry["score"]:
                entry["score"] = doc_score
                entry["supporting_concepts"] = [concept_name]
            elif abs(doc_score - float(entry["score"])) < 1e-9 and concept_name not in entry["supporting_concepts"]:
                entry["supporting_concepts"].append(concept_name)

    hits = [
        LatentDocumentHit(
            doc_id=doc_id,
            doc_name=str(entry["doc_name"]),
            score=float(entry["score"]),
            supporting_concepts=tuple(entry["supporting_concepts"]),
        )
        for doc_id, entry in candidates.items()
    ]
    hits.sort(key=lambda hit: (-hit.score, hit.doc_name))
    return hits[:limit]


def concept_name_from_query_rows(chunks_df, concept_name: str) -> tuple[set[str], list[tuple[str, float]]]:
    if chunks_df.empty:
        return set(), []

    exploded = chunks_df[["doc_id", "concepts"]].explode("concepts")
    concept_rows = exploded[exploded["concepts"] == concept_name]
    if concept_rows.empty:
        return set(), []

    existing_doc_ids = set(concept_rows["doc_id"].astype(str))
    return existing_doc_ids, [(concept_name, 1.0)]


def get_document_chunks_for_concept(chunks_df, concept_name: str):
    if chunks_df.empty:
        return chunks_df
    exploded = chunks_df[["doc_id", "vector", "concepts"]].explode("concepts")
    return exploded[exploded["concepts"] == concept_name]
