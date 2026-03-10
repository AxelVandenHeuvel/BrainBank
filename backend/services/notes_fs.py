"""File-system operations for markdown notes.

All note persistence goes through this module. The API endpoints write here,
and the SyncAgent watches for changes to trigger ingestion.
"""

import hashlib
import os
import re


def _sanitize_filename(title: str) -> str:
    """Remove characters that are unsafe in file names."""
    return re.sub(r'[<>:"/\\|?*]', '_', title).strip()


def note_path(notes_dir: str, title: str) -> str:
    """Return the full path for a note with the given title."""
    return os.path.join(notes_dir, f"{_sanitize_filename(title)}.md")


def write_note(notes_dir: str, title: str, text: str) -> str:
    """Write a markdown note to disk. Returns the file path."""
    os.makedirs(notes_dir, exist_ok=True)
    path = note_path(notes_dir, title)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)
    return path


def read_note(notes_dir: str, title: str) -> tuple[str, str] | None:
    """Read a note by title. Returns (title, text) or None if missing."""
    path = note_path(notes_dir, title)
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        return title, f.read()


def list_notes(notes_dir: str) -> list[dict]:
    """List all .md notes in the directory. Returns list of {title, file_path}."""
    if not os.path.isdir(notes_dir):
        return []
    results = []
    for entry in os.listdir(notes_dir):
        if not entry.endswith(".md"):
            continue
        title = entry[:-3]  # strip .md
        results.append({
            "title": title,
            "file_path": os.path.join(notes_dir, entry),
        })
    return results


def content_hash_file(path: str) -> str:
    """Return the SHA-256 hex digest of a file's contents."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def content_hash_bytes(data: bytes) -> str:
    """Return the SHA-256 hex digest of raw bytes."""
    return hashlib.sha256(data).hexdigest()


def delete_note(notes_dir: str, title: str) -> bool:
    """Delete a note file. Returns True if it existed."""
    path = note_path(notes_dir, title)
    if not os.path.exists(path):
        return False
    os.remove(path)
    return True
