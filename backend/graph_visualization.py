from dataclasses import dataclass
from itertools import combinations

import kuzu

from backend.db.kuzu import init_kuzu
from backend.db.lance import init_lancedb


@dataclass(frozen=True)
class ConceptNeighbor:
    name: str
    weight: float
    reason: str | None


def _normalize_concepts(value) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    return [str(item) for item in list(value)]


def load_concept_adjacency(conn: kuzu.Connection) -> dict[str, list[ConceptNeighbor]]:
    adjacency: dict[str, dict[str, ConceptNeighbor]] = {}

    nodes = conn.execute("MATCH (c:Concept) RETURN c.name")
    while nodes.has_next():
        concept_name = str(nodes.get_next()[0])
        adjacency.setdefault(concept_name, {})

    edges = conn.execute(
        "MATCH (a:Concept)-[r:RELATED_TO]->(b:Concept) "
        "RETURN a.name, b.name, r.reason, COALESCE(r.weight, 1.0)"
    )
    while edges.has_next():
        source_name, target_name, reason, weight = edges.get_next()
        source_name = str(source_name)
        target_name = str(target_name)
        neighbor = ConceptNeighbor(
            name=target_name,
            weight=float(weight) if weight is not None else 1.0,
            reason=str(reason) if reason is not None else None,
        )
        reverse_neighbor = ConceptNeighbor(
            name=source_name,
            weight=neighbor.weight,
            reason=neighbor.reason,
        )
        adjacency.setdefault(source_name, {})[target_name] = neighbor
        adjacency.setdefault(target_name, {})[source_name] = reverse_neighbor

    return {
        concept_name: sorted(
            neighbors.values(),
            key=lambda neighbor: (-neighbor.weight, neighbor.name),
        )
        for concept_name, neighbors in sorted(adjacency.items())
    }


def load_concept_adjacency_from_chunks(lance_db_path: str = "./data/lancedb") -> dict[str, list[ConceptNeighbor]]:
    _db, table = init_lancedb(lance_db_path)
    chunks_df = table.to_pandas()
    adjacency: dict[str, dict[str, ConceptNeighbor]] = {}

    if chunks_df.empty:
        return {}

    for row in chunks_df.itertuples(index=False):
        concepts = sorted(set(_normalize_concepts(row.concepts)))
        for concept_name in concepts:
            adjacency.setdefault(concept_name, {})

    for _doc_id, group in chunks_df.groupby("doc_id", sort=False):
        concepts = sorted(
            {
                str(concept)
                for concepts in group["concepts"].tolist()
                for concept in _normalize_concepts(concepts)
            }
        )
        for source_name, target_name in combinations(concepts, 2):
            current_weight = adjacency.setdefault(source_name, {}).get(target_name)
            weight = (current_weight.weight + 1.0) if current_weight is not None else 1.0
            neighbor = ConceptNeighbor(
                name=target_name,
                weight=weight,
                reason="shared_document",
            )
            reverse_neighbor = ConceptNeighbor(
                name=source_name,
                weight=weight,
                reason="shared_document",
            )
            adjacency[source_name][target_name] = neighbor
            adjacency.setdefault(target_name, {})[source_name] = reverse_neighbor

    return {
        concept_name: sorted(
            neighbors.values(),
            key=lambda neighbor: (-neighbor.weight, neighbor.name),
        )
        for concept_name, neighbors in sorted(adjacency.items())
    }


def format_concept_graph(
    adjacency: dict[str, list[ConceptNeighbor]],
    *,
    source_label: str | None = None,
    note: str | None = None,
) -> str:
    total_relationships = sum(len(neighbors) for neighbors in adjacency.values()) // 2
    lines = ["Concept Graph"]
    if source_label:
        lines.append(f"Source: {source_label}")
    if note:
        lines.append(f"Note: {note}")
    lines.extend(
        [
            f"Concepts: {len(adjacency)}",
            f"Relationships: {total_relationships}",
        ]
    )

    for concept_name, neighbors in adjacency.items():
        lines.append("")
        lines.append(concept_name)
        if not neighbors:
            lines.append("  (no related concepts)")
            continue

        for index, neighbor in enumerate(neighbors):
            prefix = "`- " if index == len(neighbors) - 1 else "|- "
            details = f"weight={neighbor.weight:.1f}"
            if neighbor.reason:
                details += f", reason={neighbor.reason}"
            lines.append(f"  {prefix}{neighbor.name} ({details})")

    return "\n".join(lines)


def render_concept_graph(
    kuzu_db_path: str = "./data/kuzu",
    lance_db_path: str = "./data/lancedb",
) -> str:
    try:
        kuzu_db, conn = init_kuzu(kuzu_db_path)
    except Exception as error:
        adjacency = load_concept_adjacency_from_chunks(lance_db_path)
        if adjacency:
            return format_concept_graph(
                adjacency,
                source_label="LanceDB-derived fallback",
                note=f"Kuzu unavailable: {error}",
            )
        raise RuntimeError(
            f"Failed to open Kuzu at {kuzu_db_path!r}, and no graph could be derived from LanceDB chunks at {lance_db_path!r}."
        ) from error

    try:
        return format_concept_graph(load_concept_adjacency(conn), source_label="Kuzu")
    finally:
        conn.close()
        kuzu_db.close()
