import os
import kuzu

# The single Database instance that holds the OS file lock.
# Opened exactly once; all connections are spawned from it.
_db_instance = None


def _init_schema(conn: kuzu.Connection) -> None:
    conn.execute(
        "CREATE NODE TABLE IF NOT EXISTS Concept(name STRING, colorScore DOUBLE, PRIMARY KEY (name))"
    )
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
        "CREATE REL TABLE IF NOT EXISTS RELATED_TO(FROM Concept TO Concept, reason STRING)"
    )
    conn.execute("CREATE REL TABLE IF NOT EXISTS APPLIED_TO_PROJECT(FROM Concept TO Project)")
    conn.execute("CREATE REL TABLE IF NOT EXISTS GENERATED_TASK(FROM Concept TO Task)")
    conn.execute("CREATE REL TABLE IF NOT EXISTS SPARKED_REFLECTION(FROM Concept TO Reflection)")
    conn.execute("CREATE REL TABLE IF NOT EXISTS HAS_TASK(FROM Project TO Task)")


def get_kuzu_engine(db_path: str = "./data/kuzu") -> kuzu.Database:
    """Return the singleton Database, opening and initialising it on first call."""
    global _db_instance
    if _db_instance is None:
        parent_dir = os.path.dirname(db_path)
        if parent_dir:
            os.makedirs(parent_dir, exist_ok=True)
        _db_instance = kuzu.Database(db_path)
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


def init_kuzu(db_path: str = "./data/kuzu"):
    """Open a Kuzu DB at an arbitrary path, initialise its schema, and return (db, conn).

    Intentionally does NOT touch the global singleton so tests can call this with
    a temp path without interfering with the engine used by the API.
    """
    parent_dir = os.path.dirname(db_path)
    if parent_dir:
        os.makedirs(parent_dir, exist_ok=True)

    db = kuzu.Database(db_path)
    conn = kuzu.Connection(db)
    _init_schema(conn)
    return db, conn
