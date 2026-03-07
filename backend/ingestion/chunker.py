import re
import numpy as np
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity

# Initialize this globally so the model stays in memory (it's ~80MB)
# all-MiniLM-L6-v2 is extremely fast and perfect for local hackathon inference
embedder = SentenceTransformer('all-MiniLM-L6-v2')

def semantic_chunk_text(text: str, similarity_threshold: float = 0.5, max_chunk_size: int = 1000) -> list[str]:
    """
    Split text into chunks semantically by detecting topic shifts between sentences.
    Falls back to max_chunk_size if a single topic runs too long.
    """
    # 1. Naive sentence splitting (regex looks for punctuation followed by space)
    sentences = re.split(r'(?<=[.?!])\s+', text.strip())
    sentences = [s for s in sentences if s.strip()]
    
    if not sentences:
        return []
    if len(sentences) == 1:
        return [sentences[0]]

    # 2. Embed all sentences at once (batching is faster)
    embeddings = embedder.encode(sentences)

    chunks = []
    current_chunk = [sentences[0]]
    current_length = len(sentences[0])

    # 3. Iterate through sentences and detect topic boundaries
    for i in range(1, len(sentences)):
        sentence = sentences[i]
        
        # Calculate cosine similarity between previous sentence and current one
        sim = cosine_similarity([embeddings[i-1]], [embeddings[i]])[0][0]

        # Break the chunk IF: 
        # A) The topic shifts (similarity drops below threshold)
        # B) The chunk is getting physically too large for the LLM context
        if sim < similarity_threshold or (current_length + len(sentence)) > max_chunk_size:
            # Topic shift detected or size limit reached; seal the chunk
            chunks.append(" ".join(current_chunk))
            current_chunk = [sentence]
            current_length = len(sentence)
        else:
            # Same topic; append to current chunk
            current_chunk.append(sentence)
            current_length += len(sentence) + 1 # +1 for the space

    # 4. Append the final straggler chunk
    if current_chunk:
        chunks.append(" ".join(current_chunk))

    return chunks

# --- Example Usage ---
# journal_entry = "I learned about Taylor series today in Calc 2. It was really difficult but makes sense for approximating functions. I need to buy groceries later. Milk, eggs, and bread are on the list."
# print(semantic_chunk_text(journal_entry))
# 
# Output: 
# ['I learned about Taylor series today in Calc 2. It was really difficult but makes sense for approximating functions.', 
#  'I need to buy groceries later. Milk, eggs, and bread are on the list.']