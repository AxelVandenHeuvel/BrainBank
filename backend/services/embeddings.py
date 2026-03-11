import math

from sentence_transformers import SentenceTransformer

VECTOR_DIM = 384  # all-MiniLM-L6-v2

_model = None

_ANCHOR_LOGICAL = "Mathematical, analytical, structured, logical, technical computer science."
_ANCHOR_CREATIVE = "Artistic, intuitive, abstract, creative, philosophical storytelling."

# Cached after first call so anchors are only embedded once per process.
_anchor_cache: dict[str, list[float]] = {}


def _get_model():
    global _model
    if _model is None:
        _model = SentenceTransformer(
            'nomic-ai/nomic-embed-text-v1.5', 
            trust_remote_code=True,
        )
    return _model


def embed_texts(texts: list[str]) -> list[list[float]]:
    model = _get_model()
    embeddings = model.encode(texts)
    return embeddings.tolist()


def embed_query(query: str) -> list[float]:
    return embed_texts([query])[0]


def calculate_document_centroid(doc_id: str, table) -> list[float]:
    """Return the mean embedding vector across all chunks for a document."""
    df = table.to_pandas()
    if df.empty:
        return [0.0] * VECTOR_DIM

    doc_rows = df[df["doc_id"] == doc_id]
    if doc_rows.empty:
        return [0.0] * VECTOR_DIM

    vectors = doc_rows["vector"].tolist()
    if not vectors:
        return [0.0] * VECTOR_DIM

    centroid = [0.0] * VECTOR_DIM
    for vector in vectors:
        for index, value in enumerate(vector):
            centroid[index] += float(value)

    count = float(len(vectors))
    return [value / count for value in centroid]


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
