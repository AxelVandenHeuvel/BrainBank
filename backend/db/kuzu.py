import logging
import os
import shutil
import threading
from datetime import datetime
from itertools import combinations

import kuzu

# The single Database instance that holds the OS file lock.
# Opened exactly once; all connections are spawned from it.
_db_instance = None
_db_instance_lock = threading.Lock()
logger = logging.getLogger(__name__)
REPAIRED_COLOR_SCORE = 0.5
REPAIRED_EDGE_REASON = "shared_document"


def _open_database(db_path: str) -> kuzu.Database:
    try:
        return kuzu.Database(db_path)
    except IndexError as error:
        message = str(error)
        lock_conflict_message = (
            "unordered_map::at: key not found" in message
            or "invalid unordered_map<K, T> key" in message
        )
        if not lock_conflict_message:
            raise

        raise RuntimeError(
            "Failed to open the Kuzu database at "
            f"{db_path!r}. Another process may already be using it. "
            "Stop the running backend or use a different Kuzu path before retrying."
        ) from error


def _is_repairable_catalog_error(error: Exception) -> bool:
    message = str(error)
    return (
        ("Load table failed:" in message and "catalog" in message)
        or "not a valid Kuzu database file" in message
    )


def _next_invalid_backup_path(db_path: str) -> str:
    timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
    candidate = f"{db_path}.invalid.{timestamp}"
    counter = 1
    while os.path.exists(candidate):
        candidate = f"{db_path}.invalid.{timestamp}.{counter}"
        counter += 1
    return candidate


def _backup_invalid_database(db_path: str) -> str | None:
    if not os.path.exists(db_path):
        return None

    backup_path = _next_invalid_backup_path(db_path)
    shutil.move(db_path, backup_path)
    return backup_path


def _init_schema(conn: kuzu.Connection) -> None:
    conn.execute(
        "CREATE NODE TABLE IF NOT EXISTS Concept(name STRING, colorScore DOUBLE, community_id INT64, PRIMARY KEY (name))"
    )
    # Add community_id to existing databases that predate this column.
    try:
        conn.execute("ALTER TABLE Concept ADD community_id INT64 DEFAULT -1")
    except Exception:
        pass  # Column already present — nothing to do.
    conn.execute(
        "CREATE NODE TABLE IF NOT EXISTS Project(name STRING, status STRING, PRIMARY KEY (name))"
    )
    conn.execute(
        "CREATE NODE TABLE IF NOT EXISTS Task(task_id STRING, name STRING, status STRING, PRIMARY KEY (task_id))"
    )
    conn.execute(
        "CREATE NODE TABLE IF NOT EXISTS Reflection(reflection_id STRING, text STRING, PRIMARY KEY (reflection_id))"
    )
    conn.execute(
        "CREATE REL TABLE IF NOT EXISTS RELATED_TO(FROM Concept TO Concept, reason STRING, weight DOUBLE, edge_type STRING)"
    )
    # Add weight to existing databases that predate this column.
    try:
        conn.execute("ALTER TABLE RELATED_TO ADD weight DOUBLE DEFAULT 1.0")
    except Exception:
        pass  # Column already present.
    # Add edge_type to existing databases that predate this column.
    try:
        conn.execute("ALTER TABLE RELATED_TO ADD edge_type STRING DEFAULT 'RELATED_TO'")
    except Exception:
        pass  # Column already present.
    conn.execute("CREATE REL TABLE IF NOT EXISTS APPLIED_TO_PROJECT(FROM Concept TO Project)")
    conn.execute("CREATE REL TABLE IF NOT EXISTS GENERATED_TASK(FROM Concept TO Task)")
    conn.execute("CREATE REL TABLE IF NOT EXISTS SPARKED_REFLECTION(FROM Concept TO Reflection)")
    conn.execute("CREATE REL TABLE IF NOT EXISTS HAS_TASK(FROM Project TO Task)")


def _normalize_concepts(value) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    return [str(item) for item in list(value)]


