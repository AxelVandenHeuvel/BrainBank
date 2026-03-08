#!/usr/bin/env python3
import argparse
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]

if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.graph_visualization import render_concept_graph


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Print the current concept graph as an ASCII adjacency tree.",
    )
    parser.add_argument(
        "--kuzu-db-path",
        default="./data/kuzu",
        help="Path to the Kuzu database directory.",
    )
    parser.add_argument(
        "--lance-db-path",
        default="./data/lancedb",
        help="Path to the LanceDB directory used for fallback graph reconstruction.",
    )
    args = parser.parse_args()
    try:
        print(render_concept_graph(args.kuzu_db_path, args.lance_db_path))
    except RuntimeError as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
