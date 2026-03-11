"""Migrate existing LanceDB documents to the file-system-first layout.

Reads all chunks from LanceDB, groups them by doc_id, writes one Markdown file
per document, and registers each file in the Manifest.  Documents already
present in the Manifest are skipped so the script is safe to run repeatedly.
"""

import os

from backend.db.lance import init_lancedb
from backend.db.manifest import Manifest
from backend.services.notes_fs import content_hash_bytes, write_note


def migrate_lancedb_to_filesystem(lance_path: str, notes_dir: str) -> dict:
    """Migrate documents from LanceDB into the notes directory.

    Returns a dict with keys ``migrated`` and ``skipped``.
    """
    _, table = init_lancedb(lance_path)

    try:
        df = table.to_pandas()
    except Exception:
        return {"migrated": 0, "skipped": 0}

    if df.empty:
        return {"migrated": 0, "skipped": 0}

    manifest = Manifest(notes_dir)

    # Group chunks by doc_id, preserving insertion order
    docs: dict[str, dict] = {}
    for _, row in df.iterrows():
        doc_id = row["doc_id"]
        if doc_id not in docs:
            docs[doc_id] = {"doc_name": row["doc_name"], "chunks": []}
        docs[doc_id]["chunks"].append(row["text"])

    migrated = 0
    skipped = 0

    for doc_id, info in docs.items():
        if manifest.get(doc_id) is not None:
            skipped += 1
            continue

        text = "\n\n".join(info["chunks"])
        file_path = write_note(notes_dir, info["doc_name"], text)
        content_hash = content_hash_bytes(text.encode())

        manifest.upsert(
            doc_id=doc_id,
            file_path=file_path,
            content_hash=content_hash,
            is_managed=True,
            status="indexed",
        )
        migrated += 1

    manifest.close()
    return {"migrated": migrated, "skipped": skipped}
