import math

from sentence_transformers import SentenceTransformer

_model = None

VECTOR_DIM = 384  # all-MiniLM-L6-v2

_ANCHOR_LOGICAL = "Mathematical, analytical, structured, logical, technical computer science."
_ANCHOR_CREATIVE = "Artistic, intuitive, abstract, creative, philosophical storytelling."

# Cached after first call so anchors are only embedded once per process.
_anchor_cache: dict[str, list[float]] = {}


def _get_model():
    global _model
    if _model is None:
        _model = SentenceTransformer("all-MiniLM-L6-v2")
    return _model


def embed_texts(texts: list[str]) -> list[list[float]]:
    model = _get_model()
    embeddings = model.encode(texts)
    return embeddings.tolist()


def embed_query(query: str) -> list[float]:
    return embed_texts([query])[0]


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    mag_a = math.sqrt(sum(x * x for x in a))
    mag_b = math.sqrt(sum(x * x for x in b))
    if mag_a < 1e-9 or mag_b < 1e-9:
        return 0.0
    return dot / (mag_a * mag_b)


def _get_anchor_embeddings() -> dict[str, list[float]]:
    if not _anchor_cache:
        vecs = embed_texts([_ANCHOR_LOGICAL, _ANCHOR_CREATIVE])
        _anchor_cache["logical"] = vecs[0]
        _anchor_cache["creative"] = vecs[1]
    return _anchor_cache


def calculate_color_score(concept_name: str) -> float:
    """Return a float in [0.0, 1.0] representing creative vs logical bias.

    0.0 = fully logical/analytical, 1.0 = fully creative/artistic.
    """
    anchors = _get_anchor_embeddings()
    concept_emb = embed_texts([concept_name])[0]
    sim_logical = _cosine_similarity(concept_emb, anchors["logical"])
    sim_creative = _cosine_similarity(concept_emb, anchors["creative"])
    total = sim_logical + sim_creative
    if total < 1e-9:
        return 0.5
    return float(max(0.0, min(1.0, sim_creative / total)))
