import json
import logging
import math
from collections import defaultdict

import kuzu as _kuzu

from backend.db.kuzu import merge_concepts
from backend.services.embeddings import embed_texts
from backend.services.llm import generate_text_with_backoff

CANONICAL_SIMILARITY_THRESHOLD = 0.85
UNDER_POPULATED_MIN_DOCS = 3
OVER_POPULATED_MAX_DOCS = 10
NEAREST_CONCEPT_CANDIDATES = 3
AUTO_MERGE_SIMILARITY_THRESHOLD = 0.92
LLM_DECISION_MIN_SIMILARITY = 0.75
LLM_BATCH_SIZE = 5
FORCED_ORPHAN_NEAREST_CANDIDATES = 5
ISLAND_NEAREST_CANDIDATES = 5
FORCED_ORPHAN_GEMINI_MODEL = "gemini-3.1-flash-lite-preview"

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


def _replace_concept_in_chunks(chunks_table, source_name: str, target_name: str) -> int:
    """Replace source_name with target_name in every chunk's concepts array.

    Uses LanceDB's native ``update`` with ``array_replace`` so that the
    operation is atomic and does not depend on chunk_id string-escaping.
    Returns the number of rows updated.
    """
    if source_name == target_name:
        return 0

    escaped_source = source_name.replace("'", "''")
    escaped_target = target_name.replace("'", "''")

    try:
        result = chunks_table.update(
            where=f"list_contains(concepts, '{escaped_source}')",
            values_sql={"concepts": f"array_replace(concepts, '{escaped_source}', '{escaped_target}')"},
        )
        return result.rows_updated
    except Exception:
        return 0


