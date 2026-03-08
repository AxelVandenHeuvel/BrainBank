from backend.db.kuzu import init_kuzu
from backend.retrieval.traversal import build_traversal_plan
from backend.retrieval.types import (
    LocalSearchResult,
    RetrievalConfig,
    SourceConceptHit,
    WeightedDiscoveryConcept,
)


def _seed_concepts(conn, names: list[str]) -> None:
    for name in names:
        conn.execute("MERGE (c:Concept {name: $name})", parameters={"name": name})


def _connect(conn, left: str, right: str) -> None:
    conn.execute(
        "MATCH (a:Concept {name: $left}), (b:Concept {name: $right}) "
        "CREATE (a)-[:RELATED_TO {reason: 'shared_document', weight: 1.0}]->(b)",
        parameters={"left": left, "right": right},
    )


def _search_result(
    source_names: list[str],
    discovery_names: list[str],
) -> LocalSearchResult:
    return LocalSearchResult(
        seed_chunks=(),
        source_concepts=tuple(
            SourceConceptHit(
                name=name,
                score=float(len(source_names) - index),
                matched_chunk_ids=(),
            )
            for index, name in enumerate(source_names)
        ),
        discovery_concepts=tuple(
            WeightedDiscoveryConcept(
                name=name,
                score=1.0,
                min_hop=index + 1,
                supporting_seed_concepts=(source_names[0],) if source_names else (),
            )
            for index, name in enumerate(discovery_names)
        ),
        latent_documents=(),
        discovery_chunks=(),
    )


class TestBuildTraversalPlan:
    def test_returns_root_first_bfs_steps_with_fixed_decay_and_delay(self, kuzu_path):
        kuzu_db, conn = init_kuzu(kuzu_path)
        _seed_concepts(conn, ["Calculus", "Derivatives", "Integrals"])
        _connect(conn, "Calculus", "Derivatives")
        _connect(conn, "Calculus", "Integrals")

        plan = build_traversal_plan(
            conn,
            _search_result(["Calculus"], ["Derivatives", "Integrals"]),
            RetrievalConfig(max_graph_hops=2),
        )

        assert plan is not None
        assert plan.root_node_id == "concept:Calculus"
        assert plan.step_interval_ms == 160
        assert plan.pulse_duration_ms == 320
        assert plan.brightness_decay == 0.65
        assert plan.brightness_threshold == 0.25
        assert [
            (step.node_id, step.hop, step.brightness, step.delay_ms)
            for step in plan.steps
        ] == [
            ("concept:Calculus", 0, 1.0, 0),
            ("concept:Derivatives", 1, 0.65, 160),
            ("concept:Integrals", 1, 0.65, 320),
        ]

        conn.close()
        kuzu_db.close()

    def test_stops_at_max_graph_hops(self, kuzu_path):
        kuzu_db, conn = init_kuzu(kuzu_path)
        _seed_concepts(conn, ["Calculus", "Derivatives", "Chain Rule"])
        _connect(conn, "Calculus", "Derivatives")
        _connect(conn, "Derivatives", "Chain Rule")

        plan = build_traversal_plan(
            conn,
            _search_result(["Calculus"], ["Derivatives", "Chain Rule"]),
            RetrievalConfig(max_graph_hops=1),
        )

        assert plan is not None
        assert [step.node_id for step in plan.steps] == [
            "concept:Calculus",
            "concept:Derivatives",
        ]

        conn.close()
        kuzu_db.close()

    def test_drops_steps_below_brightness_threshold(self, kuzu_path):
        kuzu_db, conn = init_kuzu(kuzu_path)
        _seed_concepts(conn, ["A", "B", "C", "D", "E"])
        _connect(conn, "A", "B")
        _connect(conn, "B", "C")
        _connect(conn, "C", "D")
        _connect(conn, "D", "E")

        plan = build_traversal_plan(
            conn,
            _search_result(["A"], ["B", "C", "D", "E"]),
            RetrievalConfig(max_graph_hops=5),
        )

        assert plan is not None
        assert [step.node_id for step in plan.steps] == [
            "concept:A",
            "concept:B",
            "concept:C",
            "concept:D",
        ]
        assert plan.steps[-1].hop == 3
        assert plan.steps[-1].brightness > plan.brightness_threshold

        conn.close()
        kuzu_db.close()

    def test_returns_none_when_no_source_concepts_exist(self, kuzu_path):
        kuzu_db, conn = init_kuzu(kuzu_path)

        plan = build_traversal_plan(
            conn,
            _search_result([], ["Derivatives"]),
            RetrievalConfig(max_graph_hops=2),
        )

        assert plan is None

        conn.close()
        kuzu_db.close()
