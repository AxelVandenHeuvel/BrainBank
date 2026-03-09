from unittest.mock import Mock, patch

from backend.db.kuzu import init_kuzu
from backend.db.lance import init_lancedb
from backend.ingestion.consolidator import ConceptConsolidator, _replace_concept_in_chunks


def _vec(x: float, y: float) -> list[float]:
    return [x, y] + [0.0] * 382


class TestConceptConsolidator:
    @patch("backend.ingestion.consolidator.embed_texts")
    def test_canonicalize_concepts_maps_semantic_duplicates(self, mock_embed, lance_path, kuzu_path):
        db, chunks_table = init_lancedb(lance_path)
        concept_centroids = db.open_table("concept_centroids")
        concept_centroids.add(
            [
                {
                    "concept_name": "Integrals",
                    "centroid_vector": _vec(1.0, 0.0),
                    "document_count": 5,
                }
            ]
        )

        def _fake_embed(texts: list[str]) -> list[list[float]]:
            vectors = {
                "Definite Integrals": _vec(0.95, 0.05),
                "Probability": _vec(0.0, 1.0),
            }
            return [vectors[text] for text in texts]

        mock_embed.side_effect = _fake_embed

        _, conn = init_kuzu(kuzu_path)
        consolidator = ConceptConsolidator(
            chunks_table=chunks_table,
            concept_centroids_table=concept_centroids,
            lance_db=db,
        )

        canonical = consolidator.canonicalize_concepts(["Definite Integrals", "Probability"])

        assert canonical == ["Integrals", "Probability"]
        conn.close()

    def test_consolidate_graph_merges_underpopulated_concepts(self, lance_path, kuzu_path):
        db, chunks_table = init_lancedb(lance_path)
        concept_centroids = db.open_table("concept_centroids")
        concept_centroids.add(
            [
                {
                    "concept_name": "Definite Integrals",
                    "centroid_vector": _vec(0.95, 0.05),
                    "document_count": 2,
                },
                {
                    "concept_name": "Integrals",
                    "centroid_vector": _vec(1.0, 0.0),
                    "document_count": 4,
                },
                {
                    "concept_name": "Derivatives",
                    "centroid_vector": _vec(0.0, 1.0),
                    "document_count": 4,
                },
            ]
        )

        chunks_table.add(
            [
                {
                    "chunk_id": "c1",
                    "doc_id": "d1",
                    "doc_name": "Doc 1",
                    "text": "Definite integrals",
                    "concepts": ["Definite Integrals"],
                    "vector": _vec(0.95, 0.05),
                },
                {
                    "chunk_id": "c2",
                    "doc_id": "d2",
                    "doc_name": "Doc 2",
                    "text": "Definite integrals",
                    "concepts": ["Definite Integrals"],
                    "vector": _vec(0.95, 0.05),
                },
                {
                    "chunk_id": "c3",
                    "doc_id": "d3",
                    "doc_name": "Doc 3",
                    "text": "Integrals",
                    "concepts": ["Integrals"],
                    "vector": _vec(1.0, 0.0),
                },
                {
                    "chunk_id": "c4",
                    "doc_id": "d4",
                    "doc_name": "Doc 4",
                    "text": "Integrals",
                    "concepts": ["Integrals"],
                    "vector": _vec(1.0, 0.0),
                },
                {
                    "chunk_id": "c5",
                    "doc_id": "d5",
                    "doc_name": "Doc 5",
                    "text": "Integrals",
                    "concepts": ["Integrals"],
                    "vector": _vec(1.0, 0.0),
                },
            ]
        )

        _, conn = init_kuzu(kuzu_path)
        conn.execute("CREATE (:Concept {name: 'Definite Integrals'})")
        conn.execute("CREATE (:Concept {name: 'Integrals'})")
        conn.execute("CREATE (:Concept {name: 'Chain Rule'})")
        conn.execute(
            "MATCH (a:Concept {name: 'Definite Integrals'}), (b:Concept {name: 'Chain Rule'}) "
            "CREATE (a)-[:RELATED_TO {reason: 'shared_document', weight: 2.0, edge_type: 'RELATED_TO'}]->(b)"
        )
        conn.execute(
            "MATCH (a:Concept {name: 'Integrals'}), (b:Concept {name: 'Chain Rule'}) "
            "CREATE (a)-[:RELATED_TO {reason: 'shared_document', weight: 1.0, edge_type: 'RELATED_TO'}]->(b)"
        )

        consolidator = ConceptConsolidator(
            chunks_table=chunks_table,
            concept_centroids_table=concept_centroids,
            lance_db=db,
        )
        summary = consolidator.consolidate_graph(conn)

        assert summary["merged_count"] == 1

        source_result = conn.execute("MATCH (c:Concept {name: 'Definite Integrals'}) RETURN count(c)")
        assert source_result.get_next()[0] == 0

        edge_result = conn.execute(
            "MATCH (a:Concept {name: 'Integrals'})-[r:RELATED_TO]->(b:Concept {name: 'Chain Rule'}) "
            "RETURN r.weight"
        )
        assert edge_result.has_next()
        assert edge_result.get_next()[0] == 3.0

        chunk_df = chunks_table.to_pandas()
        flattened = [concept for concepts in chunk_df["concepts"].tolist() for concept in concepts]
        assert "Definite Integrals" not in flattened
        assert "Integrals" in flattened
        conn.close()

    def test_consolidate_graph_auto_merges_above_high_similarity_threshold(self, lance_path, kuzu_path):
        db, chunks_table = init_lancedb(lance_path)
        concept_centroids = db.open_table("concept_centroids")
        concept_centroids.add(
            [
                {
                    "concept_name": "Definite Integrals",
                    "centroid_vector": _vec(0.99, 0.01),
                    "document_count": 2,
                },
                {
                    "concept_name": "Integrals",
                    "centroid_vector": _vec(1.0, 0.0),
                    "document_count": 4,
                },
            ]
        )
        chunks_table.add(
            [
                {
                    "chunk_id": "auto-1",
                    "doc_id": "d1",
                    "doc_name": "Doc 1",
                    "text": "Definite Integrals",
                    "concepts": ["Definite Integrals"],
                    "vector": _vec(0.99, 0.01),
                },
                {
                    "chunk_id": "auto-2",
                    "doc_id": "d2",
                    "doc_name": "Doc 2",
                    "text": "Definite Integrals",
                    "concepts": ["Definite Integrals"],
                    "vector": _vec(0.99, 0.01),
                },
            ]
        )

        _, conn = init_kuzu(kuzu_path)
        conn.execute("CREATE (:Concept {name: 'Definite Integrals'})")
        conn.execute("CREATE (:Concept {name: 'Integrals'})")

        consolidator = ConceptConsolidator(chunks_table, concept_centroids, db)

        with patch("backend.ingestion.consolidator.generate_text_with_backoff") as mock_llm:
            summary = consolidator.consolidate_graph(conn)

        assert summary["merged_count"] == 1
        mock_llm.assert_not_called()
        source_result = conn.execute("MATCH (c:Concept {name: 'Definite Integrals'}) RETURN count(c)")
        assert source_result.get_next()[0] == 0
        conn.close()

    def test_consolidate_graph_skips_llm_when_similarity_is_too_low(self, lance_path, kuzu_path):
        db, chunks_table = init_lancedb(lance_path)
        concept_centroids = db.open_table("concept_centroids")
        concept_centroids.add(
            [
                {
                    "concept_name": "Obscure Topic",
                    "centroid_vector": _vec(0.0, 1.0),
                    "document_count": 2,
                },
                {
                    "concept_name": "Integrals",
                    "centroid_vector": _vec(1.0, 0.0),
                    "document_count": 4,
                },
            ]
        )
        chunks_table.add(
            [
                {
                    "chunk_id": "skip-1",
                    "doc_id": "d1",
                    "doc_name": "Doc 1",
                    "text": "Obscure Topic",
                    "concepts": ["Obscure Topic"],
                    "vector": _vec(0.0, 1.0),
                },
                {
                    "chunk_id": "skip-2",
                    "doc_id": "d2",
                    "doc_name": "Doc 2",
                    "text": "Obscure Topic",
                    "concepts": ["Obscure Topic"],
                    "vector": _vec(0.0, 1.0),
                },
            ]
        )

        _, conn = init_kuzu(kuzu_path)
        conn.execute("CREATE (:Concept {name: 'Obscure Topic'})")
        conn.execute("CREATE (:Concept {name: 'Integrals'})")

        consolidator = ConceptConsolidator(chunks_table, concept_centroids, db)

        with patch("backend.ingestion.consolidator.generate_text_with_backoff") as mock_llm:
            summary = consolidator.consolidate_graph(conn)

        assert summary["merged_count"] == 0
        mock_llm.assert_not_called()
        source_result = conn.execute("MATCH (c:Concept {name: 'Obscure Topic'}) RETURN count(c)")
        assert source_result.get_next()[0] == 1
        conn.close()

    def test_consolidate_graph_batches_llm_decisions(self, lance_path, kuzu_path):
        db, chunks_table = init_lancedb(lance_path)
        concept_centroids = db.open_table("concept_centroids")
        concept_centroids.add(
            [
                {
                    "concept_name": "Definite Integrals",
                    "centroid_vector": _vec(0.80, 0.60),
                    "document_count": 2,
                },
                {
                    "concept_name": "Integrals",
                    "centroid_vector": _vec(1.0, 0.0),
                    "document_count": 4,
                },
                {
                    "concept_name": "Quotient Rule Variant",
                    "centroid_vector": _vec(-0.60, 0.80),
                    "document_count": 2,
                },
                {
                    "concept_name": "Quotient Rule",
                    "centroid_vector": _vec(0.0, 1.0),
                    "document_count": 4,
                },
            ]
        )
        chunks_table.add(
            [
                {
                    "chunk_id": "batch-1",
                    "doc_id": "d1",
                    "doc_name": "Doc 1",
                    "text": "Definite Integrals",
                    "concepts": ["Definite Integrals"],
                    "vector": _vec(0.80, 0.60),
                },
                {
                    "chunk_id": "batch-2",
                    "doc_id": "d2",
                    "doc_name": "Doc 2",
                    "text": "Definite Integrals",
                    "concepts": ["Definite Integrals"],
                    "vector": _vec(0.80, 0.60),
                },
                {
                    "chunk_id": "batch-3",
                    "doc_id": "d3",
                    "doc_name": "Doc 3",
                    "text": "Quotient Rule Variant",
                    "concepts": ["Quotient Rule Variant"],
                    "vector": _vec(-0.60, 0.80),
                },
                {
                    "chunk_id": "batch-4",
                    "doc_id": "d4",
                    "doc_name": "Doc 4",
                    "text": "Quotient Rule Variant",
                    "concepts": ["Quotient Rule Variant"],
                    "vector": _vec(-0.60, 0.80),
                },
            ]
        )

        _, conn = init_kuzu(kuzu_path)
        for concept in ["Definite Integrals", "Integrals", "Quotient Rule Variant", "Quotient Rule"]:
            conn.execute("CREATE (:Concept {name: $name})", parameters={"name": concept})

        consolidator = ConceptConsolidator(chunks_table, concept_centroids, db)

        llm_response = (
            '{"decisions": ['
            '{"source": "Definite Integrals", "action": "MERGE", "merge_into": "Integrals"},'
            '{"source": "Quotient Rule Variant", "action": "MERGE", "merge_into": "Quotient Rule"}'
            ']}'
        )

        with patch(
            "backend.ingestion.consolidator.generate_text_with_backoff",
            return_value=llm_response,
        ) as mock_llm:
            summary = consolidator.consolidate_graph(conn)

        assert summary["merged_count"] == 2
        mock_llm.assert_called_once()
        prompt = mock_llm.call_args.args[0]
        assert "Definite Integrals" in prompt
        assert "Quotient Rule Variant" in prompt
        conn.close()


    def test_force_consolidate_orphans_merges_using_forced_parent_choice(self, lance_path, kuzu_path):
        db, chunks_table = init_lancedb(lance_path)
        concept_centroids = db.open_table("concept_centroids")
        concept_centroids.add(
            [
                {
                    "concept_name": "Eigen Vector",
                    "centroid_vector": _vec(0.95, 0.05),
                    "document_count": 2,
                },
                {
                    "concept_name": "Linear Algebra",
                    "centroid_vector": _vec(1.0, 0.0),
                    "document_count": 10,
                },
                {
                    "concept_name": "Calculus",
                    "centroid_vector": _vec(0.0, 1.0),
                    "document_count": 8,
                },
                {
                    "concept_name": "Probability",
                    "centroid_vector": _vec(-1.0, 0.0),
                    "document_count": 6,
                },
                {
                    "concept_name": "Matrices",
                    "centroid_vector": _vec(0.8, 0.2),
                    "document_count": 7,
                },
                {
                    "concept_name": "Vectors",
                    "centroid_vector": _vec(0.9, 0.1),
                    "document_count": 9,
                },
            ]
        )
        chunks_table.add(
            [
                {
                    "chunk_id": "force-1",
                    "doc_id": "d1",
                    "doc_name": "Doc 1",
                    "text": "Eigen Vector basics",
                    "concepts": ["Eigen Vector"],
                    "vector": _vec(0.95, 0.05),
                },
                {
                    "chunk_id": "force-2",
                    "doc_id": "d2",
                    "doc_name": "Doc 2",
                    "text": "Eigen Vector application",
                    "concepts": ["Eigen Vector"],
                    "vector": _vec(0.95, 0.05),
                },
            ]
        )

        _, conn = init_kuzu(kuzu_path)
        conn.execute("CREATE (:Concept {name: 'Eigen Vector'})")
        conn.execute("CREATE (:Concept {name: 'Linear Algebra'})")
        conn.execute("CREATE (:Concept {name: 'Calculus'})")
        conn.execute(
            "MATCH (a:Concept {name: 'Eigen Vector'}), (b:Concept {name: 'Calculus'}) "
            "CREATE (a)-[:RELATED_TO {reason: 'shared_document', weight: 2.0, edge_type: 'RELATED_TO'}]->(b)"
        )
        conn.execute(
            "MATCH (a:Concept {name: 'Linear Algebra'}), (b:Concept {name: 'Calculus'}) "
            "CREATE (a)-[:RELATED_TO {reason: 'shared_document', weight: 1.0, edge_type: 'RELATED_TO'}]->(b)"
        )

        consolidator = ConceptConsolidator(chunks_table, concept_centroids, db)

        with patch(
            "backend.ingestion.consolidator.generate_text_with_backoff",
            return_value="Linear Algebra",
        ) as mock_llm:
            summary = consolidator.force_consolidate_orphans(conn)

        assert summary["forced_merges"] == 1
        assert mock_llm.call_count == 1
        prompt = mock_llm.call_args.args[0]
        assert "You MUST merge it into one of these 5 candidates" in prompt
        assert "Eigen Vector" in prompt

        deleted = conn.execute("MATCH (c:Concept {name: 'Eigen Vector'}) RETURN count(c)")
        assert deleted.get_next()[0] == 0

        merged_weight = conn.execute(
            "MATCH (a:Concept {name: 'Linear Algebra'})-[r:RELATED_TO]->(b:Concept {name: 'Calculus'}) RETURN r.weight"
        )
        assert merged_weight.has_next()
        assert merged_weight.get_next()[0] == 3.0
        conn.close()

    def test_force_consolidate_orphans_falls_back_to_top_neighbor_when_llm_fails(
        self, lance_path, kuzu_path
    ):
        db, chunks_table = init_lancedb(lance_path)
        concept_centroids = db.open_table("concept_centroids")
        concept_centroids.add(
            [
                {
                    "concept_name": "Eigen Vector",
                    "centroid_vector": _vec(0.95, 0.05),
                    "document_count": 2,
                },
                {
                    "concept_name": "Linear Algebra",
                    "centroid_vector": _vec(1.0, 0.0),
                    "document_count": 10,
                },
                {
                    "concept_name": "Calculus",
                    "centroid_vector": _vec(0.0, 1.0),
                    "document_count": 8,
                },
            ]
        )
        chunks_table.add(
            [
                {
                    "chunk_id": "fb-1",
                    "doc_id": "d1",
                    "doc_name": "Doc 1",
                    "text": "Eigen Vector basics",
                    "concepts": ["Eigen Vector"],
                    "vector": _vec(0.95, 0.05),
                },
                {
                    "chunk_id": "fb-2",
                    "doc_id": "d2",
                    "doc_name": "Doc 2",
                    "text": "Eigen Vector application",
                    "concepts": ["Eigen Vector"],
                    "vector": _vec(0.95, 0.05),
                },
            ]
        )

        _, conn = init_kuzu(kuzu_path)
        conn.execute("CREATE (:Concept {name: 'Eigen Vector'})")
        conn.execute("CREATE (:Concept {name: 'Linear Algebra'})")
        conn.execute("CREATE (:Concept {name: 'Calculus'})")

        consolidator = ConceptConsolidator(chunks_table, concept_centroids, db)

        with patch(
            "backend.ingestion.consolidator.generate_text_with_backoff",
            side_effect=Exception("LLM unavailable"),
        ):
            summary = consolidator.force_consolidate_orphans(conn)

        # Should still merge, using the #1 nearest neighbor as fallback
        assert summary["forced_merges"] == 1

        deleted = conn.execute("MATCH (c:Concept {name: 'Eigen Vector'}) RETURN count(c)")
        assert deleted.get_next()[0] == 0

        # Linear Algebra is cosine-closest to Eigen Vector (_vec(1,0) vs _vec(0.95,0.05))
        merged = conn.execute("MATCH (c:Concept {name: 'Linear Algebra'}) RETURN count(c)")
        assert merged.get_next()[0] == 1
        conn.close()


