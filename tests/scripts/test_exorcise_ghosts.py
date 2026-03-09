from scripts.exorcise_ghosts import GHOST_MAPPING, exorcise_ghosts


def _vec(x: float, y: float) -> list[float]:
    return [x, y] + [0.0] * 382


class TestExorciseGhosts:
    def test_replaces_ghost_concepts_in_lancedb_chunks(self, lance_path):
        from backend.db.lance import init_lancedb

        db, chunks_table = init_lancedb(lance_path)
        chunks_table.add(
            [
                {
                    "chunk_id": "c1",
                    "doc_id": "d1",
                    "doc_name": "Doc 1",
                    "text": "Free will and determinism.",
                    "concepts": ["Free Will", "Determinism"],
                    "vector": _vec(1.0, 0.0),
                },
                {
                    "chunk_id": "c2",
                    "doc_id": "d2",
                    "doc_name": "Doc 2",
                    "text": "Maxwell's equations in electrodynamics.",
                    "concepts": ["Maxwell's Equations", "Electrodynamics"],
                    "vector": _vec(0.0, 1.0),
                },
                {
                    "chunk_id": "c3",
                    "doc_id": "d3",
                    "doc_name": "Doc 3",
                    "text": "Rationalism vs empiricism.",
                    "concepts": ["Rationalism", "Epistemology"],
                    "vector": _vec(0.5, 0.5),
                },
                {
                    "chunk_id": "c4",
                    "doc_id": "d4",
                    "doc_name": "Doc 4",
                    "text": "Laws of thermodynamics.",
                    "concepts": ["Thermodynamics", "Energy"],
                    "vector": _vec(0.3, 0.7),
                },
            ]
        )

        summary = exorcise_ghosts(lance_path)

        assert summary["replaced"] == 4

        # Re-open to see committed changes
        refreshed_table = db.open_table("chunks")
        df = refreshed_table.to_pandas()
        all_concepts = [c for row in df["concepts"].tolist() for c in row]

        for ghost in GHOST_MAPPING:
            assert ghost not in all_concepts

        assert all_concepts.count("Philosophy") == 2
        assert all_concepts.count("Physics") == 2

    def test_handles_apostrophe_in_concept_name(self, lance_path):
        from backend.db.lance import init_lancedb

        db, chunks_table = init_lancedb(lance_path)
        chunks_table.add(
            [
                {
                    "chunk_id": "c1",
                    "doc_id": "d1",
                    "doc_name": "Doc 1",
                    "text": "Maxwell's equations.",
                    "concepts": ["Maxwell's Equations"],
                    "vector": _vec(1.0, 0.0),
                },
            ]
        )

        summary = exorcise_ghosts(lance_path)

        refreshed_table = db.open_table("chunks")
        df = refreshed_table.to_pandas()
        all_concepts = [c for row in df["concepts"].tolist() for c in row]
        assert "Maxwell's Equations" not in all_concepts
        assert "Physics" in all_concepts

    def test_ghost_mapping_contains_expected_entries(self):
        assert GHOST_MAPPING == {
            "Free Will": "Philosophy",
            "Maxwell's Equations": "Physics",
            "Rationalism": "Philosophy",
            "Thermodynamics": "Physics",
        }
