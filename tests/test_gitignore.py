from pathlib import Path
import subprocess

import pytest


REPO_ROOT = Path(__file__).resolve().parents[1]


def is_ignored(path: str) -> bool:
    result = subprocess.run(
        ["git", "check-ignore", path],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    return result.returncode == 0


@pytest.mark.parametrize(
    ("path", "expected"),
    [
        (".env", True),
        (".venv/bin/python", True),
        (".pytest_cache/README.md", True),
        ("backend/__pycache__/api.cpython-312.pyc", True),
        ("backend/dist/brainbank-backend", True),
        ("build/brainbank-backend/EXE-00.toc", True),
        ("data/kuzu", True),
        ("data/kuzu.wal", True),
        ("data/lancedb/chunks.lance/_versions/1.manifest", True),
        ("tmp/debug-lancedb/chunks.lance/data/1.lance", True),
        ("frontend/electron/bin/brainbank-backend", True),
        ("backend/server.py", False),
        ("brainbank-backend.spec", False),
        ("frontend/electron/main.cjs", False),
        ("sample_data/example.md", False),
    ],
)
def test_gitignore_matches_repo_artifact_policy(path: str, expected: bool):
    assert is_ignored(path) is expected
