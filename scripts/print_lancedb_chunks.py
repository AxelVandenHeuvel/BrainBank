#!/usr/bin/env python3
import argparse
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]

if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.db.lance import list_chunk_records


def render_chunks(records: list[dict], show_vector: bool = False) -> str:
    if not records:
        return "No chunks found."

    rendered_chunks: list[str] = []
    for record in records:
        concepts = ", ".join(record.get("concepts", [])) or "(none)"
        lines = [
            f"chunk_id: {record['chunk_id']}",
            f"doc_id: {record['doc_id']}",
            f"doc_name: {record['doc_name']}",
            f"concepts: {concepts}",
            f"text: {record['text']}",
        ]
        if show_vector:
            lines.append(f"vector: {record['vector']}")
        rendered_chunks.append("\n".join(lines))
    return "\n\n---\n\n".join(rendered_chunks)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Print chunk records stored in LanceDB.",
    )
    parser.add_argument(
        "--lance-db-path",
        default="./data/lancedb",
        help="Path to the LanceDB directory.",
    )
    parser.add_argument(
        "--doc-id",
        default=None,
        help="Optional document ID filter.",
    )
    parser.add_argument(
        "--show-vector",
        action="store_true",
        help="Include embedding vectors in the output.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    records = list_chunk_records(args.lance_db_path, doc_id=args.doc_id)
    print(render_chunks(records, show_vector=args.show_vector))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
