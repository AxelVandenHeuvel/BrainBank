import json
import os

from google import genai

_client = None


def _get_client():
    global _client
    if _client is None:
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise ValueError("GEMINI_API_KEY environment variable is required")
        _client = genai.Client(api_key=api_key)
    return _client


def extract_concepts(text: str, doc_name: str) -> dict:
    client = _get_client()
    prompt = (
        "Analyze the following document and extract:\n"
        '1. A list of "Core Concepts" (key topics, ideas, or entities)\n'
        '2. A list of "Relationships" between concepts\n\n'
        f"Document title: {doc_name}\n"
        f"Document text:\n{text}\n\n"
        "Respond ONLY with valid JSON in this format:\n"
        '{"concepts": ["concept1", "concept2"], '
        '"relationships": [{"from": "concept1", "to": "concept2", '
        '"relationship": "related_to"}]}'
    )
    response = client.models.generate_content(
        model="gemini-1.5-flash", contents=prompt
    )
    raw = response.text.strip()
    # Strip markdown code fences if present
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1]
        raw = raw.rsplit("```", 1)[0]
    return json.loads(raw)


def generate_answer(query: str, context: str, concepts: list[str]) -> str:
    client = _get_client()
    prompt = (
        "Answer the following question based on the provided context.\n\n"
        f"Question: {query}\n\n"
        f"Context:\n{context}\n\n"
        f"Related concepts: {', '.join(concepts)}\n\n"
        "Provide a grounded answer based only on the context provided."
    )
    response = client.models.generate_content(
        model="gemini-1.5-flash", contents=prompt
    )
    return response.text