class TestReplaceConceptInChunks:
    def test_replaces_concept_in_normal_chunk(self, lance_path):
        db, chunks_table = init_lancedb(lance_path)
        chunks_table.add([
            {
                "chunk_id": "chunk-1",
                "doc_id": "d1",
                "doc_name": "Doc 1",
                "text": "Maxwell's equations are fundamental.",
                "concepts": ["Maxwell Equation", "Physics"],
                "vector": _vec(1.0, 0.0),
            }
        ])

        _replace_concept_in_chunks(chunks_table, "Maxwell Equation", "Electromagnetism")

        df = chunks_table.to_pandas()
        all_concepts = [c for row in df["concepts"].tolist() for c in row]
        assert "Maxwell Equation" not in all_concepts
        assert "Electromagnetism" in all_concepts

    def test_replaces_concept_when_chunk_id_contains_double_quote(self, lance_path):
        """Old delete-by-id approach silently fails when chunk_id has double-quotes."""
        db, chunks_table = init_lancedb(lance_path)
        chunks_table.add([
            {
                "chunk_id": 'chunk-"quoted"-id',
                "doc_id": "d1",
                "doc_name": "Doc 1",
                "text": "Maxwell's equations.",
                "concepts": ["Maxwell Equation", "Physics"],
                "vector": _vec(1.0, 0.0),
            }
        ])

        _replace_concept_in_chunks(chunks_table, "Maxwell Equation", "Electromagnetism")

        df = chunks_table.to_pandas()
        all_concepts = [c for row in df["concepts"].tolist() for c in row]
        assert "Maxwell Equation" not in all_concepts
        assert "Electromagnetism" in all_concepts

    def test_replaces_concept_when_concept_name_has_single_quote(self, lance_path):
        """Concept names with apostrophes must be SQL-escaped in the update query."""
        db, chunks_table = init_lancedb(lance_path)
        chunks_table.add([
            {
                "chunk_id": "chunk-1",
                "doc_id": "d1",
                "doc_name": "Doc 1",
                "text": "Faraday's law.",
                "concepts": ["Faraday's Law", "Physics"],
                "vector": _vec(1.0, 0.0),
            }
        ])

        _replace_concept_in_chunks(chunks_table, "Faraday's Law", "Electromagnetism")

        df = chunks_table.to_pandas()
        all_concepts = [c for row in df["concepts"].tolist() for c in row]
        assert "Faraday's Law" not in all_concepts
        assert "Electromagnetism" in all_concepts

    def test_leaves_other_concepts_untouched(self, lance_path):
        db, chunks_table = init_lancedb(lance_path)
        chunks_table.add([
            {
                "chunk_id": "chunk-1",
                "doc_id": "d1",
                "doc_name": "Doc 1",
                "text": "text",
                "concepts": ["Maxwell Equation", "Physics"],
                "vector": _vec(1.0, 0.0),
            },
            {
                "chunk_id": "chunk-2",
                "doc_id": "d2",
                "doc_name": "Doc 2",
                "text": "text",
                "concepts": ["Biology"],
                "vector": _vec(0.0, 1.0),
            },
        ])

        _replace_concept_in_chunks(chunks_table, "Maxwell Equation", "Electromagnetism")

        df = chunks_table.to_pandas()
        all_concepts = [c for row in df["concepts"].tolist() for c in row]
        assert "Biology" in all_concepts
        assert "Physics" in all_concepts
        assert "Maxwell Equation" not in all_concepts

    def test_noop_when_concept_not_present(self, lance_path):
        db, chunks_table = init_lancedb(lance_path)
        chunks_table.add([
            {
                "chunk_id": "chunk-1",
                "doc_id": "d1",
                "doc_name": "Doc 1",
                "text": "text",
                "concepts": ["Biology"],
                "vector": _vec(0.0, 1.0),
            }
        ])

        _replace_concept_in_chunks(chunks_table, "Maxwell Equation", "Electromagnetism")

        df = chunks_table.to_pandas()
        all_concepts = [c for row in df["concepts"].tolist() for c in row]
        assert "Biology" in all_concepts
        assert "Electromagnetism" not in all_concepts


