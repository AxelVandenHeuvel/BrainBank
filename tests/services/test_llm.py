from unittest.mock import Mock, patch

import backend.services.llm as llm_module
from backend.services.llm import (
    extract_concepts,
    generate_answer,
    generate_community_summary,
    generate_partial_answer,
    synthesize_answers,
    generate_test_answer,
)
class TestExtractConcepts:
    @patch("backend.services.llm.get_provider")
    def test_extract_concepts_still_returns_legacy_shape(self, mock_get_provider):
        provider = Mock()
        provider.generate_text.return_value = """```json
            {
              "concepts": ["Calculus", "Derivatives"],
              "relationships": [
                {"from": "Calculus", "to": "Derivatives", "relationship": "contains"}
              ]
            }
            ```"""
        mock_get_provider.return_value = provider

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

    @patch("backend.services.llm.get_provider")
    def test_extract_concepts_strips_markdown_code_fences(self, mock_get_provider):
        provider = Mock()
        provider.generate_text.return_value = (
            """```json
            {
              "concepts": [],
              "relationships": []
            }
            ```"""
        )
        mock_get_provider.return_value = provider

        result = extract_concepts("Entry text", "Journal")

        assert result == {
            "concepts": [],
            "relationships": [],
        }

    @patch("backend.services.llm.get_provider")
    def test_extract_concepts_passes_document_title_and_text_to_provider(self, mock_get_provider):
        provider = Mock()
        provider.generate_text.return_value = """
            {
              "concepts": ["Graph database"],
              "relationships": [
                {"from": "Graph database", "to": "Extraction tests", "relationship": "supports"}
              ]
            }
            """
        mock_get_provider.return_value = provider

        journal_text = (
            "## Work\n"
            "Working on BrainBank.\n"
            "- [ ] Write extraction tests\n"
            "Today I learned small changes are easier to verify."
        )
        extract_concepts(journal_text, "Daily Journal")

        prompt = provider.generate_text.call_args.args[0]
        assert "Daily Journal" in prompt
        assert journal_text in prompt
        assert '"concepts"' in prompt

    @patch("backend.services.llm.get_provider")
    def test_extract_concepts_prompt_enforces_balanced_graph_concept_count(self, mock_get_provider):
        provider = Mock()
        provider.generate_text.return_value = (
            """
            {
              "concepts": ["Calculus", "Derivatives", "Chain Rule", "Product Rule"],
              "relationships": []
            }
            """
        )
        mock_get_provider.return_value = provider

        extract_concepts("Chain rule builds on derivatives and calculus.", "Derivative Notes")

        prompt = provider.generate_text.call_args.args[0]
        assert "Return between 4 and 8 concepts" in prompt
        assert "1-2 high-level anchor concepts" in prompt
        assert "2-6 specific method/entity concepts" in prompt
        assert '"relationships"' in prompt

    @patch("backend.services.llm.get_provider")
    def test_extract_concepts_prompt_requires_contextual_disambiguation(self, mock_get_provider):
        provider = Mock()
        provider.generate_text.return_value = '{"concepts": ["Limits (Calculus)"], "relationships": []}'
        mock_get_provider.return_value = provider

        extract_concepts("Limits of sequences and series.", "Calc Notes")

        prompt = provider.generate_text.call_args.args[0]
        assert "multiple meanings" in prompt
        assert "broad domain in parentheses" in prompt
        assert "Limits (Calculus)" in prompt

    @patch("backend.services.llm.get_provider")
    def test_extract_concepts_prompt_requires_parent_concept_extraction(self, mock_get_provider):
        provider = Mock()
        provider.generate_text.return_value = '{"concepts": ["Derivatives", "Calculus"], "relationships": []}'
        mock_get_provider.return_value = provider

        extract_concepts("Derivatives and the chain rule.", "Calc Notes")

        prompt = provider.generate_text.call_args.args[0]
        assert "parent concept" in prompt.lower()
        assert "Derivatives" in prompt
        assert "Calculus" in prompt

    @patch("backend.services.llm.get_provider")
    def test_extract_concepts_prompt_includes_existing_concept_mapping_guidance(self, mock_get_provider):
        provider = Mock()
        provider.generate_text.return_value = """
            {
              "concepts": ["Integrals"],
              "relationships": []
            }
            """
        mock_get_provider.return_value = provider

        extract_concepts(
            "Definite integrals build on antiderivatives.",
            "Calc II",
            existing_concepts=["Integrals", "Derivatives"],
        )

        prompt = provider.generate_text.call_args.args[0]
        assert "Prioritize mapping extracted ideas to the provided list of existing concepts" in prompt
        assert "Only create a new concept name if the idea is genuinely novel" in prompt
        assert "Integrals, Derivatives" in prompt

