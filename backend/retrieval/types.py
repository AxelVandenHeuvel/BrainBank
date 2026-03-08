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
