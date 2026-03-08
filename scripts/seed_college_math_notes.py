#!/usr/bin/env python3
import argparse
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]

if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.sample_data.college_math_notes import seed_college_math_notes


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Seed local LanceDB and Kuzu with sample college math notes.",
    )
    parser.add_argument("--lance-db-path", default="./data/lancedb")
    parser.add_argument("--kuzu-db-path", default="./data/kuzu")
    args = parser.parse_args()

    summary = seed_college_math_notes(
        lance_db_path=args.lance_db_path,
        kuzu_db_path=args.kuzu_db_path,
    )
    print(
        "Seeded "
        f"{summary['seeded_documents']} sample documents and skipped "
        f"{summary['skipped_documents']} existing documents."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
