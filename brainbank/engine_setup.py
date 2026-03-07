import kuzu
import lancedb
import pyarrow as pa

from brainbank.embeddings import VECTOR_DIM

CHUNKS_SCHEMA = pa.schema(
    [
        pa.field("chunk_id", pa.string()),
        pa.field("doc_id", pa.string()),
        pa.field("text", pa.string()),
        pa.field("vector", pa.list_(pa.float32(), VECTOR_DIM)),
    ]
)


def init_lancedb(db_path: str = "./data/lancedb"):
    db = lancedb.connect(db_path)
    try:
        table = db.open_table("chunks")
    except Exception:
        table = db.create_table("chunks", schema=CHUNKS_SCHEMA)
    return db, table


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
