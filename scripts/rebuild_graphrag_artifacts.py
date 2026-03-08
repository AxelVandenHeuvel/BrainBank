#!/usr/bin/env python3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]

if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.db.kuzu import init_kuzu
from backend.db.lance import init_lancedb
from backend.ingestion.consolidator import ConceptConsolidator
from backend.retrieval.artifacts import rebuild_graphrag_artifacts
from backend.scripts.heal_graph import heal_graph


def run_consolidation_cleanup(
    lance_db_path: str = "./data/lancedb",
    kuzu_db_path: str = "./data/kuzu",
) -> dict[str, int]:
    db, chunks_table = init_lancedb(lance_db_path)
    concept_centroids_table = db.open_table("concept_centroids")
    kuzu_db, conn = init_kuzu(kuzu_db_path)

    try:
        consolidator = ConceptConsolidator(
            chunks_table=chunks_table,
            concept_centroids_table=concept_centroids_table,
            lance_db=db,
        )
        return consolidator.consolidate_graph(conn)
    finally:
        conn.close()
        kuzu_db.close()


def run_force_orphan_cleanup(
    lance_db_path: str = "./data/lancedb",
    kuzu_db_path: str = "./data/kuzu",
) -> dict[str, int]:
    db, chunks_table = init_lancedb(lance_db_path)
    concept_centroids_table = db.open_table("concept_centroids")
    kuzu_db, conn = init_kuzu(kuzu_db_path)

    try:
        consolidator = ConceptConsolidator(
            chunks_table=chunks_table,
            concept_centroids_table=concept_centroids_table,
            lance_db=db,
        )
        return consolidator.force_consolidate_orphans(conn)
    finally:
        conn.close()
        kuzu_db.close()


def main() -> int:
    cleanup = run_consolidation_cleanup()
    bridges = heal_graph()
    orphan_cleanup = run_force_orphan_cleanup()
    summary = rebuild_graphrag_artifacts()
    print(
        "Rebuilt GraphRAG artifacts: "
        f"{summary['concept_centroids']} concept centroids, "
        f"{summary['communities']} communities, "
        f"concept merges={cleanup.get('merged_count', 0)}, "
        f"canonical renames={cleanup.get('renamed_count', 0)}, "
        f"semantic bridges={bridges}, "
        f"forced orphan merges={orphan_cleanup.get('forced_merges', 0)}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
