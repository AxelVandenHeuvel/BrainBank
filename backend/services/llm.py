import json
import logging
import os
import re
import time

from backend.services.llm_providers import get_provider

EXTRACTION_MIN_CONCEPTS = 4
EXTRACTION_MAX_CONCEPTS = 8
MAX_RATE_LIMIT_RETRIES = 4
DEFAULT_BACKOFF_SECONDS = 2.0
MAX_BACKOFF_SECONDS = 60.0
_RETRY_DELAY_PATTERN = re.compile(
    r"retryDelay\"?\s*[:=]\s*\"?(?P<value>\d+(?:\.\d+)?)(?P<unit>ms|s)?\"?",
    re.IGNORECASE,
)

logger = logging.getLogger(__name__)


def _get_llm_provider() -> str:
    return os.environ.get("BRAINBANK_LLM_PROVIDER", "gemini").lower()


def _get_test_llm_provider() -> str:
    return os.environ.get("TEST_LLM_PROVIDER", _get_llm_provider()).lower()


def _parse_json_response(raw_text: str) -> dict:
    raw = raw_text.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1]
        raw = raw.rsplit("```", 1)[0]
    return json.loads(raw.strip())


def _is_rate_limit_error(error: Exception) -> bool:
    message = str(error).lower()
    code = getattr(error, "status_code", None)
    if code is None:
        code = getattr(error, "code", None)

    if str(code) == "429":
        return True

    return (
        "429" in message
        or "resource_exhausted" in message
        or "rate limit" in message
    )


def _retry_delay_from_error(error: Exception) -> float | None:
    for attr_name in ("retry_delay", "retryDelay"):
        value = getattr(error, attr_name, None)
        if value is None:
            continue
        try:
            return max(0.0, float(value))
        except (TypeError, ValueError):
            pass

    match = _RETRY_DELAY_PATTERN.search(str(error))
    if match is None:
        return None

    delay = float(match.group("value"))
    unit = (match.group("unit") or "s").lower()
    if unit == "ms":
        delay /= 1000.0
    return max(0.0, delay)


def _default_backoff_delay(attempt_index: int) -> float:
    return min(DEFAULT_BACKOFF_SECONDS * (2**attempt_index), MAX_BACKOFF_SECONDS)


def generate_text_with_backoff(prompt: str, provider_name: str | None = None, gemini_model: str | None = None) -> str:
    provider = get_provider(provider_name=provider_name) if provider_name else get_provider()

    previous_model = None
    if gemini_model and (provider_name or _get_llm_provider()) == "gemini":
        previous_model = os.environ.get("GEMINI_MODEL")
        os.environ["GEMINI_MODEL"] = gemini_model

    try:
        for attempt_index in range(MAX_RATE_LIMIT_RETRIES + 1):
            try:
                return provider.generate_text(prompt)
            except Exception as error:
                if not _is_rate_limit_error(error) or attempt_index >= MAX_RATE_LIMIT_RETRIES:
                    raise

                retry_delay = _retry_delay_from_error(error)
                if retry_delay is None:
                    retry_delay = _default_backoff_delay(attempt_index)

                logger.warning(
                    "LLM rate limit encountered; waiting %.2f seconds for rate limit reset (retry %d/%d).",
                    retry_delay,
                    attempt_index + 1,
                    MAX_RATE_LIMIT_RETRIES,
                )
                time.sleep(retry_delay)
    finally:
        if gemini_model and (provider_name or _get_llm_provider()) == "gemini":
            if previous_model is None:
                os.environ.pop("GEMINI_MODEL", None)
            else:
                os.environ["GEMINI_MODEL"] = previous_model

    raise RuntimeError("Unreachable retry state while generating LLM text.")


def _build_extraction_prompt(
    text: str,
    doc_name: str,
    existing_concepts: list[str] | None = None,
) -> str:
    existing_concepts_section = ""
    if existing_concepts:
        existing_concepts_section = (
            "Canonical concept mapping rules:\n"
            "- Prioritize mapping extracted ideas to the provided list of existing concepts if they are semantically equivalent.\n"
            "- Only create a new concept name if the idea is genuinely novel to the database.\n"
            f"- Existing concepts: {', '.join(existing_concepts)}\n\n"
        )

    return (
        "You extract concepts for a knowledge-graph-driven notes system.\n"
        "Goal: produce concepts that create useful cross-document connections without noisy one-off terms.\n\n"
        "Concept selection rules:\n"
        f"- Return between {EXTRACTION_MIN_CONCEPTS} and {EXTRACTION_MAX_CONCEPTS} concepts when enough signal exists.\n"
        "- Prefer a balanced set: 1-2 high-level anchor concepts and 2-6 specific method/entity concepts.\n"
        "- Use noun phrases (1-4 words), Title Case, and stable canonical wording.\n"
        "- Keep concepts that are reusable across notes; avoid dates, course admin terms, and vague words.\n"
        "- Include key techniques/rules when they materially matter to the note.\n"
        "- Contextual disambiguation: for any concept that could have multiple meanings or is a single generic word "
        "(e.g., 'Limits', 'Attention', 'Matrix'), you MUST append its broad domain in parentheses. "
        "Example: extract 'Limits (Calculus)' instead of 'Limits'.\n"
        "- Parent concept extraction: for every specific concept you extract, you MUST also extract its broad academic "
        "or thematic parent concept so they co-occur in the document. "
        "Example: if you extract 'Derivatives', you must also extract 'Calculus'.\n\n"
        f"{existing_concepts_section}"
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


def extract_concepts(
    text: str,
    doc_name: str,
    existing_concepts: list[str] | None = None,
) -> dict:
    prompt = _build_extraction_prompt(
        text=text,
        doc_name=doc_name,
        existing_concepts=existing_concepts,
    )
    response_text = generate_text_with_backoff(prompt)
    return _parse_json_response(response_text)


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

    return generate_text_with_backoff(prompt)


def generate_partial_answer(query: str, summary: str, member_concepts: list[str]) -> str:
    prompt = (
        "You are answering a corpus-level question from one graph community.\n\n"
        f"Question: {query}\n\n"
        f"Community summary:\n{summary}\n\n"
        f"Member concepts: {', '.join(member_concepts)}\n\n"
        "Answer only from this summary. Keep the answer concise and grounded."
    )
    return generate_text_with_backoff(prompt)


def synthesize_answers(query: str, partial_answers: list[str]) -> str:
    prompt = (
        "Synthesize the following community-level answers into one grounded answer.\n\n"
        f"Question: {query}\n\n"
        "Partial answers:\n"
        f"{chr(10).join(partial_answers)}\n\n"
        "Combine overlaps, keep the final answer coherent, and avoid adding unsupported facts."
    )
    return generate_text_with_backoff(prompt)


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
    return generate_text_with_backoff(prompt)


def generate_test_answer(question: str) -> str:
    """Return a direct model response without any retrieval context."""
    prompt = (
        "You are a test route for BrainBank.\n"
        "Answer the user's question directly and briefly.\n\n"
        f"Question: {question}"
    )

    return generate_text_with_backoff(prompt, provider_name=_get_test_llm_provider())


