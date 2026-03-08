from dataclasses import dataclass


@dataclass(frozen=True)
class RetrievalConfig:
    seed_chunk_limit: int = 5
    max_graph_hops: int = 1
    max_discovery_concepts: int = 15
    max_discovery_chunks: int = 10
    max_context_words: int = 1800


@dataclass(frozen=True)
class ChunkHit:
    chunk_id: str
    doc_id: str
    doc_name: str
    text: str
    concepts: tuple[str, ...]
    rank: int


@dataclass(frozen=True)
class DiscoveredConcept:
    name: str
    min_hop: int
    supporting_seed_concepts: tuple[str, ...]


@dataclass(frozen=True)
class LocalSearchResult:
    seed_chunks: tuple[ChunkHit, ...]
    source_concepts: tuple[str, ...]
    discovery_concepts: tuple[DiscoveredConcept, ...]
    discovery_chunks: tuple[ChunkHit, ...]


@dataclass(frozen=True)
class QueryResult:
    answer: str
    source_concepts: tuple[str, ...]
    discovery_concepts: tuple[str, ...]

    def to_response(self) -> dict:
        return {
            "answer": self.answer,
            "source_concepts": list(self.source_concepts),
            "discovery_concepts": list(self.discovery_concepts),
        }
