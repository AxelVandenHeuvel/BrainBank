import os
import lancedb
import pyarrow as pa

from backend.services.embeddings import VECTOR_DIM

# Updated schema to bridge the gap between text chunks and the Kuzu concept graph
CHUNKS_SCHEMA = pa.schema(
    [
        pa.field("chunk_id", pa.string()),
        pa.field("doc_id", pa.string()),
        pa.field("doc_name", pa.string()),            # NEW: Allows the UI to label the floating document
        pa.field("text", pa.string()),
        pa.field("concepts", pa.list_(pa.string())),  # NEW: The critical link to Kuzu nodes
        pa.field("vector", pa.list_(pa.float32(), VECTOR_DIM)),
    ]
)

def init_lancedb(db_path: str = "./data/lancedb"):
    # Apply the same safeguard we used for Kuzu to prevent IO crashes on fresh clones
    os.makedirs(db_path, exist_ok=True)

    db = lancedb.connect(db_path)
    try:
        table = db.open_table("chunks")
        # If the on-disk schema is missing any required columns, recreate the table.
        existing_cols = set(table.schema.names)
        required_cols = set(CHUNKS_SCHEMA.names)
        if not required_cols.issubset(existing_cols):
            db.drop_table("chunks")
            table = db.create_table("chunks", schema=CHUNKS_SCHEMA)
    except Exception:
        table = db.create_table("chunks", schema=CHUNKS_SCHEMA)
    return db, table