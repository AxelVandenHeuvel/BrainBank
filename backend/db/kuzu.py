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
    
    # --- 1. CORE NODES ---
    # The central hub
    # NOTE: if you have an existing ./data/kuzu without colorScore, delete that
    # directory and re-ingest — Kuzu does not support ALTER TABLE ADD COLUMN.
    conn.execute(
        "CREATE NODE TABLE IF NOT EXISTS Concept(name STRING, colorScore DOUBLE, PRIMARY KEY (name))"
    )
    
    # The tangible "worked on" items
    conn.execute(
        "CREATE NODE TABLE IF NOT EXISTS Project(name STRING, status STRING, PRIMARY KEY (name))"
    )
    conn.execute(
        "CREATE NODE TABLE IF NOT EXISTS Task(task_id STRING, name STRING, status STRING, PRIMARY KEY (task_id))"
    )
    conn.execute(
        "CREATE NODE TABLE IF NOT EXISTS Reflection(reflection_id STRING, text STRING, PRIMARY KEY (reflection_id))"
    )
    
    # --- 2. THE CONCEPTUAL WEB ---
    # Concept <-> Concept relationships. The 'reason' property stores exactly why they connect.
    conn.execute(
        "CREATE REL TABLE IF NOT EXISTS RELATED_TO("
        "FROM Concept TO Concept, reason STRING)"
    )
    
    # --- 3. THE "WORKED ON" BRANCHES ---
    # Linking concepts to the actual work
    conn.execute("CREATE REL TABLE IF NOT EXISTS APPLIED_TO_PROJECT(FROM Concept TO Project)")
    conn.execute("CREATE REL TABLE IF NOT EXISTS GENERATED_TASK(FROM Concept TO Task)")
    conn.execute("CREATE REL TABLE IF NOT EXISTS SPARKED_REFLECTION(FROM Concept TO Reflection)")
    
    # --- 4. PROJECT HIERARCHY (Optional but helpful) ---
    conn.execute("CREATE REL TABLE IF NOT EXISTS HAS_TASK(FROM Project TO Task)")
    
    return db, conn