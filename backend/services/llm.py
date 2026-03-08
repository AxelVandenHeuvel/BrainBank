import json
import os
from urllib.request import Request, urlopen

from dotenv import load_dotenv
from google import genai

load_dotenv()

_client = None
DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"
DEFAULT_OLLAMA_URL = "http://localhost:11434"
DEFAULT_OLLAMA_MODEL = "llama3.2:3b"


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


def _get_llm_provider() -> str:
    return os.environ.get("BRAINBANK_LLM_PROVIDER", "gemini").lower()


def _get_test_llm_provider() -> str:
    return os.environ.get("TEST_LLM_PROVIDER", "gemini").lower()


def _generate_ollama_response(prompt: str) -> str:
    payload = json.dumps(
        {
            "model": os.environ.get("OLLAMA_MODEL", DEFAULT_OLLAMA_MODEL),
            "prompt": prompt,
            "stream": False,
        }
    ).encode("utf-8")
    request = Request(
        f"{os.environ.get('OLLAMA_BASE_URL', DEFAULT_OLLAMA_URL)}/api/generate",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request) as response:
        data = json.loads(response.read().decode("utf-8"))
    return data["response"]


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
        '1. A list of meaningful core concepts. These are the main ideas, topics, or entities that have clear conceptual meaning. Nothing like dates or times should be extracted. Instead, extract meaningful ideas such as "Machine Learning", "Meal Prep", "Ideas on Death", etc.\n'
        f"Document title: {doc_name}\n"
        f"Document text:\n{text}\n\n"
        "Respond ONLY with valid JSON in this format:\n"
        '{"concepts": ["concept1", "concept2", ...], '
    )
    response = client.models.generate_content(
        model=_get_model_name(), contents=prompt
    )
    return _parse_json_response(response.text)

def generate_answer(query: str, context: str, concepts: list[str]) -> str:
    prompt = (
        "Answer the following question based on the provided context.\n\n"
        f"Question: {query}\n\n"
        f"Context:\n{context}\n\n"
        f"Related concepts: {', '.join(concepts)}\n\n"
        "Provide a grounded answer based only on the context provided."
    )

    if _get_llm_provider() == "ollama":
        return _generate_ollama_response(prompt)

    client = _get_client()
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

    if _get_test_llm_provider() == "ollama":
        return _generate_ollama_response(question)

    client = _get_client()
    response = client.models.generate_content(
        model=_get_model_name(), contents=prompt
    )
    return response.text
