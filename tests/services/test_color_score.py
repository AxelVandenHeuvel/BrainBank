from unittest.mock import patch

import pytest

from backend.services import embeddings as emb_module
from backend.services.embeddings import calculate_color_score

# Two-dimensional mock vectors so math is predictable
LOGICAL_VEC = [1.0, 0.0]
CREATIVE_VEC = [0.0, 1.0]
NEUTRAL_VEC = [1.0, 1.0]  # equal similarity to both anchors


def _mock_embed(texts: list[str]) -> list[list[float]]:
    result = []
    for t in texts:
        if "Mathematical" in t:
            result.append(LOGICAL_VEC)
        elif "Artistic" in t:
            result.append(CREATIVE_VEC)
        elif t == "Calculus":
            result.append([0.95, 0.05])   # very logical
        elif t == "Poetry":
            result.append([0.05, 0.95])   # very creative
        else:
            result.append(NEUTRAL_VEC)
    return result


@pytest.fixture(autouse=True)
def clear_anchor_cache():
    emb_module._anchor_cache.clear()
    yield
    emb_module._anchor_cache.clear()


class TestCalculateColorScore:
    def test_returns_float_between_0_and_1(self):
        with patch("backend.services.embeddings.embed_texts", side_effect=_mock_embed):
            score = calculate_color_score("neutral")
        assert isinstance(score, float)
        assert 0.0 <= score <= 1.0

    def test_logical_concept_scores_near_zero(self):
        with patch("backend.services.embeddings.embed_texts", side_effect=_mock_embed):
            score = calculate_color_score("Calculus")
        assert score < 0.3

    def test_creative_concept_scores_near_one(self):
        with patch("backend.services.embeddings.embed_texts", side_effect=_mock_embed):
            score = calculate_color_score("Poetry")
        assert score > 0.7

    def test_neutral_concept_scores_near_half(self):
        with patch("backend.services.embeddings.embed_texts", side_effect=_mock_embed):
            score = calculate_color_score("neutral")
        assert 0.4 <= score <= 0.6

    def test_zero_vector_does_not_raise_and_returns_half(self):
        def embed_zero(texts):
            return [[0.0, 0.0] for _ in texts]

        with patch("backend.services.embeddings.embed_texts", side_effect=embed_zero):
            score = calculate_color_score("zero")
        assert score == 0.5
