from unittest.mock import Mock, patch

from backend.services.llm import (
    extract_concepts,
    generate_answer,
    generate_test_answer,
)


def _mock_response(text: str):
    response = Mock()
    response.text = text
    return response


class TestExtractConcepts:
    @patch("backend.services.llm._get_client")
    def test_extract_concepts_still_returns_legacy_shape(self, mock_get_client):
        client = Mock()
        client.models.generate_content.return_value = _mock_response(
            """```json
            {
              "concepts": ["Calculus", "Derivatives"],
              "relationships": [
                {"from": "Calculus", "to": "Derivatives", "relationship": "contains"}
              ]
            }
            ```"""
        )
        mock_get_client.return_value = client

        result = extract_concepts("Calculus notes", "Math Notes")

        assert result == {
            "concepts": ["Calculus", "Derivatives"],
            "relationships": [
                {
                    "from": "Calculus",
                    "to": "Derivatives",
                    "relationship": "contains",
                }
            ],
        }

    @patch("backend.services.llm._get_client")
    def test_extract_concepts_strips_markdown_code_fences(self, mock_get_client):
        client = Mock()
        client.models.generate_content.return_value = _mock_response(
            """```json
            {
              "concepts": [],
              "relationships": []
            }
            ```"""
        )
        mock_get_client.return_value = client

        result = extract_concepts("Entry text", "Journal")

        assert result == {
            "concepts": [],
            "relationships": [],
        }

    @patch("backend.services.llm._get_client")
    def test_extract_concepts_passes_document_title_and_text_to_gemini(self, mock_get_client):
        client = Mock()
        client.models.generate_content.return_value = _mock_response(
            """
            {
              "concepts": ["Graph database"],
              "relationships": [
                {"from": "Graph database", "to": "Extraction tests", "relationship": "supports"}
              ]
            }
            """
        )
        mock_get_client.return_value = client

        journal_text = (
            "## Work\n"
            "Working on BrainBank.\n"
            "- [ ] Write extraction tests\n"
            "Today I learned small changes are easier to verify."
        )
        extract_concepts(journal_text, "Daily Journal")

        prompt = client.models.generate_content.call_args.kwargs["contents"]
        assert "Daily Journal" in prompt
        assert journal_text in prompt
        assert '"concepts"' in prompt

    @patch("backend.services.llm._get_client")
    def test_extract_concepts_prompt_enforces_balanced_graph_concept_count(self, mock_get_client):
        client = Mock()
        client.models.generate_content.return_value = _mock_response(
            """
            {
              "concepts": ["Calculus", "Derivatives", "Chain Rule", "Product Rule"],
              "relationships": []
            }
            """
        )
        mock_get_client.return_value = client

        extract_concepts("Chain rule builds on derivatives and calculus.", "Derivative Notes")

        prompt = client.models.generate_content.call_args.kwargs["contents"]
        assert "Return between 4 and 8 concepts" in prompt
        assert "1-2 high-level anchor concepts" in prompt
        assert "2-6 specific method/entity concepts" in prompt
        assert '"relationships"' in prompt


class TestModelSelection:
    @patch.dict("backend.services.llm.os.environ", {}, clear=True)
    @patch("backend.services.llm._get_client")
    def test_generate_answer_uses_current_default_model(self, mock_get_client):
        client = Mock()
        client.models.generate_content.return_value = _mock_response("Answer")
        mock_get_client.return_value = client

        result = generate_answer("What is calculus?", "Context", ["Calculus"])

        assert result == "Answer"
        assert client.models.generate_content.call_args.kwargs["model"] == "gemini-2.5-flash"

    @patch.dict("backend.services.llm.os.environ", {"BRAINBANK_LLM_PROVIDER": "ollama"}, clear=False)
    @patch("backend.services.llm.urlopen")
    def test_generate_answer_can_use_local_ollama(self, mock_urlopen):
        response = Mock()
        response.read.return_value = b'{"response": "Grounded local answer"}'
        mock_urlopen.return_value.__enter__.return_value = response

        result = generate_answer("What is calculus?", "Context from retrieval", ["Calculus"])

        assert result == "Grounded local answer"
        request = mock_urlopen.call_args.args[0]
        assert request.full_url == "http://localhost:11434/api/generate"
        assert request.get_method() == "POST"
        assert b'"model": "llama3.2:3b"' in request.data
        assert b'What is calculus?' in request.data
        assert b'Context from retrieval' in request.data
        assert b'Calculus' in request.data

    @patch.dict("backend.services.llm.os.environ", {"TEST_LLM_PROVIDER": "ollama"}, clear=False)
    @patch("backend.services.llm.urlopen")
    def test_generate_test_answer_can_use_local_ollama(self, mock_urlopen):
        response = Mock()
        response.read.return_value = b'{"response": "Local model reply"}'
        mock_urlopen.return_value.__enter__.return_value = response

        result = generate_test_answer("Say hello")

        assert result == "Local model reply"
        request = mock_urlopen.call_args.args[0]
        assert request.full_url == "http://localhost:11434/api/generate"
        assert request.get_method() == "POST"
        assert b'"model": "llama3.2:3b"' in request.data
        assert b'"prompt": "Say hello"' in request.data
