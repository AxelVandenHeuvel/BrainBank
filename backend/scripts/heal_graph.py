"""Semantic bridge healing script.

Finds concept pairs that are semantically similar (via chunk-vector centroids)
but not yet connected in the Kuzu graph, and creates RELATED_TO edges between
them labelled as SEMANTIC_BRIDGE.

Run this script while the backend server is **stopped** (Kuzu enforces an
exclusive file lock; two processes cannot open the same database simultaneously).

Usage:
    uv run python -m backend.scripts.heal_graph
"""

import numpy as np

import kuzu as _kuzu

from backend.db.kuzu import init_kuzu
from backend.db.lance import init_lancedb

SEMANTIC_BRIDGE_REASON = "High semantic similarity discovered via embeddings"
SEMANTIC_BRIDGE_TYPE = "SEMANTIC_BRIDGE"

BRIDGE_MIN_THRESHOLD = 0.60
BRIDGE_MAX_THRESHOLD = 0.90

def _compute_concept_centroids(chunks_table) -> dict[str, list[float]]:
    """Average chunk vectors per concept name."""
    df = chunks_table.to_pandas()
    if df.empty:
        return {}

    exploded = df[["concepts", "vector"]].explode("concepts").dropna(subset=["concepts"])
    centroids: dict[str, list[float]] = {}
    for concept, group in exploded.groupby("concepts"):
        arr = np.array(list(group["vector"]), dtype=float)
        centroids[str(concept)] = arr.mean(axis=0).tolist()

    return centroids


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    va = np.array(a, dtype=float)
    vb = np.array(b, dtype=float)
    norm_a = np.linalg.norm(va)
    norm_b = np.linalg.norm(vb)
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return float(np.dot(va, vb) / (norm_a * norm_b))


def _edge_exists(conn: _kuzu.Connection, a: str, b: str) -> bool:
    """Return True if any RELATED_TO edge exists between a and b (either direction)."""
    result = conn.execute(
        "MATCH (x:Concept {name: $a})-[:RELATED_TO]-(y:Concept {name: $b}) RETURN count(*)",
        parameters={"a": a, "b": b},
    )
    return result.get_next()[0] > 0


def heal_graph(
    kuzu_db_path: str = "./data/kuzu",
    lance_db_path: str = "./data/lancedb",
    k_neighbors: int = 3,
    shared_kuzu_db=None,
) -> int:
    """Add semantic bridge edges for similar but disconnected concept pairs.

    Pass ``shared_kuzu_db`` to reuse an already-open Kuzu Database (e.g. from
    tests or the live API). When omitted the function opens its own handle —
    the server must be stopped first due to Kuzu's exclusive file lock.

    Returns the number of new edges added.
    """
    if shared_kuzu_db is not None:
        own_db = False
        db = shared_kuzu_db
    else:
        db, _ = init_kuzu(kuzu_db_path)
        own_db = True

    conn = _kuzu.Connection(db)
    _, chunks_table = init_lancedb(lance_db_path)

    try:
        centroids = _compute_concept_centroids(chunks_table)
        if len(centroids) < 2:
            return 0

        concept_names = list(centroids.keys())
        bridges_added = 0

        num_concepts = len(concept_names)
        for index, concept in enumerate(concept_names, start=1):
            if index % 20 == 0 or index == 1:
                print(f"    Scanning concept {index}/{num_concepts}: '{concept}'...")
            
            centroid = centroids[concept]

            # Calculate similarities for ALL other concepts
            similarities = [
                (other, _cosine_similarity(centroid, centroids[other]))
                for other in concept_names
                if other != concept
            ]
            
            # NEW LOGIC: Filter for the "Sweet Spot" before picking top_k
            # This ensures we don't bridge things that are essentially identical 
            # and don't bridge things that are totally unrelated.
            candidates = [
                (other, sim) for other, sim in similarities 
                if BRIDGE_MIN_THRESHOLD <= sim <= BRIDGE_MAX_THRESHOLD
            ]

            top_k = sorted(candidates, key=lambda x: x[1], reverse=True)[:k_neighbors]

            for neighbor, similarity in top_k:
                # Still check if an edge exists (we don't want to double-bridge)
                if _edge_exists(conn, concept, neighbor):
                    continue

                print(f"      - Creating bridge: '{concept}' <-> '{neighbor}' (Similarity: {similarity:.4f})")
                conn.execute(
                    "MATCH (a:Concept {name: $a}), (b:Concept {name: $b}) "
                    "CREATE (a)-[:RELATED_TO {reason: $reason, weight: $weight, edge_type: $edge_type}]->(b)",
                    parameters={
                        "a": concept,
                        "b": neighbor,
                        "reason": f"{SEMANTIC_BRIDGE_REASON} (Score: {similarity:.2f})",
                        "weight": similarity,
                        "edge_type": SEMANTIC_BRIDGE_TYPE,
                    },
                )
                bridges_added += 1

        return bridges_added
    finally:
        conn.close()
        if own_db:
            db.close()


if __name__ == "__main__":
    count = heal_graph()
    print(f"Added {count} semantic bridge edge(s).")
