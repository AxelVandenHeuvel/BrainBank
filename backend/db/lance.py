import lancedb
import pyarrow as pa

from backend.services.embeddings import VECTOR_DIM

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