class TestForceConsolidateIslands:
    def test_merges_zero_edge_node_into_llm_chosen_neighbor(self, lance_path, kuzu_path):
        db, chunks_table = init_lancedb(lance_path)
        concept_centroids = db.open_table("concept_centroids")
        concept_centroids.add(
            [
                {
                    "concept_name": "Limits",
                    "centroid_vector": _vec(0.9, 0.1),
                    "document_count": 5,
                },
                {
                    "concept_name": "Calculus",
                    "centroid_vector": _vec(1.0, 0.0),
                    "document_count": 10,
                },
                {
                    "concept_name": "Derivatives",
                    "centroid_vector": _vec(0.0, 1.0),
                    "document_count": 8,
                },
            ]
        )
        chunks_table.add(
            [
                {
                    "chunk_id": "island-1",
                    "doc_id": "d1",
                    "doc_name": "Doc 1",
                    "text": "Limits of sequences",
                    "concepts": ["Limits"],
                    "vector": _vec(0.9, 0.1),
                },
            ]
        )

        _, conn = init_kuzu(kuzu_path)
        conn.execute("CREATE (:Concept {name: 'Limits'})")
        conn.execute("CREATE (:Concept {name: 'Calculus'})")
        conn.execute("CREATE (:Concept {name: 'Derivatives'})")
        # Calculus <-> Derivatives have an edge; Limits has ZERO edges
        conn.execute(
            "MATCH (a:Concept {name: 'Calculus'}), (b:Concept {name: 'Derivatives'}) "
            "CREATE (a)-[:RELATED_TO {reason: 'shared_document', weight: 1.0, edge_type: 'RELATED_TO'}]->(b)"
        )

        consolidator = ConceptConsolidator(chunks_table, concept_centroids, db)

        with patch(
            "backend.ingestion.consolidator.generate_text_with_backoff",
            return_value="Calculus",
        ) as mock_llm:
            summary = consolidator.force_consolidate_islands(conn)

        assert summary["forced_merges"] == 1
        assert mock_llm.call_count == 1
        prompt = mock_llm.call_args.args[0]
        assert "disconnected" in prompt.lower()
        assert "Limits" in prompt

        deleted = conn.execute("MATCH (c:Concept {name: 'Limits'}) RETURN count(c)")
        assert deleted.get_next()[0] == 0

        chunk_df = chunks_table.to_pandas()
        all_concepts = [c for row in chunk_df["concepts"].tolist() for c in row]
        assert "Limits" not in all_concepts
        assert "Calculus" in all_concepts
        conn.close()

    def test_skips_nodes_that_have_edges(self, lance_path, kuzu_path):
        db, chunks_table = init_lancedb(lance_path)
        concept_centroids = db.open_table("concept_centroids")
        concept_centroids.add(
            [
                {
                    "concept_name": "Calculus",
                    "centroid_vector": _vec(1.0, 0.0),
                    "document_count": 10,
                },
                {
                    "concept_name": "Derivatives",
                    "centroid_vector": _vec(0.0, 1.0),
                    "document_count": 8,
                },
            ]
        )
        chunks_table.add(
            [
                {
                    "chunk_id": "c1",
                    "doc_id": "d1",
                    "doc_name": "Doc 1",
                    "text": "Calculus",
                    "concepts": ["Calculus"],
                    "vector": _vec(1.0, 0.0),
                },
            ]
        )

        _, conn = init_kuzu(kuzu_path)
        conn.execute("CREATE (:Concept {name: 'Calculus'})")
        conn.execute("CREATE (:Concept {name: 'Derivatives'})")
        conn.execute(
            "MATCH (a:Concept {name: 'Calculus'}), (b:Concept {name: 'Derivatives'}) "
            "CREATE (a)-[:RELATED_TO {reason: 'shared_document', weight: 1.0, edge_type: 'RELATED_TO'}]->(b)"
        )

        consolidator = ConceptConsolidator(chunks_table, concept_centroids, db)

        with patch(
            "backend.ingestion.consolidator.generate_text_with_backoff",
        ) as mock_llm:
            summary = consolidator.force_consolidate_islands(conn)

        assert summary["forced_merges"] == 0
        mock_llm.assert_not_called()
        conn.close()

    def test_respects_llm_none_decision(self, lance_path, kuzu_path):
        db, chunks_table = init_lancedb(lance_path)
        concept_centroids = db.open_table("concept_centroids")
        concept_centroids.add(
            [
                {
                    "concept_name": "My Journal Entry",
                    "centroid_vector": _vec(0.5, 0.5),
                    "document_count": 3,
                },
                {
                    "concept_name": "Calculus",
                    "centroid_vector": _vec(1.0, 0.0),
                    "document_count": 10,
                },
            ]
        )
        chunks_table.add(
            [
                {
                    "chunk_id": "c1",
                    "doc_id": "d1",
                    "doc_name": "Doc 1",
                    "text": "journal",
                    "concepts": ["My Journal Entry"],
                    "vector": _vec(0.5, 0.5),
                },
            ]
        )

        _, conn = init_kuzu(kuzu_path)
        conn.execute("CREATE (:Concept {name: 'My Journal Entry'})")
        conn.execute("CREATE (:Concept {name: 'Calculus'})")

        consolidator = ConceptConsolidator(chunks_table, concept_centroids, db)

        with patch(
            "backend.ingestion.consolidator.generate_text_with_backoff",
            return_value="NONE",
        ):
            summary = consolidator.force_consolidate_islands(conn)

        assert summary["forced_merges"] == 0
        still_exists = conn.execute("MATCH (c:Concept {name: 'My Journal Entry'}) RETURN count(c)")
        assert still_exists.get_next()[0] == 1
        conn.close()
