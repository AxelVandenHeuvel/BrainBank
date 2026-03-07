def chunk_text(text: str, chunk_size: int = 500) -> list[str]:
    """Split text into chunks by paragraphs, respecting chunk_size."""
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    if not paragraphs:
        return [text]

    chunks = []
    current = ""
    for para in paragraphs:
        if current and len(current) + len(para) > chunk_size:
            chunks.append(current)
            current = para
        else:
            current = f"{current}\n\n{para}" if current else para
    if current:
        chunks.append(current)
    return chunks
