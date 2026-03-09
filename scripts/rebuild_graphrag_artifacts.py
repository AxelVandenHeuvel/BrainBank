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


def run_island_cleanup(
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
        return consolidator.force_consolidate_islands(conn)
    finally:
        conn.close()
        kuzu_db.close()


def main() -> int:
    print("Starting GraphRAG artifact rebuild...")
    
    print("Step 1/5: Running consolidation cleanup...")
    cleanup = run_consolidation_cleanup()
    print(f"  - Merged {cleanup.get('merged_count', 0)} concepts")
    print(f"  - Renamed {cleanup.get('renamed_count', 0)} canonical concepts")
    
    print("Step 2/5: Healing graph (adding semantic bridges)...")
    bridges = heal_graph()
    print(f"  - Added {bridges} semantic bridges")
    
    print("Step 3/5: Forcing orphan cleanup...")
    orphan_cleanup = run_force_orphan_cleanup()
    print(f"  - Forced {orphan_cleanup.get('forced_merges', 0)} orphan merges")

    print("Step 4/5: Reaping island nodes (zero edges)...")
    island_cleanup = run_island_cleanup()
    print(f"  - Merged {island_cleanup.get('forced_merges', 0)} island nodes")

    print("Step 5/5: Rebuilding community artifacts...")
    summary = rebuild_graphrag_artifacts()
    
    print("\nRebuild Complete!")
    print(
        f"  - {summary['concept_centroids']} concept centroids registered"
    )
    print(
        f"  - {summary['communities']} communities summarized"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
