#!/usr/bin/env python3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]

if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.retrieval.artifacts import rebuild_graphrag_artifacts


def main() -> int:
    summary = rebuild_graphrag_artifacts()
    print(
        "Rebuilt GraphRAG artifacts: "
        f"{summary['concept_centroids']} concept centroids, "
        f"{summary['communities']} communities"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
