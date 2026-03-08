import os
import threading

import kuzu

# The single Database instance that holds the OS file lock.
# Opened exactly once; all connections are spawned from it.
_db_instance = None
_db_instance_lock = threading.Lock()


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
    # Add edge_type to existing databases that predate this column.
    try:
        conn.execute("ALTER TABLE RELATED_TO ADD edge_type STRING DEFAULT 'RELATED_TO'")
    except Exception:
        pass  # Column already present.
    conn.execute("CREATE REL TABLE IF NOT EXISTS APPLIED_TO_PROJECT(FROM Concept TO Project)")
    conn.execute("CREATE REL TABLE IF NOT EXISTS GENERATED_TASK(FROM Concept TO Task)")
    conn.execute("CREATE REL TABLE IF NOT EXISTS SPARKED_REFLECTION(FROM Concept TO Reflection)")
    conn.execute("CREATE REL TABLE IF NOT EXISTS HAS_TASK(FROM Project TO Task)")


def get_kuzu_engine(db_path: str = "./data/kuzu") -> kuzu.Database:
    """Return the singleton Database, opening and initialising it on first call."""
    global _db_instance
    if _db_instance is not None:
        return _db_instance

    with _db_instance_lock:
        if _db_instance is None:
            parent_dir = os.path.dirname(db_path)
            if parent_dir:
                os.makedirs(parent_dir, exist_ok=True)
            _db_instance = _open_database(db_path)
            conn = kuzu.Connection(_db_instance)
            _init_schema(conn)
            conn.close()

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
