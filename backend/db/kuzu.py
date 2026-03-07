import os
import kuzu

def init_kuzu(db_path: str = "./data/kuzu"):
    # Extract the parent directory ("./data") and ONLY create that.
    parent_dir = os.path.dirname(db_path)
    if parent_dir:
        os.makedirs(parent_dir, exist_ok=True)

    # Now Kuzu can safely create its file inside the data folder
    db = kuzu.Database(db_path)
    conn = kuzu.Connection(db)
    
    conn.execute(
        "CREATE NODE TABLE IF NOT EXISTS Concept(name STRING, PRIMARY KEY (name))"
    )
    conn.execute(
        "CREATE NODE TABLE IF NOT EXISTS Document("
        "doc_id STRING, name STRING, PRIMARY KEY (doc_id))"
    )
    conn.execute(
        "CREATE REL TABLE IF NOT EXISTS MENTIONS("
        "FROM Document TO Concept, chunk_ids STRING[])"
    )
    conn.execute(
        "CREATE REL TABLE IF NOT EXISTS RELATED_TO("
        "FROM Concept TO Concept, relationship STRING)"
    )
    
    # New node tables
    conn.execute(
        "CREATE NODE TABLE IF NOT EXISTS Project(name STRING, status STRING, PRIMARY KEY (name))"
    )
    conn.execute(
        "CREATE NODE TABLE IF NOT EXISTS Task(task_id STRING, name STRING, status STRING, PRIMARY KEY (task_id))"
    )
    conn.execute(
        "CREATE NODE TABLE IF NOT EXISTS Reflection(reflection_id STRING, text STRING, PRIMARY KEY (reflection_id))"
    )
    
    # Concept-to-concept relationships
    conn.execute("CREATE REL TABLE IF NOT EXISTS PART_OF(FROM Concept TO Concept)")
    conn.execute("CREATE REL TABLE IF NOT EXISTS INSPIRED_BY(FROM Concept TO Concept)")
    conn.execute("CREATE REL TABLE IF NOT EXISTS DEPENDS_ON(FROM Concept TO Concept)")
    conn.execute("CREATE REL TABLE IF NOT EXISTS LEARNED_FROM(FROM Concept TO Concept)")
    
    # Project relationships
    conn.execute("CREATE REL TABLE IF NOT EXISTS HAS_TASK(FROM Project TO Task)")
    conn.execute("CREATE REL TABLE IF NOT EXISTS USES_CONCEPT(FROM Project TO Concept)")
    
    # Document relationships
    conn.execute("CREATE REL TABLE IF NOT EXISTS HAS_REFLECTION(FROM Document TO Reflection)")
    conn.execute("CREATE REL TABLE IF NOT EXISTS MENTIONS_PROJECT(FROM Document TO Project)")
    conn.execute("CREATE REL TABLE IF NOT EXISTS MENTIONS_TASK(FROM Document TO Task)")
    
    return db, conn