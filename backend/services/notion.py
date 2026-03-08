"""Notion API integration: fetch pages and convert blocks to markdown."""

import re

from notion_client import Client


def parse_notion_url(url: str) -> tuple[str, str]:
    """Extract (resource_type, uuid) from a Notion URL or raw ID.

    Returns ("page", uuid) or ("database", uuid).
    Database URLs contain a ?v= query parameter.
    """
    # Strip whitespace
    url = url.strip()

    # Already a UUID (32 hex or dashed)?
    hex_only = url.replace("-", "")
    if re.fullmatch(r"[0-9a-f]{32}", hex_only):
        return ("page", _format_uuid(hex_only))

    # Must be a notion.so URL
    if "notion.so" not in url and "notion.site" not in url:
        raise ValueError(f"Not a valid Notion URL: {url}")

    # Extract the 32-hex ID from the URL path
    path = url.split("?")[0]
    match = re.search(r"([0-9a-f]{32})", path)
    if not match:
        raise ValueError(f"Could not find a Notion ID in URL: {url}")

    uid = _format_uuid(match.group(1))
    kind = "database" if "?v=" in url else "page"
    return (kind, uid)


def _format_uuid(hex32: str) -> str:
    """Convert 32 hex chars to dashed UUID format."""
    h = hex32.replace("-", "")
    return f"{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:]}"


def extract_rich_text(rich_text: list[dict]) -> str:
    """Convert Notion rich_text array to inline markdown."""
    parts = []
    for segment in rich_text:
        text = segment.get("text", {}).get("content", "")
        annotations = segment.get("annotations", {})
        link = segment.get("text", {}).get("link")

        if annotations.get("code"):
            text = f"`{text}`"
        if annotations.get("bold"):
            text = f"**{text}**"
        if annotations.get("italic"):
            text = f"*{text}*"
        if annotations.get("strikethrough"):
            text = f"~~{text}~~"
        if link:
            text = f"[{text}]({link['url']})"

        parts.append(text)
    return "".join(parts)


def blocks_to_markdown(blocks: list[dict]) -> str:
    """Convert a list of Notion block objects to a markdown string."""
    lines: list[str] = []
    numbered_index = 0

    for block in blocks:
        btype = block.get("type", "")
        data = block.get(btype, {})

        if btype == "paragraph":
            lines.append(extract_rich_text(data.get("rich_text", [])))
            lines.append("")

        elif btype in ("heading_1", "heading_2", "heading_3"):
            level = int(btype[-1])
            prefix = "#" * level
            lines.append(f"{prefix} {extract_rich_text(data.get('rich_text', []))}")
            lines.append("")

        elif btype == "bulleted_list_item":
            lines.append(f"- {extract_rich_text(data.get('rich_text', []))}")

        elif btype == "numbered_list_item":
            numbered_index += 1
            lines.append(f"{numbered_index}. {extract_rich_text(data.get('rich_text', []))}")

        elif btype == "to_do":
            checked = data.get("checked", False)
            mark = "x" if checked else " "
            lines.append(f"- [{mark}] {extract_rich_text(data.get('rich_text', []))}")

        elif btype == "code":
            lang = data.get("language", "")
            code = extract_rich_text(data.get("rich_text", []))
            lines.append(f"```{lang}")
            lines.append(code)
            lines.append("```")
            lines.append("")

        elif btype == "quote":
            lines.append(f"> {extract_rich_text(data.get('rich_text', []))}")
            lines.append("")

        elif btype == "callout":
            lines.append(f"> {extract_rich_text(data.get('rich_text', []))}")
            lines.append("")

        elif btype == "divider":
            lines.append("---")
            lines.append("")

        elif btype == "equation":
            expr = data.get("expression", "")
            lines.append(f"$${expr}$$")
            lines.append("")

        # Reset numbered list counter when not in a numbered list
        if btype != "numbered_list_item":
            numbered_index = 0

    return "\n".join(lines)


def _get_page_title(page: dict) -> str:
    """Extract the title from a Notion page object."""
    props = page.get("properties", {})
    # Database pages have a "title" typed property
    for prop in props.values():
        if prop.get("type") == "title":
            title_parts = prop.get("title", [])
            if title_parts:
                return extract_rich_text(title_parts)
    # Fallback
    return "Untitled"


def fetch_page_markdown(token: str, page_id: str) -> tuple[str, str]:
    """Fetch a Notion page and return (title, markdown).

    Uses the Notion API to retrieve the page title and all blocks,
    then converts blocks to markdown.
    """
    client = Client(auth=token)

    page = client.pages.retrieve(page_id=page_id)
    title = _get_page_title(page)

    # Fetch all blocks with pagination
    all_blocks: list[dict] = []
    cursor = None
    while True:
        response = client.blocks.children.list(
            block_id=page_id, start_cursor=cursor, page_size=100
        )
        all_blocks.extend(response["results"])
        if not response.get("has_more"):
            break
        cursor = response.get("next_cursor")

    markdown = blocks_to_markdown(all_blocks)
    return (title, markdown)


def fetch_database_page_ids(token: str, database_id: str, limit: int = 50) -> list[str]:
    """Fetch page IDs from a Notion database (up to limit)."""
    client = Client(auth=token)

    page_ids: list[str] = []
    cursor = None
    while len(page_ids) < limit:
        response = client.databases.query(
            database_id=database_id, start_cursor=cursor, page_size=min(100, limit - len(page_ids))
        )
        for result in response["results"]:
            page_ids.append(result["id"])
        if not response.get("has_more"):
            break
        cursor = response.get("next_cursor")

    return page_ids
