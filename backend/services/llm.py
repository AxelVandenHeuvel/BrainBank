import json
import os

from google import genai

_client = None
DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"


def _get_client():
    global _client
    if _client is None:
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise ValueError("GEMINI_API_KEY environment variable is required")
        _client = genai.Client(api_key=api_key)
    return _client


def _get_model_name() -> str:
    return os.environ.get("GEMINI_MODEL", DEFAULT_GEMINI_MODEL)


def _parse_json_response(raw_text: str) -> dict:
    raw = raw_text.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1]
        raw = raw.rsplit("```", 1)[0]
    return json.loads(raw.strip())


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
        model=_get_model_name(), contents=prompt
    )
    return _parse_json_response(response.text)


def extract_knowledge(text: str, doc_name: str) -> dict:
    """Extract all knowledge types from text via Gemini."""
    client = _get_client()
    prompt = (
        "Analyze the following journal entry and extract structured knowledge.\n"
        "Return only valid JSON.\n\n"
        "Extract these fields:\n"
        "- concepts: key ideas, topics, or entities\n"
        "- projects: things being built or actively worked on\n"
        "- tasks: action items or next steps\n"
        "- reflections: insights, lessons, or observations\n"
        "- relationships: connections between any extracted items\n\n"
        "Use concise names. Prefer lowercase snake_case values for relationship types.\n"
        "Valid example relationship types include related_to, has_task, uses_concept, "
        "part_of, inspired_by, depends_on, and learned_from.\n\n"
        f"Document title: {doc_name}\n"
        f"Document text:\n{text}\n\n"
        "Respond ONLY with valid JSON in this format:\n"
        "{"
        '"concepts": ["Calculus", "Linear Algebra"], '
        '"projects": [{"name": "BrainBank", "status": "in_progress"}], '
        '"tasks": [{"name": "Implement graph database", "status": "pending"}], '
        '"reflections": ["Graphs are more powerful than tables for knowledge modeling"], '
        '"relationships": ['
        '{"from": "Calculus", "to": "Linear Algebra", "type": "related_to"}, '
        '{"from": "BrainBank", "to": "Implement graph database", "type": "has_task"}, '
        '{"from": "BrainBank", "to": "Calculus", "type": "uses_concept"}'
        "]"
        "}"
    )
    response = client.models.generate_content(
        model=_get_model_name(), contents=prompt
    )
    return _parse_json_response(response.text)


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
        model=_get_model_name(), contents=prompt
    )
    return response.text


def generate_test_answer(question: str) -> str:
    """Return a direct model response without any retrieval context."""
    prompt = (
        "You are a test route for BrainBank.\n"
        "Answer the user's question directly and briefly.\n\n"
        f"Question: {question}"
    )

    client = _get_client()
    response = client.models.generate_content(
        model=_get_model_name(), contents=prompt
    )
    return response.text
