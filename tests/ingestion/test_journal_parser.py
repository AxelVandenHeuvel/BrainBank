from backend.ingestion.journal_parser import parse_journal_entry


class TestParseJournalEntry:
    def test_parses_markdown_headings_into_sections(self):
        raw_text = (
            "## Work\n"
            "Working on BrainBank ingestion.\n\n"
            "## Learning\n"
            "Today I learned graph schemas need clear boundaries.\n"
        )

        result = parse_journal_entry(raw_text)

        assert result["sections"] == [
            {"heading": "Work", "content": "Working on BrainBank ingestion."},
            {
                "heading": "Learning",
                "content": "Today I learned graph schemas need clear boundaries.",
            },
        ]

    def test_extracts_raw_tasks_from_checkbox_and_todo_patterns(self):
        raw_text = (
            "## Work\n"
            "- [ ] Implement graph database\n"
            "- TODO Write extraction tests\n"
        )

        result = parse_journal_entry(raw_text)

        assert result["raw_tasks"] == [
            "Implement graph database",
            "Write extraction tests",
        ]

    def test_extracts_reflections_from_today_i_learned_patterns(self):
        raw_text = (
            "Today I learned graphs fit this product better than tables.\n"
            "Insight: Small extraction steps are easier to verify.\n"
        )

        result = parse_journal_entry(raw_text)

        assert result["raw_reflections"] == [
            "graphs fit this product better than tables.",
            "Small extraction steps are easier to verify.",
        ]

    def test_plain_text_without_patterns_returns_full_text(self):
        raw_text = "This is a plain journal entry without any markdown structure."

        result = parse_journal_entry(raw_text)

        assert result["sections"] == []
        assert result["raw_tasks"] == []
        assert result["raw_reflections"] == []
        assert result["full_text"] == raw_text
