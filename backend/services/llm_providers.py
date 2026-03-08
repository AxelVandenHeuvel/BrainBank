import json
import os
from urllib.request import Request, urlopen

from dotenv import load_dotenv
from google import genai

load_dotenv()

DEFAULT_LLM_PROVIDER = "gemini"
DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-lite-preview"
DEFAULT_OLLAMA_URL = "http://localhost:11434"
DEFAULT_OLLAMA_MODEL = "llama3.2:3b"

_gemini_client = None


class GeminiProvider:
    def generate_text(self, prompt: str) -> str:
        client = _get_gemini_client()
        response = client.models.generate_content(
            model=_get_gemini_model_name(),
            contents=prompt,
        )
        return response.text


class OllamaProvider:
    def generate_text(self, prompt: str) -> str:
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


def _get_gemini_client():
    global _gemini_client
    if _gemini_client is None:
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise ValueError("GEMINI_API_KEY environment variable is required")
        _gemini_client = genai.Client(api_key=api_key)
    return _gemini_client


def _get_gemini_model_name() -> str:
    return os.environ.get("GEMINI_MODEL", DEFAULT_GEMINI_MODEL)


def _get_default_provider_name() -> str:
    return os.environ.get("BRAINBANK_LLM_PROVIDER", DEFAULT_LLM_PROVIDER).lower()


def get_provider(provider_name: str | None = None):
    selected_provider = (provider_name or _get_default_provider_name()).lower()
    providers = {
        "gemini": GeminiProvider,
        "ollama": OllamaProvider,
    }
    provider_class = providers.get(selected_provider)
    if provider_class is None:
        supported = ", ".join(sorted(providers))
        raise ValueError(
            f"Unsupported BrainBank LLM provider '{selected_provider}'. "
            f"Supported providers: {supported}."
        )
    return provider_class()
