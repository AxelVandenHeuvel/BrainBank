import json
import logging
import math
from collections import defaultdict

import kuzu as _kuzu

from backend.db.kuzu import merge_concepts
from backend.services.embeddings import embed_texts
from backend.services.llm_providers import get_provider

CANONICAL_SIMILARITY_THRESHOLD = 0.85
UNDER_POPULATED_MIN_DOCS = 3
OVER_POPULATED_MAX_DOCS = 10
NEAREST_CONCEPT_CANDIDATES = 3

logger = logging.getLogger(__name__)


def _normalize_concepts(value) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    return [str(item) for item in list(value)]


def _dedupe_preserving_order(items: list[str]) -> list[str]:
    seen = set()
    ordered: list[str] = []
    for item in items:
        if item in seen:
            continue
        seen.add(item)
        ordered.append(item)
    return ordered


def _parse_json_response(raw_text: str) -> dict:
    text = raw_text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1]
        text = text.rsplit("```", 1)[0]
    return json.loads(text.strip())


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    mag_a = math.sqrt(sum(x * x for x in a))
    mag_b = math.sqrt(sum(y * y for y in b))
    if mag_a < 1e-9 or mag_b < 1e-9:
        return 0.0
    return dot / (mag_a * mag_b)


def _escape_lance_literal(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


class ConceptConsolidator:
    def __init__(
        self,
        chunks_table,
        concept_centroids_table,
        lance_db=None,
        similarity_threshold: float = CANONICAL_SIMILARITY_THRESHOLD,
    ) -> None:
        self.chunks_table = chunks_table
        self.concept_centroids_table = concept_centroids_table
        self.lance_db = lance_db
        self.similarity_threshold = similarity_threshold
        self.last_renamed_count = 0

    def canonicalize_concepts(self, concept_names: list[str]) -> list[str]:
        cleaned = [str(name).strip() for name in concept_names if str(name).strip()]
        if not cleaned:
            self.last_renamed_count = 0
            return []

        concept_centroids = self._load_concept_centroids()
        canonicalized: list[str] = []
        renamed_count = 0

        for concept_name in cleaned:
            mapped_name = self._map_to_canonical_name(concept_name, concept_centroids)
            canonicalized.append(mapped_name)
            if mapped_name != concept_name:
                renamed_count += 1

        self.last_renamed_count = renamed_count
        return canonicalized

    def consolidate_graph(self, conn: _kuzu.Connection) -> dict[str, int]:
        concept_centroids = self._load_concept_centroids()
        document_counts = self._concept_document_counts()

        under_populated = sorted(
            concept
            for concept, count in document_counts.items()
            if 0 < count < UNDER_POPULATED_MIN_DOCS
        )
        over_populated = sorted(
            concept
            for concept, count in document_counts.items()
            if count > OVER_POPULATED_MAX_DOCS
        )

        merged_count = 0
        for source_name in under_populated:
            nearest = self._nearest_concepts(
                source_name,
                concept_centroids,
                limit=NEAREST_CONCEPT_CANDIDATES,
            )
            if not nearest:
                continue

            target_name = self._select_merge_target_with_llm(source_name, nearest)
            if not target_name or target_name == source_name:
                continue

            self._replace_concept_in_chunk_metadata(source_name, target_name)
            merge_concepts(conn, source_name, target_name)
            merged_count += 1

        summary = {
            "merged_count": merged_count,
            "renamed_count": self.last_renamed_count,
            "under_populated_count": len(under_populated),
            "over_populated_count": len(over_populated),
        }
        logger.info(
            "Concept consolidation summary: merged=%d renamed=%d under_populated=%d over_populated=%d",
            summary["merged_count"],
            summary["renamed_count"],
            summary["under_populated_count"],
            summary["over_populated_count"],
        )
        return summary

    def _map_to_canonical_name(
        self,
        concept_name: str,
        concept_centroids: dict[str, list[float]],
    ) -> str:
        if concept_name in concept_centroids:
            return concept_name
        if not concept_centroids:
            return concept_name

        concept_vector = [float(value) for value in embed_texts([concept_name])[0]]
        best_match = concept_name
        best_similarity = -1.0

        for existing_name, existing_vector in concept_centroids.items():
            similarity = _cosine_similarity(concept_vector, existing_vector)
            if similarity > best_similarity:
                best_similarity = similarity
                best_match = existing_name

        if best_similarity >= self.similarity_threshold:
            return best_match
        return concept_name

    def _load_concept_centroids(self) -> dict[str, list[float]]:
        try:
            df = self.concept_centroids_table.to_pandas()
        except Exception:
            df = None

        if df is None or df.empty:
            return self._compute_concept_centroids_from_chunks()

        centroids: dict[str, list[float]] = {}
        for row in df.itertuples(index=False):
            concept_name = str(row.concept_name)
            centroids[concept_name] = [float(value) for value in row.centroid_vector]
        return centroids

    def _compute_concept_centroids_from_chunks(self) -> dict[str, list[float]]:
        try:
            df = self.chunks_table.to_pandas()
        except Exception:
            return {}

        if df.empty:
            return {}

        vectors_by_concept: dict[str, list[list[float]]] = defaultdict(list)
        for row in df.itertuples(index=False):
            vector = [float(value) for value in row.vector]
            for concept in _normalize_concepts(row.concepts):
                vectors_by_concept[concept].append(vector)

        centroids: dict[str, list[float]] = {}
        for concept_name, vectors in vectors_by_concept.items():
            if not vectors:
                continue
            dims = len(vectors[0])
            totals = [0.0] * dims
            for vector in vectors:
                for index, value in enumerate(vector):
                    totals[index] += value
            count = float(len(vectors))
            centroids[concept_name] = [value / count for value in totals]

        return centroids

    def _concept_document_counts(self) -> dict[str, int]:
        try:
            df = self.chunks_table.to_pandas()
        except Exception:
            return {}

        if df.empty:
            return {}

        concepts_to_docs: dict[str, set[str]] = defaultdict(set)
        for row in df.itertuples(index=False):
            doc_id = str(row.doc_id)
            for concept in set(_normalize_concepts(row.concepts)):
                concepts_to_docs[concept].add(doc_id)

        return {
            concept_name: len(doc_ids)
            for concept_name, doc_ids in concepts_to_docs.items()
        }

    def _nearest_concepts(
        self,
        concept_name: str,
        centroids: dict[str, list[float]],
        limit: int,
    ) -> list[str]:
        source_vector = centroids.get(concept_name)
        if source_vector is None:
            source_vector = self._compute_source_centroid_from_chunks(concept_name)
        if source_vector is None:
            return []

        scored: list[tuple[str, float]] = []
        for candidate_name, candidate_vector in centroids.items():
            if candidate_name == concept_name:
                continue
            similarity = _cosine_similarity(source_vector, candidate_vector)
            scored.append((candidate_name, similarity))

        scored.sort(key=lambda item: (-item[1], item[0]))
        return [name for name, _score in scored[:limit]]

    def _compute_source_centroid_from_chunks(self, concept_name: str) -> list[float] | None:
        try:
            df = self.chunks_table.to_pandas()
        except Exception:
            return None

        if df.empty:
            return None

        vectors = []
        for row in df.itertuples(index=False):
            concepts = _normalize_concepts(row.concepts)
            if concept_name not in concepts:
                continue
            vectors.append([float(value) for value in row.vector])

        if not vectors:
            return None

        dims = len(vectors[0])
        totals = [0.0] * dims
        for vector in vectors:
            for index, value in enumerate(vector):
                totals[index] += value
        count = float(len(vectors))
        return [value / count for value in totals]

    def _select_merge_target_with_llm(self, source_name: str, candidates: list[str]) -> str | None:
        prompt = (
            "You are consolidating concept names for a graph.\n"
            "Pick one broader canonical concept from the candidates if the source should be merged.\n"
            "If no merge should happen, return NONE.\n\n"
            f"Source concept: {source_name}\n"
            f"Candidates: {', '.join(candidates)}\n\n"
            "Respond ONLY as JSON with shape {\"merge_into\": \"candidate name or NONE\"}."
        )

        try:
            response_text = get_provider().generate_text(prompt)
            data = _parse_json_response(response_text)
        except Exception as error:
            logger.warning(
                "LLM merge decision failed for %r with candidates %r: %s",
                source_name,
                candidates,
                error,
            )
            return None

        target_name = str(data.get("merge_into", "")).strip()
        if not target_name or target_name.upper() == "NONE":
            return None
        if target_name not in candidates:
            return None
        return target_name

    def _replace_concept_in_chunk_metadata(self, source_name: str, target_name: str) -> int:
        if source_name == target_name:
            return 0

        try:
            df = self.chunks_table.to_pandas()
        except Exception:
            return 0

        if df.empty:
            return 0

        updated_records: list[dict] = []
        stale_chunk_ids: list[str] = []

        for row in df.itertuples(index=False):
            concepts = _normalize_concepts(row.concepts)
            if source_name not in concepts:
                continue

            updated_concepts = _dedupe_preserving_order(
                [target_name if concept == source_name else concept for concept in concepts]
            )
            stale_chunk_ids.append(str(row.chunk_id))
            updated_records.append(
                {
                    "chunk_id": str(row.chunk_id),
                    "doc_id": str(row.doc_id),
                    "doc_name": str(row.doc_name),
                    "text": str(row.text),
                    "concepts": updated_concepts,
                    "vector": [float(value) for value in row.vector],
                }
            )

        for chunk_id in stale_chunk_ids:
            escaped_chunk_id = _escape_lance_literal(chunk_id)
            self.chunks_table.delete(f'chunk_id = "{escaped_chunk_id}"')

        if updated_records:
            self.chunks_table.add(updated_records)

        return len(updated_records)
