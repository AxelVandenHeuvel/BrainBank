import subprocess
import sys
from pathlib import Path

from backend.db.kuzu import init_kuzu
from backend.db.lance import init_lancedb
from backend.graph_visualization import (
    format_concept_graph,
    load_concept_adjacency,
    load_concept_adjacency_from_chunks,
    render_concept_graph,
)


class TestLoadConceptAdjacency:
    def test_builds_bidirectional_adjacency_from_related_to_edges(self, kuzu_path):
        kuzu_db, conn = init_kuzu(kuzu_path)
        conn.execute("MERGE (c:Concept {name: 'Calculus'})")
        conn.execute("MERGE (c:Concept {name: 'Derivatives'})")
        conn.execute("MERGE (c:Concept {name: 'Limits'})")
        conn.execute(
            "MATCH (a:Concept {name: 'Calculus'}), (b:Concept {name: 'Derivatives'}) "
            "CREATE (a)-[:RELATED_TO {reason: 'shared_document', weight: 2.0}]->(b)"
        )
        conn.execute(
            "MATCH (a:Concept {name: 'Calculus'}), (b:Concept {name: 'Limits'}) "
            "CREATE (a)-[:RELATED_TO {reason: 'shared_document', weight: 1.0}]->(b)"
        )

        adjacency = load_concept_adjacency(conn)

        assert [neighbor.name for neighbor in adjacency["Calculus"]] == [
            "Derivatives",
            "Limits",
        ]
        assert [neighbor.name for neighbor in adjacency["Derivatives"]] == ["Calculus"]
        assert [neighbor.name for neighbor in adjacency["Limits"]] == ["Calculus"]
        assert adjacency["Calculus"][0].weight == 2.0

        conn.close()
        kuzu_db.close()

    def test_includes_isolated_concepts(self, kuzu_path):
        kuzu_db, conn = init_kuzu(kuzu_path)
        conn.execute("MERGE (c:Concept {name: 'Probability'})")

        adjacency = load_concept_adjacency(conn)

        assert adjacency == {"Probability": []}

        conn.close()
        kuzu_db.close()


class TestFormatConceptGraph:
    def test_formats_concepts_and_neighbors_as_ascii_tree(self):
        rendered = format_concept_graph(
            {
                "Calculus": [
                    type(
                        "Neighbor",
                        (),
                        {
                            "name": "Derivatives",
                            "weight": 2.0,
                            "reason": "shared_document",
                        },
                    )(),
                    type(
                        "Neighbor",
                        (),
                        {
                            "name": "Limits",
                            "weight": 1.0,
                            "reason": "shared_document",
                        },
                    )(),
                ],
                "Probability": [],
            }
        )

        assert "Concept Graph" in rendered
        assert "Calculus" in rendered
        assert "|- Derivatives (weight=2.0, reason=shared_document)" in rendered
        assert "`- Limits (weight=1.0, reason=shared_document)" in rendered
        assert "Probability" in rendered
        assert "  (no related concepts)" in rendered


class TestLoadConceptAdjacencyFromChunks:
    def test_builds_shared_document_graph_from_chunk_tags(self, lance_path):
        _db, table = init_lancedb(lance_path)
        table.add(
            [
                {
                    "chunk_id": "chunk-1",
                    "doc_id": "doc-1",
                    "doc_name": "Doc 1",
                    "text": "Calculus and derivatives.",
                    "concepts": ["Calculus", "Derivatives"],
                    "vector": [0.0] * 384,
                },
                {
                    "chunk_id": "chunk-2",
                    "doc_id": "doc-1",
                    "doc_name": "Doc 1",
                    "text": "Calculus and limits.",
                    "concepts": ["Calculus", "Limits"],
                    "vector": [0.0] * 384,
                },
                {
                    "chunk_id": "chunk-3",
                    "doc_id": "doc-2",
                    "doc_name": "Doc 2",
                    "text": "Probability only.",
                    "concepts": ["Probability"],
                    "vector": [0.0] * 384,
                },
            ]
        )

        adjacency = load_concept_adjacency_from_chunks(lance_path)

        assert [neighbor.name for neighbor in adjacency["Calculus"]] == [
            "Derivatives",
            "Limits",
        ]
        assert adjacency["Probability"] == []


class TestRenderConceptGraph:
    def test_falls_back_to_lancedb_when_kuzu_path_is_invalid(self, lance_path, kuzu_path):
        _db, table = init_lancedb(lance_path)
        table.add(
            [
                {
                    "chunk_id": "chunk-1",
                    "doc_id": "doc-1",
                    "doc_name": "Doc 1",
                    "text": "Calculus and derivatives.",
                    "concepts": ["Calculus", "Derivatives"],
                    "vector": [0.0] * 384,
                }
            ]
        )

        Path(kuzu_path).write_text("not a kuzu database")

        rendered = render_concept_graph(kuzu_path, lance_path)

        assert "Source: LanceDB-derived fallback" in rendered
        assert "Calculus" in rendered
        assert "Derivatives" in rendered

    def test_raises_helpful_error_when_kuzu_is_invalid_and_lancedb_has_no_graph_data(
        self,
        lance_path,
        kuzu_path,
    ):
        Path(kuzu_path).write_text("not a kuzu database")

        try:
            render_concept_graph(kuzu_path, lance_path)
            assert False, "expected render_concept_graph to raise"
        except RuntimeError as error:
            message = str(error)
            assert "Failed to open Kuzu" in message
            assert "no graph could be derived from LanceDB chunks" in message


class TestPrintConceptGraphScript:
    def test_script_runs_directly_from_repo_root(self, kuzu_path):
        kuzu_db, conn = init_kuzu(kuzu_path)
        conn.execute("MERGE (c:Concept {name: 'Calculus'})")
        conn.close()
        kuzu_db.close()

        repo_root = Path(__file__).resolve().parents[1]
        result = subprocess.run(
            [
                sys.executable,
                str(repo_root / "scripts" / "print_concept_graph.py"),
                "--kuzu-db-path",
                kuzu_path,
            ],
            cwd=repo_root,
            capture_output=True,
            text=True,
            check=False,
        )

        assert result.returncode == 0
        assert "Concept Graph" in result.stdout
        assert "Calculus" in result.stdout

    def test_script_accepts_lancedb_fallback_path(self, lance_path, kuzu_path):
        _db, table = init_lancedb(lance_path)
        table.add(
            [
                {
                    "chunk_id": "chunk-1",
                    "doc_id": "doc-1",
                    "doc_name": "Doc 1",
                    "text": "Calculus and derivatives.",
                    "concepts": ["Calculus", "Derivatives"],
                    "vector": [0.0] * 384,
                }
            ]
        )
        Path(kuzu_path).write_text("not a kuzu database")

        repo_root = Path(__file__).resolve().parents[1]
        result = subprocess.run(
            [
                sys.executable,
                str(repo_root / "scripts" / "print_concept_graph.py"),
                "--kuzu-db-path",
                kuzu_path,
                "--lance-db-path",
                lance_path,
            ],
            cwd=repo_root,
            capture_output=True,
            text=True,
            check=False,
        )

        assert result.returncode == 0
        assert "Source: LanceDB-derived fallback" in result.stdout
