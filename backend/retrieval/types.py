from dataclasses import dataclass
from enum import Enum


@dataclass(frozen=True)
class RetrievalConfig:
    seed_chunk_limit: int = 5
    source_concept_limit: int = 5
    max_graph_hops: int = 2
    max_discovery_concepts: int = 15
    latent_doc_limit: int = 5
    latent_doc_chunk_limit: int = 2
    max_context_words: int = 1800
    concept_seed_limit: int = 5
    community_seed_limit: int = 5
    global_source_concept_limit: int = 10


class QueryRoute(str, Enum):
    LOCAL = "LOCAL"
    GLOBAL = "GLOBAL"


@dataclass(frozen=True)
class ChunkHit:
    chunk_id: str
    doc_id: str
    doc_name: str
    text: str
    concepts: tuple[str, ...]
    rank: int
    score: float | None = None
    vector: tuple[float, ...] | None = None


@dataclass(frozen=True)
class SourceConceptHit:
    name: str
    score: float
    matched_chunk_ids: tuple[str, ...]


@dataclass(frozen=True)
class WeightedDiscoveryConcept:
    name: str
    score: float
    min_hop: int
    supporting_seed_concepts: tuple[str, ...]


@dataclass(frozen=True)
class LatentDocumentHit:
    doc_id: str
    doc_name: str
    score: float
    supporting_concepts: tuple[str, ...]


@dataclass(frozen=True)
class GlobalCommunityHit:
    community_id: str
    score: float
    member_concepts: tuple[str, ...]
    summary: str


@dataclass(frozen=True)
class LocalSearchResult:
    seed_chunks: tuple[ChunkHit, ...]
    source_concepts: tuple[SourceConceptHit, ...]
    discovery_concepts: tuple[WeightedDiscoveryConcept, ...]
    latent_documents: tuple[LatentDocumentHit, ...]
    discovery_chunks: tuple[ChunkHit, ...]


@dataclass(frozen=True)
class GlobalSearchResult:
    answer: str
    community_hits: tuple[GlobalCommunityHit, ...]
    source_concepts: tuple[str, ...]
    discovery_concepts: tuple[str, ...] = ()


@dataclass(frozen=True)
class DocumentCitation:
    doc_id: str
    name: str


@dataclass(frozen=True)
class ChunkCitation:
    chunk_id: str
    doc_id: str
    doc_name: str
    text: str


@dataclass(frozen=True)
class RelationshipCitation:
    source: str
    target: str
    type: str
    reason: str | None = None


@dataclass(frozen=True)
class TraversalStep:
    node_id: str
    concept: str
    hop: int
    brightness: float
    delay_ms: int

    def to_response(self) -> dict:
        return {
            "node_id": self.node_id,
            "concept": self.concept,
            "hop": self.hop,
            "brightness": self.brightness,
            "delay_ms": self.delay_ms,
        }


@dataclass(frozen=True)
class TraversalPlan:
    root_node_id: str
    step_interval_ms: int
    pulse_duration_ms: int
    brightness_decay: float
    brightness_threshold: float
    steps: tuple[TraversalStep, ...]

    def to_response(self) -> dict:
        return {
            "root_node_id": self.root_node_id,
            "step_interval_ms": self.step_interval_ms,
            "pulse_duration_ms": self.pulse_duration_ms,
            "brightness_decay": self.brightness_decay,
            "brightness_threshold": self.brightness_threshold,
            "steps": [step.to_response() for step in self.steps],
        }


@dataclass(frozen=True)
class QueryResult:
    answer: str
    source_concepts: tuple[str, ...]
    discovery_concepts: tuple[str, ...]
    source_documents: tuple[DocumentCitation, ...] = ()
    discovery_documents: tuple[DocumentCitation, ...] = ()
    source_chunks: tuple[ChunkCitation, ...] = ()
    discovery_chunks: tuple[ChunkCitation, ...] = ()
    supporting_relationships: tuple[RelationshipCitation, ...] = ()

    def to_response(self) -> dict:
        return {
            "answer": self.answer,
            "source_concepts": list(self.source_concepts),
            "discovery_concepts": list(self.discovery_concepts),
            "source_documents": [
                {"doc_id": doc.doc_id, "name": doc.name} for doc in self.source_documents
            ],
            "discovery_documents": [
                {"doc_id": doc.doc_id, "name": doc.name} for doc in self.discovery_documents
            ],
            "source_chunks": [
                {
                    "chunk_id": chunk.chunk_id,
                    "doc_id": chunk.doc_id,
                    "doc_name": chunk.doc_name,
                    "text": chunk.text,
                }
                for chunk in self.source_chunks
            ],
            "discovery_chunks": [
                {
                    "chunk_id": chunk.chunk_id,
                    "doc_id": chunk.doc_id,
                    "doc_name": chunk.doc_name,
                    "text": chunk.text,
                }
                for chunk in self.discovery_chunks
            ],
            "supporting_relationships": [
                {
                    "source": relationship.source,
                    "target": relationship.target,
                    "type": relationship.type,
                    "reason": relationship.reason,
                }
                for relationship in self.supporting_relationships
            ],
        }


@dataclass(frozen=True)
class LocalQueryPreparation:
    user_query: str
    source_concepts: tuple[str, ...]
    discovery_concepts: tuple[str, ...]
    context: str
    traversal_plan: TraversalPlan | None
    source_documents: tuple[DocumentCitation, ...] = ()
    discovery_documents: tuple[DocumentCitation, ...] = ()
    source_chunks: tuple[ChunkCitation, ...] = ()
    discovery_chunks: tuple[ChunkCitation, ...] = ()
    supporting_relationships: tuple[RelationshipCitation, ...] = ()
    immediate_response: QueryResult | None = None

    def to_answer_response(self, answer: str | None = None) -> dict:
        if self.immediate_response is not None:
            return self.immediate_response.to_response()

        if answer is None:
            raise ValueError("answer is required when no immediate_response is present")

        return QueryResult(
            answer=answer,
            source_concepts=self.source_concepts,
            discovery_concepts=self.discovery_concepts,
            source_documents=self.source_documents,
            discovery_documents=self.discovery_documents,
            source_chunks=self.source_chunks,
            discovery_chunks=self.discovery_chunks,
            supporting_relationships=self.supporting_relationships,
        ).to_response()


@dataclass(frozen=True)
class QueryPreparation:
    route: QueryRoute
    requires_direct_query: bool
    source_concepts: tuple[str, ...] = ()
    discovery_concepts: tuple[str, ...] = ()
    traversal_plan: TraversalPlan | None = None
    prepared_local_query: LocalQueryPreparation | None = None

    def to_prepare_response(self, prepared_query_id: str | None = None) -> dict:
        return {
            "route": self.route.value,
            "requires_direct_query": self.requires_direct_query,
            "prepared_query_id": prepared_query_id,
            "source_concepts": list(self.source_concepts),
            "discovery_concepts": list(self.discovery_concepts),
            "traversal_plan": None if self.traversal_plan is None else self.traversal_plan.to_response(),
        }
