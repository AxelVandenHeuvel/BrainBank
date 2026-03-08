import kuzu as _kuzu
import networkx as nx

from backend.db.kuzu import init_kuzu
from backend.db.lance import (
    COMMUNITY_SUMMARIES_SCHEMA,
    CONCEPT_CENTROIDS_SCHEMA,
    init_lancedb,
    replace_table_records,
)
from backend.retrieval.latent_discovery import average_vectors
from backend.services.embeddings import embed_texts
from backend.services.llm import generate_community_summary


def _normalize_concepts(value) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    return [str(item) for item in list(value)]


def _build_concept_centroid_records(chunks_df) -> list[dict]:
    if chunks_df.empty:
        return []

    concept_vectors: dict[str, list[list[float]]] = {}
    concept_docs: dict[str, set[str]] = {}

    for row in chunks_df.itertuples(index=False):
        concepts = _normalize_concepts(row.concepts)
        vector = [float(value) for value in row.vector]
        doc_id = str(row.doc_id)
        for concept in concepts:
            concept_vectors.setdefault(concept, []).append(vector)
            concept_docs.setdefault(concept, set()).add(doc_id)

    records = []
    for concept_name in sorted(concept_vectors):
        records.append(
            {
                "concept_name": concept_name,
                "centroid_vector": average_vectors(concept_vectors[concept_name]),
                "document_count": len(concept_docs.get(concept_name, set())),
            }
        )

    return records


def _load_weighted_concept_graph(conn: _kuzu.Connection) -> nx.Graph:
    graph = nx.Graph()

    nodes = conn.execute("MATCH (c:Concept) RETURN c.name")
    while nodes.has_next():
        graph.add_node(str(nodes.get_next()[0]))

    edges = conn.execute(
        "MATCH (a:Concept)-[r:RELATED_TO]->(b:Concept) "
        "RETURN a.name, b.name, COALESCE(r.weight, 1.0)"
    )
    while edges.has_next():
        source, target, weight = edges.get_next()
        graph.add_edge(str(source), str(target), weight=float(weight) if weight is not None else 1.0)

    return graph


def _build_community_records(graph: nx.Graph, chunks_df) -> list[dict]:
    if graph.number_of_nodes() == 0:
        return []

    communities = nx.algorithms.community.louvain_communities(
        graph,
        weight="weight",
        seed=0,
    )
    ordered_communities = sorted(
        (sorted(str(node) for node in community) for community in communities if community),
        key=lambda community: community[0],
    )

    records = []
    for index, member_concepts in enumerate(ordered_communities, start=1):
        community_id = f"community:{index:04d}"
        representative_evidence = _select_representative_evidence(chunks_df, member_concepts)
        summary = generate_community_summary(
            community_id,
            member_concepts,
            representative_evidence,
        )
        summary_vector = embed_texts([summary])[0]
        records.append(
            {
                "community_id": community_id,
                "member_concepts": member_concepts,
                "summary": summary,
                "summary_vector": summary_vector,
            }
        )

    return records


def _select_representative_evidence(chunks_df, member_concepts: list[str], limit: int = 5) -> list[str]:
    if chunks_df.empty:
        return []

    concept_counts = {}
    for concept in member_concepts:
        matching = chunks_df[chunks_df["concepts"].apply(lambda values: concept in _normalize_concepts(values))]
        concept_counts[concept] = len(matching)

    ranked_concepts = sorted(
        member_concepts,
        key=lambda concept: (-concept_counts.get(concept, 0), concept),
    )

    evidence: list[str] = []
    seen_texts = set()
    for concept in ranked_concepts:
        matching = chunks_df[chunks_df["concepts"].apply(lambda values: concept in _normalize_concepts(values))]
        for text in matching["text"].astype(str).tolist():
            normalized = " ".join(text.split())
            if not normalized or normalized in seen_texts:
                continue
            seen_texts.add(normalized)
            evidence.append(normalized)
            if len(evidence) == limit:
                return evidence

    return evidence


def rebuild_graphrag_artifacts(
    lance_db_path: str = "./data/lancedb",
    kuzu_db_path: str = "./data/kuzu",
    shared_kuzu_db=None,
) -> dict[str, int]:
    db, chunks_table = init_lancedb(lance_db_path)
    chunks_df = chunks_table.to_pandas()

    if shared_kuzu_db is not None:
        kuzu_db = shared_kuzu_db
        conn = _kuzu.Connection(kuzu_db)
        own_db = False
    else:
        kuzu_db, conn = init_kuzu(kuzu_db_path)
        own_db = True

    try:
        concept_centroid_records = _build_concept_centroid_records(chunks_df)
        replace_table_records(
            db,
            "concept_centroids",
            CONCEPT_CENTROIDS_SCHEMA,
            concept_centroid_records,
        )

        graph = _load_weighted_concept_graph(conn)
        community_records = _build_community_records(graph, chunks_df)
        replace_table_records(
            db,
            "community_summaries",
            COMMUNITY_SUMMARIES_SCHEMA,
            community_records,
        )

        return {
            "concept_centroids": len(concept_centroid_records),
            "communities": len(community_records),
        }
    finally:
        conn.close()
        if own_db:
            kuzu_db.close()
