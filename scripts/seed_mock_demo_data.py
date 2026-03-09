#!/usr/bin/env python3
"""
Seed Mock Demo Data
===================
WHEN TO USE: To load the curated hackathon demo dataset with pre-defined
concepts, edges, and community summaries. Good for demos and UI development.
Skips documents that already exist, so it's safe to run multiple times.

Usage:
    python scripts/seed_mock_demo_data.py
"""
import argparse
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]

if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.sample_data.mock_demo import seed_mock_demo_data


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Seed local LanceDB and Kuzu with the BrainBank hackathon demo dataset.",
    )
    parser.add_argument("--lance-db-path", default="./data/lancedb")
    parser.add_argument("--kuzu-db-path", default="./data/kuzu")
    args = parser.parse_args()

    summary = seed_mock_demo_data(
        lance_db_path=args.lance_db_path,
        kuzu_db_path=args.kuzu_db_path,
    )
    print(
        "Seeded "
        f"{summary['seeded_documents']} demo documents, skipped "
        f"{summary['skipped_documents']} existing documents, "
        f"wrote {summary['community_summaries']} community summaries."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
