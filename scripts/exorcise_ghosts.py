#!/usr/bin/env python3
"""One-shot script to replace known ghost concepts in LanceDB chunk metadata."""
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]

if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import lancedb

GHOST_MAPPING: dict[str, str] = {
    "Free Will": "Philosophy",
    "Maxwell's Equations": "Physics",
    "Rationalism": "Philosophy",
    "Thermodynamics": "Physics",
}


def _escape_sql(value: str) -> str:
    return value.replace("'", "''")


def exorcise_ghosts(lance_db_path: str = "./data/lancedb") -> dict[str, int]:
    db = lancedb.connect(lance_db_path)
    chunks_table = db.open_table("chunks")

    replaced = 0
    for ghost, target in GHOST_MAPPING.items():
        escaped_ghost = _escape_sql(ghost)
        escaped_target = _escape_sql(target)

        result = chunks_table.update(
            where=f"list_contains(concepts, '{escaped_ghost}')",
            values_sql={
                "concepts": f"array_replace(concepts, '{escaped_ghost}', '{escaped_target}')"
            },
        )
        if result.rows_updated > 0:
            print(f"  Replaced '{ghost}' -> '{target}' in {result.rows_updated} chunks")
            replaced += 1

    return {"replaced": replaced}


def main() -> int:
    print("Exorcising ghost concepts from LanceDB...")
    summary = exorcise_ghosts()
    print(f"\nDone! Replaced {summary['replaced']} ghost concepts.")
    print("Re-run 'python scripts/audit_knowledge_density.py' to confirm 0 Ghosts.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