class TestModelSelection:
    @patch.dict("backend.services.llm.os.environ", {}, clear=True)
    @patch("backend.services.llm.get_provider")
    def test_generate_answer_uses_selected_provider(self, mock_get_provider):
        provider = Mock()
        provider.generate_text.return_value = "Answer"
        mock_get_provider.return_value = provider

        result = generate_answer("What is calculus?", "Context", ["Calculus"])

        assert result == "Answer"
        mock_get_provider.assert_called_once_with()
        prompt = provider.generate_text.call_args.args[0]
        assert "What is calculus?" in prompt
        assert "Context" in prompt

    @patch.dict("backend.services.llm.os.environ", {}, clear=True)
    @patch("backend.services.llm.get_provider")
    def test_generate_partial_answer_uses_summary_and_member_concepts(self, mock_get_provider):
        provider = Mock()
        provider.generate_text.return_value = "Partial"
        mock_get_provider.return_value = provider

        result = generate_partial_answer(
            "Summarize the corpus",
            "This community is about calculus.",
            ["Calculus", "Derivatives"],
        )

        assert result == "Partial"
        prompt = provider.generate_text.call_args.args[0]
        assert "Summarize the corpus" in prompt
        assert "This community is about calculus." in prompt
        assert "Calculus, Derivatives" in prompt

    @patch.dict("backend.services.llm.os.environ", {}, clear=True)
    @patch("backend.services.llm.get_provider")
    def test_synthesize_answers_combines_partials(self, mock_get_provider):
        provider = Mock()
        provider.generate_text.return_value = "Synthesized"
        mock_get_provider.return_value = provider

        result = synthesize_answers(
            "What are the main ideas?",
            ["Partial answer 1", "Partial answer 2"],
        )

        assert result == "Synthesized"
        prompt = provider.generate_text.call_args.args[0]
        assert "What are the main ideas?" in prompt
        assert "Partial answer 1" in prompt
        assert "Partial answer 2" in prompt

    @patch.dict("backend.services.llm.os.environ", {}, clear=True)
    @patch("backend.services.llm.get_provider")
    def test_generate_community_summary_uses_member_concepts_and_evidence(self, mock_get_provider):
        provider = Mock()
        provider.generate_text.return_value = "Community summary"
        mock_get_provider.return_value = provider

        result = generate_community_summary(
            "community:0001",
            ["Calculus", "Limits"],
            ["Chunk evidence one", "Chunk evidence two"],
        )

        assert result == "Community summary"
        prompt = provider.generate_text.call_args.args[0]
        assert "community:0001" in prompt
        assert "Calculus, Limits" in prompt
        assert "Chunk evidence one" in prompt
        assert "Chunk evidence two" in prompt

    @patch.dict("backend.services.llm.os.environ", {"TEST_LLM_PROVIDER": "ollama"}, clear=False)
    @patch("backend.services.llm.get_provider")
    def test_generate_test_answer_uses_test_provider_override(self, mock_get_provider):
        provider = Mock()
        provider.generate_text.return_value = "Local model reply"
        mock_get_provider.return_value = provider

        result = generate_test_answer("Say hello")

        assert result == "Local model reply"
        mock_get_provider.assert_called_once_with(provider_name="ollama")
        prompt = provider.generate_text.call_args.args[0]
        assert "You are a test route for BrainBank." in prompt
        assert "Question: Say hello" in prompt



class TestRateLimitBackoff:
    @patch("backend.services.llm.time.sleep")
    @patch("backend.services.llm.get_provider")
    def test_extract_concepts_retries_with_retry_delay_on_429(self, mock_get_provider, mock_sleep):
        provider = Mock()
        provider.generate_text.side_effect = [
            RuntimeError(
                '429 RESOURCE_EXHAUSTED {"error":{"details":[{"retryDelay":"3s"}]}}'
            ),
            '{"concepts": ["Integrals"], "relationships": []}',
        ]
        mock_get_provider.return_value = provider

        result = llm_module.extract_concepts("Text", "Doc")

        assert result == {"concepts": ["Integrals"], "relationships": []}
        assert provider.generate_text.call_count == 2
        mock_sleep.assert_called_once_with(3.0)

    @patch("backend.services.llm.logger")
    @patch("backend.services.llm.time.sleep")
    @patch("backend.services.llm.get_provider")
    def test_logs_when_waiting_for_rate_limit_reset(
        self, mock_get_provider, mock_sleep, mock_logger
    ):
        provider = Mock()
        provider.generate_text.side_effect = [
            RuntimeError("429 RESOURCE_EXHAUSTED"),
            '{"concepts": [], "relationships": []}',
        ]
        mock_get_provider.return_value = provider

        llm_module.extract_concepts("Text", "Doc")

        assert mock_logger.warning.call_count >= 1
        log_message = mock_logger.warning.call_args.args[0]
        assert "rate limit" in log_message.lower()
        assert "waiting" in log_message.lower()
        mock_sleep.assert_called_once()

