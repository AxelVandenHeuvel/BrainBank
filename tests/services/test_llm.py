from unittest.mock import Mock, patch

from backend.services.llm import (
    extract_concepts,
    extract_knowledge,
    generate_answer,
    generate_test_answer,
)


def _mock_response(text: str):
    response = Mock()
    response.text = text
    return response


class TestExtractKnowledge:
    @patch("backend.services.llm._get_client")
    def test_returns_expected_knowledge_structure(self, mock_get_client):
        client = Mock()
        client.models.generate_content.return_value = _mock_response(
            """
            {
              "concepts": ["Calculus", "Linear Algebra"],
              "projects": [{"name": "BrainBank", "status": "in_progress"}],
              "tasks": [{"name": "Implement graph database", "status": "pending"}],
              "reflections": ["Graphs are more powerful than tables for knowledge modeling"],
              "relationships": [
                {"from": "Calculus", "to": "Linear Algebra", "type": "related_to"}
              ]
            }
            """
        )
        mock_get_client.return_value = client

        result = extract_knowledge("Sample journal text", "Journal")

        assert result == {
            "concepts": ["Calculus", "Linear Algebra"],
            "projects": [{"name": "BrainBank", "status": "in_progress"}],
            "tasks": [{"name": "Implement graph database", "status": "pending"}],
            "reflections": [
                "Graphs are more powerful than tables for knowledge modeling"
            ],
            "relationships": [
                {
                    "from": "Calculus",
                    "to": "Linear Algebra",
                    "type": "related_to",
                }
            ],
        }

    @patch("backend.services.llm._get_client")
    def test_strips_markdown_code_fences_from_llm_response(self, mock_get_client):
        client = Mock()
        client.models.generate_content.return_value = _mock_response(
            """```json
            {
              "concepts": [],
              "projects": [],
              "tasks": [],
              "reflections": [],
              "relationships": []
            }
            ```"""
        )
        mock_get_client.return_value = client

        result = extract_knowledge("Entry text", "Journal")

        assert result == {
            "concepts": [],
            "projects": [],
            "tasks": [],
            "reflections": [],
            "relationships": [],
        }

    @patch("backend.services.llm._get_client")
    def test_passes_sample_journal_text_to_gemini(self, mock_get_client):
        client = Mock()
        client.models.generate_content.return_value = _mock_response(
            """
            {
              "concepts": ["Graph database"],
              "projects": [{"name": "BrainBank", "status": "in_progress"}],
              "tasks": [{"name": "Write extraction tests", "status": "pending"}],
              "reflections": ["Small changes are easier to verify"],
              "relationships": [
                {"from": "BrainBank", "to": "Write extraction tests", "type": "has_task"}
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
        extract_knowledge(journal_text, "Daily Journal")

        prompt = client.models.generate_content.call_args.kwargs["contents"]
        assert "Daily Journal" in prompt
        assert journal_text in prompt
        assert '"projects"' in prompt
        assert '"tasks"' in prompt
        assert '"reflections"' in prompt


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


class TestModelSelection:
    @patch("backend.services.llm._get_client")
    def test_generate_answer_uses_current_default_model(self, mock_get_client):
        client = Mock()
        client.models.generate_content.return_value = _mock_response("Answer")
        mock_get_client.return_value = client

        result = generate_answer("What is calculus?", "Context", ["Calculus"])

        assert result == "Answer"
        assert client.models.generate_content.call_args.kwargs["model"] == "gemini-2.5-flash"
