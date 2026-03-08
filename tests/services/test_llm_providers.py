from unittest.mock import Mock, patch

import pytest

from backend.services.llm_providers import (
    DEFAULT_GEMINI_MODEL,
    GeminiProvider,
    OllamaProvider,
    get_provider,
)


class TestGetProvider:
    @patch.dict("backend.services.llm_providers.os.environ", {}, clear=True)
    def test_get_provider_uses_default_provider(self):
        provider = get_provider()

        assert isinstance(provider, GeminiProvider)

    def test_get_provider_can_select_ollama_explicitly(self):
        provider = get_provider(provider_name="ollama")

        assert isinstance(provider, OllamaProvider)

    def test_get_provider_rejects_unknown_provider(self):
        with pytest.raises(ValueError, match="Unsupported BrainBank LLM provider 'unknown'"):
            get_provider(provider_name="unknown")


class TestGeminiProvider:
    @patch("backend.services.llm_providers._get_gemini_client")
    @patch.dict("backend.services.llm_providers.os.environ", {}, clear=True)
    def test_generate_text_uses_configured_gemini_model(self, mock_get_client):
        client = Mock()
        response = Mock()
        response.text = "Gemini answer"
        client.models.generate_content.return_value = response
        mock_get_client.return_value = client

        result = GeminiProvider().generate_text("Explain graph rag")

        assert result == "Gemini answer"
        assert client.models.generate_content.call_args.kwargs["model"] == DEFAULT_GEMINI_MODEL
        assert client.models.generate_content.call_args.kwargs["contents"] == "Explain graph rag"


class TestOllamaProvider:
    @patch("backend.services.llm_providers.urlopen")
    @patch.dict("backend.services.llm_providers.os.environ", {}, clear=True)
    def test_generate_text_posts_prompt_to_ollama(self, mock_urlopen):
        response = Mock()
        response.read.return_value = b'{"response": "Local model reply"}'
        mock_urlopen.return_value.__enter__.return_value = response

        result = OllamaProvider().generate_text("Say hello")

        assert result == "Local model reply"
        request = mock_urlopen.call_args.args[0]
        assert request.full_url == "http://localhost:11434/api/generate"
        assert request.get_method() == "POST"
        assert b'"model": "llama3.2:3b"' in request.data
        assert b'"prompt": "Say hello"' in request.data
