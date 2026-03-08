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
EXTRACTION_MIN_CONCEPTS = 4
EXTRACTION_MAX_CONCEPTS = 8


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


def _generate_with_current_provider(prompt: str) -> str:
    if _get_llm_provider() == "ollama":
        return _generate_ollama_response(prompt)

    client = _get_client()
    response = client.models.generate_content(
        model=_get_model_name(), contents=prompt
    )
    return response.text


def _parse_json_response(raw_text: str) -> dict:
    raw = raw_text.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1]
        raw = raw.rsplit("```", 1)[0]
    return json.loads(raw.strip())


def _build_extraction_prompt(text: str, doc_name: str) -> str:
    return (
        "You extract concepts for a knowledge-graph-driven notes system.\n"
        "Goal: produce concepts that create useful cross-document connections without noisy one-off terms.\n\n"
        "Concept selection rules:\n"
        f"- Return between {EXTRACTION_MIN_CONCEPTS} and {EXTRACTION_MAX_CONCEPTS} concepts when enough signal exists.\n"
        "- Prefer a balanced set: 1-2 high-level anchor concepts and 2-6 specific method/entity concepts.\n"
        "- Use noun phrases (1-4 words), Title Case, and stable canonical wording.\n"
        "- Keep concepts that are reusable across notes; avoid dates, course admin terms, and vague words.\n"
        "- Include key techniques/rules when they materially matter to the note.\n\n"
        "Relationship selection rules:\n"
        "- Return 3-10 directed relationships between returned concepts.\n"
        "- Use concise relationship labels (1-4 words) that explain why the concepts connect.\n"
        "- Do not invent concepts not in the concept list.\n\n"
        f"Document title: {doc_name}\n"
        f"Document text:\n{text}\n\n"
        "Respond ONLY with valid JSON using this exact shape:\n"
        "{\n"
        '  "concepts": ["Concept 1", "Concept 2"],\n'
        '  "relationships": [\n'
        '    {"from": "Concept 1", "to": "Concept 2", "relationship": "supports"}\n'
        "  ]\n"
        "}\n"
    )


def extract_concepts(text: str, doc_name: str) -> dict:
    client = _get_client()
    prompt = _build_extraction_prompt(text=text, doc_name=doc_name)
    response = client.models.generate_content(
        model=_get_model_name(), contents=prompt
    )
    return _parse_json_response(response.text)


def _format_history(history: list[dict]) -> str:
    lines = []
    for turn in history:
        role = turn.get("role", "user").capitalize()
        lines.append(f"{role}: {turn.get('content', '')}")
    return "\n".join(lines)


def generate_answer(query: str, context: str, concepts: list[str], history: list[dict] | None = None) -> str:
    history_section = ""
    if history:
        history_section = (
            "Conversation history (use this to resolve references like 'it', 'that', 'the second one'):\n"
            f"{_format_history(history)}\n\n"
        )

    prompt = (
        "Answer the following question based on the provided context.\n\n"
        f"{history_section}"
        f"Question: {query}\n\n"
        f"Context:\n{context}\n\n"
        f"Related concepts: {', '.join(concepts)}\n\n"
        "Provide a grounded answer based only on the context provided."
    )

    return _generate_with_current_provider(prompt)


def generate_partial_answer(query: str, summary: str, member_concepts: list[str]) -> str:
    prompt = (
        "You are answering a corpus-level question from one graph community.\n\n"
        f"Question: {query}\n\n"
        f"Community summary:\n{summary}\n\n"
        f"Member concepts: {', '.join(member_concepts)}\n\n"
        "Answer only from this summary. Keep the answer concise and grounded."
    )
    return _generate_with_current_provider(prompt)


def synthesize_answers(query: str, partial_answers: list[str]) -> str:
    prompt = (
        "Synthesize the following community-level answers into one grounded answer.\n\n"
        f"Question: {query}\n\n"
        "Partial answers:\n"
        f"{chr(10).join(partial_answers)}\n\n"
        "Combine overlaps, keep the final answer coherent, and avoid adding unsupported facts."
    )
    return _generate_with_current_provider(prompt)


def generate_community_summary(
    community_id: str,
    member_concepts: list[str],
    representative_evidence: list[str],
) -> str:
    prompt = (
        "You are summarizing a graph community for retrieval.\n\n"
        f"Community ID: {community_id}\n"
        f"Member concepts: {', '.join(member_concepts)}\n\n"
        "Representative evidence:\n"
        f"{chr(10).join(representative_evidence)}\n\n"
        "Write a concise summary of the main themes and how the concepts relate."
    )
    return _generate_with_current_provider(prompt)


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
