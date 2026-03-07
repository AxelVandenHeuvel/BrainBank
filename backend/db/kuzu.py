import kuzu


def init_kuzu(db_path: str = "./data/kuzu"):
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
    return db, conn
