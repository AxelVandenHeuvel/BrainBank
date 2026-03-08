import logging
import uuid
from itertools import combinations

import kuzu as _kuzu

from backend.db.kuzu import init_kuzu
from backend.db.lance import init_lancedb
from backend.ingestion.chunker import semantic_chunk_text as chunk_text
from backend.ingestion.consolidator import ConceptConsolidator
from backend.services.embeddings import (
    calculate_color_score,
    calculate_document_centroid,
    embed_texts,
)
from backend.services.llm import extract_concepts


SHARED_DOCUMENT_REASON = "shared_document"

logger = logging.getLogger(__name__)


def _dedupe_preserving_order(items: list[str]) -> list[str]:
    seen = set()
    ordered = []
    for item in items:
        if item in seen:
            continue
        seen.add(item)
        ordered.append(item)
    return ordered


def _get_existing_concept_hints(concept_centroids_table, limit: int = 50) -> list[str]:
    try:
        df = concept_centroids_table.to_pandas()
    except Exception:
        return []

    if df.empty:
        return []

    ranked = df.sort_values(
        by=["document_count", "concept_name"],
        ascending=[False, True],
    )
    hints: list[str] = []
    for name in ranked["concept_name"].tolist()[:limit]:
        normalized = str(name).strip()
        if normalized:
            hints.append(normalized)
    return hints


def ingest_markdown(
    text: str,
    doc_name: str,
    lance_db_path: str = "./data/lancedb",
    kuzu_db_path: str = "./data/kuzu",
    shared_kuzu_db=None,
    doc_id: str | None = None,
) -> dict:
    db, table = init_lancedb(lance_db_path)
    document_centroids_table = db.open_table("document_centroids")
    concept_centroids_table = db.open_table("concept_centroids")

    # When the backend is running, the caller passes the module-level Database
    # object so we reuse it instead of opening a second one (which would fail
    # with a lock conflict). Tests pass shared_kuzu_db=None and supply their
    # own kuzu_db_path temp directory.
    if shared_kuzu_db is not None:
        kuzu_db = shared_kuzu_db
        conn = _kuzu.Connection(kuzu_db)
        own_db = False
    else:
        kuzu_db, conn = init_kuzu(kuzu_db_path)
        own_db = True

    consolidator = ConceptConsolidator(
        chunks_table=table,
        concept_centroids_table=concept_centroids_table,
        lance_db=db,
    )

    try:
        if doc_id is None:
            doc_id = str(uuid.uuid4())

        chunks = chunk_text(text)
        chunk_ids = [str(uuid.uuid4()) for _ in chunks]
        vectors = embed_texts(chunks)

        concept_hints = _get_existing_concept_hints(concept_centroids_table)

        # Extract concepts via LLM (graceful fallback: note saves even if LLM is unavailable)
        raw_concepts: list[str] = []
        try:
            extraction = extract_concepts(
                text,
                doc_name,
                existing_concepts=concept_hints,
            )
            raw_concepts = [str(concept).strip() for concept in extraction.get("concepts", []) if str(concept).strip()]
        except Exception:
            raw_concepts = []

        canonicalized = consolidator.canonicalize_concepts(raw_concepts)
        concepts = _dedupe_preserving_order(canonicalized)
        canonical_pairs = list(zip(raw_concepts, canonicalized, strict=False))

        # Determine which concepts each chunk mentions.
        def chunk_concepts(chunk_text_: str) -> list[str]:
            lowered = chunk_text_.lower()
            matched: list[str] = []
            for raw_concept, canonical_concept in canonical_pairs:
                raw_lower = raw_concept.lower()
                canonical_lower = canonical_concept.lower()
                if raw_lower in lowered or canonical_lower in lowered:
                    matched.append(canonical_concept)

            unique_matches = _dedupe_preserving_order(matched)
            return unique_matches if unique_matches else concepts

        # Store chunks in LanceDB with doc_name and per-chunk concept tags.
        # This is the sole source of the document<->concept link.
        records = [
            {
                "chunk_id": chunk_id,
                "doc_id": doc_id,
                "doc_name": doc_name,
                "text": chunk_text_value,
                "concepts": chunk_concepts(chunk_text_value),
                "vector": vector,
            }
            for chunk_id, chunk_text_value, vector in zip(chunk_ids, chunks, vectors, strict=False)
        ]
        table.add(records)

        centroid_vector = calculate_document_centroid(doc_id, table)
        document_centroids_table.add(
            [
                {
                    "doc_id": doc_id,
                    "doc_name": doc_name,
                    "centroid_vector": centroid_vector,
                }
            ]
        )

        unique_concepts = sorted(set(concepts))

        # Upsert Concept nodes in Kuzu with semantic color score.
        for concept in unique_concepts:
            score = calculate_color_score(concept)
            conn.execute(
                "MERGE (c:Concept {name: $name})",
                parameters={"name": concept},
            )
            conn.execute(
                "MATCH (c:Concept {name: $name}) SET c.colorScore = $score",
                parameters={"name": concept, "score": score},
            )

        # Shared-document weighting: increment RELATED_TO for each concept pair.
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

        consolidation_summary = consolidator.consolidate_graph(conn)
        logger.info(
            "Concept consolidation during ingest for %r: renamed=%d merged=%d",
            doc_name,
            consolidation_summary.get("renamed_count", 0),
            consolidation_summary.get("merged_count", 0),
        )

        return {"doc_id": doc_id, "chunks": len(chunks), "concepts": concepts}
    finally:
        conn.close()
        if own_db:
            kuzu_db.close()
