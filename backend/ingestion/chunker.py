import re
from sklearn.metrics.pairwise import cosine_similarity

from backend.services.embeddings import _get_model


def semantic_chunk_text(text: str, similarity_threshold: float = 0.5, max_chunk_size: int = 1000) -> list[str]:
    """
    Split text into chunks semantically by detecting topic shifts between sentences.
    Falls back to max_chunk_size if a single topic runs too long.
    """
    sentences = re.split(r'(?<=[.?!])\s+', text.strip())
    sentences = [s for s in sentences if s.strip()]

    if not sentences:
        return []
    if len(sentences) == 1:
        return [sentences[0]]

    model = _get_model()
    embeddings = model.encode(sentences)

    chunks = []
    current_chunk = [sentences[0]]
    current_length = len(sentences[0])

    for i in range(1, len(sentences)):
        sentence = sentences[i]
        sim = cosine_similarity([embeddings[i-1]], [embeddings[i]])[0][0]

        if sim < similarity_threshold or (current_length + len(sentence)) > max_chunk_size:
            chunks.append(" ".join(current_chunk))
            current_chunk = [sentence]
            current_length = len(sentence)
        else:
            current_chunk.append(sentence)
            current_length += len(sentence) + 1

    if current_chunk:
        chunks.append(" ".join(current_chunk))

    return chunks
