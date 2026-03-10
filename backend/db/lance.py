import os
import uuid

import lancedb
import pyarrow as pa

from backend.services.embeddings import VECTOR_DIM

# Updated schema to bridge the gap between text chunks and the Kuzu concept graph
CHUNKS_SCHEMA = pa.schema(
    [
        pa.field("chunk_id", pa.string()),
        pa.field("doc_id", pa.string()),
        pa.field("doc_name", pa.string()),
        pa.field("file_path", pa.string()),
        pa.field("text", pa.string()),
        pa.field("concepts", pa.list_(pa.string())),
        pa.field("vector", pa.list_(pa.float32(), VECTOR_DIM)),
    ]
)

DOCUMENT_CENTROIDS_SCHEMA = pa.schema(
    [
        pa.field("doc_id", pa.string()),
        pa.field("doc_name", pa.string()),
        pa.field("file_path", pa.string()),
        pa.field("centroid_vector", pa.list_(pa.float32(), VECTOR_DIM)),
    ]
)

CONCEPT_CENTROIDS_SCHEMA = pa.schema(
    [
        pa.field("concept_name", pa.string()),
        pa.field("centroid_vector", pa.list_(pa.float32(), VECTOR_DIM)),
        pa.field("document_count", pa.int32()),
    ]
)

COMMUNITY_SUMMARIES_SCHEMA = pa.schema(
    [
        pa.field("community_id", pa.string()),
        pa.field("member_concepts", pa.list_(pa.string())),
        pa.field("summary", pa.string()),
        pa.field("summary_vector", pa.list_(pa.float32(), VECTOR_DIM)),
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


def replace_table_records(db, table_name: str, schema: pa.Schema, records: list[dict]):
    try:
        db.drop_table(table_name)
    except Exception:
        pass

    table = db.create_table(table_name, schema=schema)
    if records:
        table.add(records)
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


def delete_document_chunks(db_path: str, doc_id: str) -> int:
    """Delete all chunks and the centroid for a doc_id. Returns count of deleted chunks."""
    db, table = init_lancedb(db_path)

    df = table.to_pandas()
    if df.empty:
        return 0

    mask = df["doc_id"] == doc_id
    deleted_count = int(mask.sum())

    if deleted_count == 0:
        return 0

    # Delete matching chunks from the chunks table
    table.delete(f'doc_id = "{doc_id}"')

    # Delete matching centroid from document_centroids
    try:
        centroids_table = db.open_table("document_centroids")
        centroids_table.delete(f'doc_id = "{doc_id}"')
    except Exception:
        pass

    return deleted_count


def create_document_text(
    db_path: str,
    doc_name: str,
    text: str,
    doc_id: str | None = None,
    file_path: str = "",
) -> str:
    """Create a lightweight document row in LanceDB for draft-style saves."""
    db, table = init_lancedb(db_path)
    centroids_table = db.open_table("document_centroids")

    real_doc_id = doc_id or str(uuid.uuid4())
    zero_vector = [0.0] * VECTOR_DIM

    table.add([{
        "chunk_id": str(uuid.uuid4()),
        "doc_id": real_doc_id,
        "doc_name": doc_name,
        "file_path": file_path,
        "text": text,
        "concepts": [],
        "vector": zero_vector,
    }])

    centroids_table.add([{
        "doc_id": real_doc_id,
        "doc_name": doc_name,
        "file_path": file_path,
        "centroid_vector": zero_vector,
    }])

    print(f"[lance] CREATED doc_id={real_doc_id} name={doc_name!r} text_len={len(text)} (concepts=[], zero_vector)")
    return real_doc_id


def update_document_text(db_path: str, doc_id: str, doc_name: str, new_text: str) -> bool:
    """Quick-update a document's text in LanceDB without re-embedding or re-ingesting.
    Replaces chunk texts with a single merged chunk. Returns True if doc existed."""
    db, table = init_lancedb(db_path)
    df = table.to_pandas()
    if df.empty:
        return False

    mask = df["doc_id"] == doc_id
    if not mask.any():
        return False

    # Preserve existing concepts and reuse first chunk's vector as approximation
    existing = df[mask]
    all_concepts = existing["concepts"].explode().dropna().unique().tolist()
    first_vector = existing.iloc[0]["vector"]
    first_chunk_id = existing.iloc[0]["chunk_id"]

    # Delete old chunks and insert single merged chunk
    file_path = existing.iloc[0].get("file_path", "") if "file_path" in existing.columns else ""
    table.delete(f'doc_id = "{doc_id}"')
    table.add([{
        "chunk_id": first_chunk_id,
        "doc_id": doc_id,
        "doc_name": doc_name,
        "file_path": file_path,
        "text": new_text,
        "concepts": all_concepts,
        "vector": first_vector,
    }])

    try:
        centroids_table = db.open_table("document_centroids")
        centroids_table.delete(f'doc_id = "{doc_id}"')
        centroids_table.add([{
            "doc_id": doc_id,
            "doc_name": doc_name,
            "file_path": file_path,
            "centroid_vector": first_vector,
        }])
    except Exception as e:
        print(f"[lance] WARNING: centroids update failed for doc_id={doc_id}: {e}")

    print(f"[lance] UPDATED doc_id={doc_id} name={doc_name!r} text_len={len(new_text)} concepts={all_concepts}")
    return True


_default_lancedb_cache: dict[str, tuple] = {}


def init_lancedb(db_path: str = "./data/lancedb"):
    resolved = os.path.abspath(db_path)
    if resolved in _default_lancedb_cache:
        print(f"[lance] CACHE HIT for {resolved}")
        return _default_lancedb_cache[resolved]
    print(f"[lance] CACHE MISS — opening new connection for {resolved}")

    os.makedirs(db_path, exist_ok=True)

    db = lancedb.connect(db_path)
    chunks_table = _open_or_create_table(db, "chunks", CHUNKS_SCHEMA)
    _open_or_create_table(db, "document_centroids", DOCUMENT_CENTROIDS_SCHEMA)
    _open_or_create_table(db, "concept_centroids", CONCEPT_CENTROIDS_SCHEMA)
    _open_or_create_table(db, "community_summaries", COMMUNITY_SUMMARIES_SCHEMA)
    result = (db, chunks_table)
    _default_lancedb_cache[resolved] = result
    return result
