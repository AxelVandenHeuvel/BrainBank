from collections import deque

import kuzu

from backend.retrieval.types import (
    LocalSearchResult,
    RetrievalConfig,
    TraversalPlan,
    TraversalStep,
)

STEP_INTERVAL_MS = 160
PULSE_DURATION_MS = 320
BRIGHTNESS_DECAY = 0.65
BRIGHTNESS_THRESHOLD = 0.25


def _concept_node_id(concept_name: str) -> str:
    return f"concept:{concept_name}"


def _load_related_neighbors(
    conn: kuzu.Connection,
    concept_name: str,
    eligible_concepts: set[str],
) -> list[str]:
    result = conn.execute(
        "MATCH (c:Concept {name: $name})-[r:RELATED_TO]-(neighbor:Concept) "
        "RETURN neighbor.name",
        parameters={"name": concept_name},
    )

    neighbors: set[str] = set()
    while result.has_next():
        neighbor_name = str(result.get_next()[0])
        if neighbor_name in eligible_concepts:
            neighbors.add(neighbor_name)

    return sorted(neighbors)


def build_traversal_plan(
    conn: kuzu.Connection,
    search_result: LocalSearchResult,
    config: RetrievalConfig,
) -> TraversalPlan | None:
    if not search_result.source_concepts:
        return None

    root_concept = search_result.source_concepts[0].name
    eligible_concepts = {
        *[hit.name for hit in search_result.source_concepts],
        *[hit.name for hit in search_result.discovery_concepts],
    }
    if root_concept not in eligible_concepts:
        return None

    steps: list[TraversalStep] = []
    frontier = deque([(root_concept, 0)])
    visited = {root_concept}

    while frontier:
        concept_name, hop = frontier.popleft()
        brightness = BRIGHTNESS_DECAY ** hop
        if hop > config.max_graph_hops or brightness < BRIGHTNESS_THRESHOLD:
            continue

        steps.append(
            TraversalStep(
                node_id=_concept_node_id(concept_name),
                concept=concept_name,
                hop=hop,
                brightness=round(brightness, 6),
                delay_ms=(len(steps)) * STEP_INTERVAL_MS,
            )
        )

        if hop >= config.max_graph_hops:
            continue

        next_hop = hop + 1
        if BRIGHTNESS_DECAY ** next_hop < BRIGHTNESS_THRESHOLD:
            continue

        for neighbor_name in _load_related_neighbors(conn, concept_name, eligible_concepts):
            if neighbor_name in visited:
                continue
            visited.add(neighbor_name)
            frontier.append((neighbor_name, next_hop))

    if not steps:
        return None

    return TraversalPlan(
        root_node_id=_concept_node_id(root_concept),
        step_interval_ms=STEP_INTERVAL_MS,
        pulse_duration_ms=PULSE_DURATION_MS,
        brightness_decay=BRIGHTNESS_DECAY,
        brightness_threshold=BRIGHTNESS_THRESHOLD,
        steps=tuple(steps),
    )
