import os

import lancedb
import pyarrow as pa

from backend.services.embeddings import VECTOR_DIM

# Updated schema to bridge the gap between text chunks and the Kuzu concept graph
CHUNKS_SCHEMA = pa.schema(
    [
        pa.field("chunk_id", pa.string()),
        pa.field("doc_id", pa.string()),
        pa.field("doc_name", pa.string()),
        pa.field("text", pa.string()),
        pa.field("concepts", pa.list_(pa.string())),
        pa.field("vector", pa.list_(pa.float32(), VECTOR_DIM)),
    ]
)

DOCUMENT_CENTROIDS_SCHEMA = pa.schema(
    [
        pa.field("doc_id", pa.string()),
        pa.field("doc_name", pa.string()),
        pa.field("centroid_vector", pa.list_(pa.float32(), VECTOR_DIM)),
    ]
)


def _open_or_create_table(db, table_name: str, schema: pa.Schema):
    try:
        table = db.open_table(table_name)
        existing_cols = set(table.schema.names)
        required_cols = set(schema.names)
        if not required_cols.issubset(existing_cols):
            db.drop_table(table_name)
            table = db.create_table(table_name, schema=schema)
    except Exception:
        table = db.create_table(table_name, schema=schema)
    return table


def find_existing_document(title: str, db_path: str = "./data/lancedb") -> dict | None:
    """Check if a document with the given title already exists in LanceDB."""
    _, table = init_lancedb(db_path)
    try:
        df = table.to_pandas()
    except Exception:
        return None
    if df.empty:
        return None
    matches = df[df["doc_name"] == title]
    if matches.empty:
        return None
    row = matches.iloc[0]
    return {"doc_id": row["doc_id"], "doc_name": row["doc_name"]}


def init_lancedb(db_path: str = "./data/lancedb"):
    os.makedirs(db_path, exist_ok=True)

    db = lancedb.connect(db_path)
    chunks_table = _open_or_create_table(db, "chunks", CHUNKS_SCHEMA)
    _open_or_create_table(db, "document_centroids", DOCUMENT_CENTROIDS_SCHEMA)
    return db, chunks_table
