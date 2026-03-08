import pytest

from backend.services.notion import (
    extract_rich_text,
    blocks_to_markdown,
    parse_notion_url,
)


class TestParseNotionUrl:
    def test_page_url(self):
        url = "https://www.notion.so/My-Page-Title-abc123def456abc123def456abc123de"
        kind, uid = parse_notion_url(url)
        assert kind == "page"
        assert uid == "abc123de-f456-abc1-23de-f456abc123de"

    def test_page_url_with_workspace(self):
        url = "https://www.notion.so/workspace/My-Page-abc123def456abc123def456abc123de"
        kind, uid = parse_notion_url(url)
        assert kind == "page"

    def test_database_url(self):
        url = "https://www.notion.so/workspace/abc123def456abc123def456abc123de?v=xyz"
        kind, uid = parse_notion_url(url)
        assert kind == "database"

    def test_raw_uuid(self):
        kind, uid = parse_notion_url("abc123def456abc123def456abc123de")
        assert kind == "page"
        assert uid == "abc123de-f456-abc1-23de-f456abc123de"

    def test_dashed_uuid(self):
        kind, uid = parse_notion_url("abc123de-f456-abc1-23de-f456abc123de")
        assert kind == "page"
        assert uid == "abc123de-f456-abc1-23de-f456abc123de"

    def test_invalid_url(self):
        with pytest.raises(ValueError):
            parse_notion_url("https://google.com/hello")


class TestExtractRichText:
    def test_plain_text(self):
        rt = [{"type": "text", "text": {"content": "hello"}, "annotations": {}}]
        assert extract_rich_text(rt) == "hello"

    def test_bold(self):
        rt = [{"type": "text", "text": {"content": "bold"}, "annotations": {"bold": True}}]
        assert extract_rich_text(rt) == "**bold**"

    def test_italic(self):
        rt = [{"type": "text", "text": {"content": "em"}, "annotations": {"italic": True}}]
        assert extract_rich_text(rt) == "*em*"

    def test_code(self):
        rt = [{"type": "text", "text": {"content": "x"}, "annotations": {"code": True}}]
        assert extract_rich_text(rt) == "`x`"

    def test_link(self):
        rt = [{"type": "text", "text": {"content": "click", "link": {"url": "https://example.com"}}, "annotations": {}}]
        assert extract_rich_text(rt) == "[click](https://example.com)"

    def test_mixed(self):
        rt = [
            {"type": "text", "text": {"content": "hello "}, "annotations": {}},
            {"type": "text", "text": {"content": "world"}, "annotations": {"bold": True}},
        ]
        assert extract_rich_text(rt) == "hello **world**"


class TestBlocksToMarkdown:
    def test_paragraph(self):
        blocks = [{"type": "paragraph", "paragraph": {"rich_text": [
            {"type": "text", "text": {"content": "Hello world"}, "annotations": {}}
        ]}}]
        assert blocks_to_markdown(blocks).strip() == "Hello world"

    def test_headings(self):
        blocks = [
            {"type": "heading_1", "heading_1": {"rich_text": [
                {"type": "text", "text": {"content": "H1"}, "annotations": {}}
            ]}},
            {"type": "heading_2", "heading_2": {"rich_text": [
                {"type": "text", "text": {"content": "H2"}, "annotations": {}}
            ]}},
            {"type": "heading_3", "heading_3": {"rich_text": [
                {"type": "text", "text": {"content": "H3"}, "annotations": {}}
            ]}},
        ]
        md = blocks_to_markdown(blocks)
        assert "# H1" in md
        assert "## H2" in md
        assert "### H3" in md

    def test_bulleted_list(self):
        blocks = [{"type": "bulleted_list_item", "bulleted_list_item": {"rich_text": [
            {"type": "text", "text": {"content": "item"}, "annotations": {}}
        ]}}]
        assert "- item" in blocks_to_markdown(blocks)

    def test_numbered_list(self):
        blocks = [{"type": "numbered_list_item", "numbered_list_item": {"rich_text": [
            {"type": "text", "text": {"content": "first"}, "annotations": {}}
        ]}}]
        assert "1. first" in blocks_to_markdown(blocks)

    def test_code_block(self):
        blocks = [{"type": "code", "code": {
            "rich_text": [{"type": "text", "text": {"content": "print('hi')"}, "annotations": {}}],
            "language": "python",
        }}]
        md = blocks_to_markdown(blocks)
        assert "```python" in md
        assert "print('hi')" in md

    def test_quote(self):
        blocks = [{"type": "quote", "quote": {"rich_text": [
            {"type": "text", "text": {"content": "wise words"}, "annotations": {}}
        ]}}]
        assert "> wise words" in blocks_to_markdown(blocks)

    def test_divider(self):
        blocks = [{"type": "divider", "divider": {}}]
        assert "---" in blocks_to_markdown(blocks)

    def test_to_do(self):
        blocks = [
            {"type": "to_do", "to_do": {
                "checked": False,
                "rich_text": [{"type": "text", "text": {"content": "task"}, "annotations": {}}],
            }},
            {"type": "to_do", "to_do": {
                "checked": True,
                "rich_text": [{"type": "text", "text": {"content": "done"}, "annotations": {}}],
            }},
        ]
        md = blocks_to_markdown(blocks)
        assert "- [ ] task" in md
        assert "- [x] done" in md

    def test_equation(self):
        blocks = [{"type": "equation", "equation": {"expression": "E=mc^2"}}]
        assert "$$E=mc^2$$" in blocks_to_markdown(blocks)

    def test_unknown_type_skipped(self):
        blocks = [{"type": "unsupported_widget", "unsupported_widget": {}}]
        md = blocks_to_markdown(blocks)
        assert md.strip() == ""