def _restore_graph_from_lancedb(conn: kuzu.Connection, lance_db_path: str) -> tuple[int, int]:
    from backend.db.lance import init_lancedb
    from backend.services.clustering import run_leiden_clustering

    try:
        _db, table = init_lancedb(lance_db_path)
        chunks_df = table.to_pandas()
    except Exception as error:
        logger.warning(
            "Failed to read LanceDB while repairing Kuzu at %r: %s",
            lance_db_path,
            error,
        )
        return 0, 0

    if chunks_df.empty:
        return 0, 0

    concept_names = sorted(
        {
            concept
            for concepts in chunks_df["concepts"].tolist()
            for concept in _normalize_concepts(concepts)
        }
    )
    for concept_name in concept_names:
        conn.execute(
            "MERGE (c:Concept {name: $name}) "
            "SET c.colorScore = $color_score",
            parameters={"name": concept_name, "color_score": REPAIRED_COLOR_SCORE},
        )

    edge_pairs: set[tuple[str, str]] = set()
    for _doc_id, group in chunks_df.groupby("doc_id", sort=False):
        doc_concepts = sorted(
            {
                concept
                for concepts in group["concepts"].tolist()
                for concept in _normalize_concepts(concepts)
            }
        )
        for from_concept, to_concept in combinations(doc_concepts, 2):
            edge_pairs.add((from_concept, to_concept))
            conn.execute(
                "MATCH (a:Concept {name: $from_c}), (b:Concept {name: $to_c}) "
                "MERGE (a)-[r:RELATED_TO]->(b) "
                "ON CREATE SET r.weight = 1.0, r.reason = $reason "
                "ON MATCH SET r.weight = r.weight + 1.0",
                parameters={
                    "from_c": from_concept,
                    "to_c": to_concept,
                    "reason": REPAIRED_EDGE_REASON,
                },
            )

    community_map = run_leiden_clustering(conn)
    update_node_communities(conn, community_map)
    return len(concept_names), len(edge_pairs)


def _repair_database(db_path: str, lance_db_path: str) -> kuzu.Database:
    backup_path = _backup_invalid_database(db_path)
    if backup_path is not None:
        logger.warning(
            "Backed up invalid Kuzu database from %r to %r before rebuilding.",
            db_path,
            backup_path,
        )

    db = kuzu.Database(db_path)
    conn = kuzu.Connection(db)
    try:
        _init_schema(conn)
        restored_concepts, restored_edges = _restore_graph_from_lancedb(conn, lance_db_path)
    finally:
        conn.close()

    logger.warning(
        "Rebuilt shared Kuzu database at %r with %d concepts and %d relationships restored from LanceDB.",
        db_path,
        restored_concepts,
        restored_edges,
    )
    return db


def get_kuzu_engine(
    db_path: str = "./data/kuzu",
    lance_db_path: str = "./data/lancedb",
) -> kuzu.Database:
    """Return the shared Database, repairing a broken catalog from LanceDB if needed."""
    global _db_instance
    if _db_instance is not None:
        return _db_instance

    with _db_instance_lock:
        if _db_instance is None:
            parent_dir = os.path.dirname(db_path)
            if parent_dir:
                os.makedirs(parent_dir, exist_ok=True)
            try:
                _db_instance = _open_database(db_path)
                conn = kuzu.Connection(_db_instance)
                _init_schema(conn)
                conn.close()
            except RuntimeError as error:
                if not _is_repairable_catalog_error(error):
                    raise
                _db_instance = _repair_database(db_path, lance_db_path)

    return _db_instance


def get_db_connection():
    """FastAPI Dependency: yields a fresh Connection per request, closes when done."""
    db = get_kuzu_engine()
    conn = kuzu.Connection(db)
    try:
        yield conn
    finally:
        conn.close()


def update_node_communities(conn: kuzu.Connection, community_map: dict[str, int]) -> None:
    """Write Leiden community IDs back to Concept nodes in bulk."""
    for name, community_id in community_map.items():
        conn.execute(
            "MATCH (c:Concept {name: $name}) SET c.community_id = $community_id",
            parameters={"name": name, "community_id": community_id},
        )


def init_kuzu(db_path: str = "./data/kuzu"):
    """Open a Kuzu DB at an arbitrary path, initialise its schema, and return (db, conn).

    Intentionally does NOT touch the global singleton so tests can call this with
    a temp path without interfering with the engine used by the API.
    """
    parent_dir = os.path.dirname(db_path)
    if parent_dir:
        os.makedirs(parent_dir, exist_ok=True)

    db = _open_database(db_path)
    conn = kuzu.Connection(db)
    _init_schema(conn)
    return db, conn