def _batched(items: list[dict], size: int) -> list[list[dict]]:
    return [items[index:index + size] for index in range(0, len(items), size)]


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
        concept_frequencies = self._concept_frequency_hints(document_counts)

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
        auto_merged_count = 0
        llm_merged_count = 0
        skipped_low_similarity_count = 0
        llm_candidates: list[dict] = []

        for source_name in under_populated:
            nearest = self._nearest_concepts_with_scores(
                source_name,
                concept_centroids,
                limit=NEAREST_CONCEPT_CANDIDATES,
            )
            broader_candidates = [
                (target_name, similarity)
                for target_name, similarity in nearest
                if concept_frequencies.get(target_name, 0) >= UNDER_POPULATED_MIN_DOCS
            ]
            if not broader_candidates:
                continue

            top_target, top_similarity = broader_candidates[0]
            if top_similarity > AUTO_MERGE_SIMILARITY_THRESHOLD:
                print(f"    Auto-merging '{source_name}' -> '{top_target}' (similarity: {top_similarity:.4f})")
                if self._apply_merge(conn, source_name, top_target):
                    merged_count += 1
                    auto_merged_count += 1
                continue

            if top_similarity < LLM_DECISION_MIN_SIMILARITY:
                skipped_low_similarity_count += 1
                continue

            llm_candidates.append(
                {
                    "source": source_name,
                    "candidates": broader_candidates,
                }
            )

        if llm_candidates:
            print(f"    Evaluating {len(llm_candidates)} fuzzy merges via LLM...")

        for batch_index, batch in enumerate(_batched(llm_candidates, LLM_BATCH_SIZE), start=1):
            print(f"      Batch {batch_index} ({len(batch)} items)...")
            decisions = self._decide_merges_batch(batch)
            for candidate in batch:
                source_name = candidate["source"]
                target_name = decisions.get(source_name)
                if not target_name:
                    continue
                print(f"      - Merging '{source_name}' -> '{target_name}' (LLM decision)")
                if self._apply_merge(conn, source_name, target_name):
                    merged_count += 1
                    llm_merged_count += 1

        summary = {
            "merged_count": merged_count,
            "renamed_count": self.last_renamed_count,
            "under_populated_count": len(under_populated),
            "over_populated_count": len(over_populated),
            "auto_merged_count": auto_merged_count,
            "llm_merged_count": llm_merged_count,
            "skipped_low_similarity_count": skipped_low_similarity_count,
            "llm_candidate_count": len(llm_candidates),
        }
        logger.info(
            "Concept consolidation summary: merged=%d renamed=%d under_populated=%d over_populated=%d auto=%d llm=%d skipped_low=%d llm_candidates=%d",
            summary["merged_count"],
            summary["renamed_count"],
            summary["under_populated_count"],
            summary["over_populated_count"],
            summary["auto_merged_count"],
            summary["llm_merged_count"],
            summary["skipped_low_similarity_count"],
            summary["llm_candidate_count"],
        )
        return summary

    def force_consolidate_orphans(self, conn: _kuzu.Connection) -> dict[str, int]:
        concept_centroids = self._load_concept_centroids()
        document_counts = self._concept_document_counts()
        orphans = sorted(
            concept_name
            for concept_name, count in document_counts.items()
            if 0 < count < UNDER_POPULATED_MIN_DOCS
        )

        forced_merges = 0
        llm_calls = 0

        print(f"    Processing {len(orphans)} orphans for forced consolidation...")
        for index, orphan_name in enumerate(orphans, start=1):
            if index % 5 == 0 or index == 1:
                print(f"      Orphan {index}/{len(orphans)}: '{orphan_name}'...")
                
            nearest = self._nearest_concepts_with_scores(
                orphan_name,
                concept_centroids,
                limit=FORCED_ORPHAN_NEAREST_CANDIDATES,
            )
            candidates = [name for name, _score in nearest][:FORCED_ORPHAN_NEAREST_CANDIDATES]
            if not candidates:
                continue

            llm_calls += 1
            chosen_parent = self._decide_forced_orphan_parent(orphan_name, candidates)
            if not chosen_parent:
                chosen_parent = candidates[0]

            if self._apply_merge(conn, orphan_name, chosen_parent):
                forced_merges += 1

        summary = {
            "orphans_seen": len(orphans),
            "llm_calls": llm_calls,
            "forced_merges": forced_merges,
        }
        logger.info(
            "Forced orphan consolidation summary: orphans_seen=%d llm_calls=%d forced_merges=%d",
            summary["orphans_seen"],
            summary["llm_calls"],
            summary["forced_merges"],
        )
        return summary

    def force_consolidate_islands(self, conn: _kuzu.Connection) -> dict[str, int]:
        """Merge concepts with zero edges into their nearest semantic neighbor."""
        concept_centroids = self._load_concept_centroids()

        result = conn.execute(
            "MATCH (c:Concept) WHERE NOT (c)-[]-() RETURN c.name"
        )
        islands: list[str] = []
        while result.has_next():
            islands.append(result.get_next()[0])
        islands.sort()

        forced_merges = 0
        llm_calls = 0

        print(f"    Processing {len(islands)} island nodes for consolidation...")
        for index, island_name in enumerate(islands, start=1):
            if index % 5 == 0 or index == 1:
                print(f"      Island {index}/{len(islands)}: '{island_name}'...")

            nearest = self._nearest_concepts_with_scores(
                island_name,
                concept_centroids,
                limit=ISLAND_NEAREST_CANDIDATES,
            )
            candidates = [name for name, _score in nearest][:ISLAND_NEAREST_CANDIDATES]
            if not candidates:
                continue

            llm_calls += 1
            chosen_target = self._decide_island_merge(island_name, candidates)
            if not chosen_target:
                continue

            if self._apply_merge(conn, island_name, chosen_target):
                forced_merges += 1

        summary = {
            "islands_seen": len(islands),
            "llm_calls": llm_calls,
            "forced_merges": forced_merges,
        }
        logger.info(
            "Island consolidation summary: islands_seen=%d llm_calls=%d forced_merges=%d",
            summary["islands_seen"],
            summary["llm_calls"],
            summary["forced_merges"],
        )
        return summary

    def _build_island_merge_prompt(self, island_name: str, candidates: list[str]) -> str:
        candidates_str = ", ".join([f"'{c}'" for c in candidates])
        return (
            f"The concept '{island_name}' is disconnected from the knowledge graph (zero edges).\n"
            f"Does it logically belong merged into one of these {len(candidates)} candidate hubs: [{candidates_str}]?\n"
            f"Reply ONLY with the chosen name, or 'NONE' if it should remain an isolated topic "
            f"(e.g., a completely unique journal entry).\n"
            f"Chosen Name:"
        )

    def _decide_island_merge(self, island_name: str, candidates: list[str]) -> str | None:
        prompt = self._build_island_merge_prompt(island_name, candidates)
        try:
            response = generate_text_with_backoff(
                prompt,
                provider_name="gemini",
                gemini_model=FORCED_ORPHAN_GEMINI_MODEL,
            )
        except Exception as error:
            logger.warning(
                "Island merge decision failed for %s: %s",
                island_name,
                error,
            )
            return None

        response_name = response.strip().strip('"').strip("'")
        if not response_name or response_name.upper() == "NONE":
            return None

        by_lower = {candidate.lower(): candidate for candidate in candidates}
        return by_lower.get(response_name.lower())

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

    def _concept_frequency_hints(self, fallback_counts: dict[str, int]) -> dict[str, int]:
        try:
            df = self.concept_centroids_table.to_pandas()
        except Exception:
            return dict(fallback_counts)

        if df.empty or "document_count" not in df.columns:
            return dict(fallback_counts)

        frequencies: dict[str, int] = dict(fallback_counts)
        for row in df.itertuples(index=False):
            concept_name = str(row.concept_name)
            frequencies[concept_name] = int(row.document_count)
        return frequencies

    def _nearest_concepts_with_scores(
        self,
        concept_name: str,
        centroids: dict[str, list[float]],
        limit: int,
    ) -> list[tuple[str, float]]:
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
        return scored[:limit]

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

    def _build_batch_merge_prompt(self, candidates: list[dict]) -> str:
        candidate_payload = []
        for candidate in candidates:
            candidate_payload.append(
                {
                    "source": candidate["source"],
                    "candidates": [
                        {
                            "name": target_name,
                            "similarity": round(float(similarity), 4),
                        }
                        for target_name, similarity in candidate["candidates"]
                    ],
                }
            )

        return (
            "You are consolidating graph concepts.\n"
            "For each source concept, decide one action: MERGE into one of the candidate names, or KEEP_NEW.\n"
            "Here are potential merges:\n"
            f"{json.dumps(candidate_payload)}\n\n"
            "Respond ONLY with JSON in this exact shape:\n"
            "{\"decisions\":[{\"source\":\"...\",\"action\":\"MERGE|KEEP_NEW\",\"merge_into\":\"candidate or NONE\"}]}"
        )

    def _build_force_orphan_prompt(self, orphan_name: str, candidates: list[str]) -> str:
        candidates_str = ", ".join([f"'{c}'" for c in candidates])
        return (
            f"You are a knowledge graph consolidation engine.\n"
            f"The concept '{orphan_name}' is under-represented and must be absorbed.\n"
            f"You MUST merge it into one of these {len(candidates)} candidates: [{candidates_str}].\n"
            f"DO NOT explain your choice. Respond with only the chosen candidate name.\n"
            f"If multiple candidates fit, prefer the most semantically fundamental one.\n"
            f"Chosen Candidate Name:"
        )

    def _decide_forced_orphan_parent(self, orphan_name: str, candidates: list[str]) -> str | None:
        prompt = self._build_force_orphan_prompt(orphan_name, candidates)
        try:
            response = generate_text_with_backoff(
                prompt,
                provider_name="gemini",
                gemini_model=FORCED_ORPHAN_GEMINI_MODEL,
            )
        except Exception as error:
            logger.warning(
                "Forced orphan merge decision failed for %s: %s",
                orphan_name,
                error,
            )
            return None

        response_name = response.strip().strip('"').strip("'")
        if not response_name:
            return None

        by_lower = {candidate.lower(): candidate for candidate in candidates}
        return by_lower.get(response_name.lower())

    def _decide_merges_batch(self, candidates: list[dict]) -> dict[str, str]:
        if not candidates:
            return {}

        prompt = self._build_batch_merge_prompt(candidates)

        try:
            response_text = generate_text_with_backoff(prompt)
            data = _parse_json_response(response_text)
        except Exception as error:
            logger.warning("LLM batch merge decision failed: %s", error)
            return {}

        allowed_targets: dict[str, set[str]] = {
            candidate["source"]: {name for name, _score in candidate["candidates"]}
            for candidate in candidates
        }

        decisions: dict[str, str] = {}
        for decision in data.get("decisions", []):
            source_name = str(decision.get("source", "")).strip()
            action = str(decision.get("action", "")).strip().upper()
            target_name = str(decision.get("merge_into", "")).strip()

            if source_name not in allowed_targets:
                continue
            if action != "MERGE":
                continue
            if target_name not in allowed_targets[source_name]:
                continue

            decisions[source_name] = target_name

        return decisions

    def _apply_merge(self, conn: _kuzu.Connection, source_name: str, target_name: str) -> bool:
        if not source_name or not target_name or source_name == target_name:
            return False

        _replace_concept_in_chunks(self.chunks_table, source_name, target_name)
        merge_concepts(conn, source_name, target_name)
        return True

