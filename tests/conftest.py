import hashlib
import os
import shutil
import tempfile

import pytest


@pytest.fixture
def tmp_data_dir():
    """Provide a temporary directory for test databases."""
    d = tempfile.mkdtemp()
    yield d
    shutil.rmtree(d)


@pytest.fixture
def lance_path(tmp_data_dir):
    return os.path.join(tmp_data_dir, "lancedb")


@pytest.fixture
def kuzu_path(tmp_data_dir):
    return os.path.join(tmp_data_dir, "kuzu")


def mock_embed_texts(texts: list[str]) -> list[list[float]]:
    """Deterministic mock embeddings based on text hash. 384-dim vectors."""
    vectors = []
    for text in texts:
        h = hashlib.sha256(text.encode()).digest()
        vec = [float(b) / 255.0 for b in h]
        # Pad or truncate to 384 dims
        vec = (vec * (384 // len(vec) + 1))[:384]
        vectors.append(vec)
    return vectors


def mock_embed_query(query: str) -> list[float]:
    return mock_embed_texts([query])[0]


def mock_extract_concepts(text: str, doc_name: str) -> dict:
    """Mock LLM concept extraction."""
    return {
        "concepts": ["Calculus", "Derivatives", "Integrals"],
        "relationships": [
            {"from": "Calculus", "to": "Derivatives", "relationship": "contains"},
            {"from": "Calculus", "to": "Integrals", "relationship": "contains"},
            {"from": "Derivatives", "to": "Integrals", "relationship": "related_to"},
        ],
    }


def mock_generate_answer(query: str, context: str, concepts: list[str]) -> str:
    return f"Mock answer for: {query}. Based on {len(concepts)} concepts."
