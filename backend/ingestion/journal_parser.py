import re


SECTION_HEADING_PATTERN = re.compile(r"^##\s+(?P<heading>.+?)\s*$", re.MULTILINE)
TASK_PATTERNS = [
    re.compile(r"^\s*-\s*\[\s\]\s+(?P<task>.+?)\s*$", re.MULTILINE),
    re.compile(r"^\s*-\s*TODO[:\s]+(?P<task>.+?)\s*$", re.MULTILINE),
]
REFLECTION_PATTERNS = [
    re.compile(r"^\s*Today I learned\s+(?P<reflection>.+?)\s*$", re.MULTILINE),
    re.compile(r"^\s*Insight:\s*(?P<reflection>.+?)\s*$", re.MULTILINE),
]


def parse_journal_entry(raw_text: str) -> dict:
    """Parse a raw journal entry into structured hints for later extraction."""
    cleaned_text = raw_text.strip()

    return {
        "sections": _parse_sections(cleaned_text),
        "raw_tasks": _extract_matches(cleaned_text, TASK_PATTERNS, "task"),
        "raw_reflections": _extract_matches(
            cleaned_text, REFLECTION_PATTERNS, "reflection"
        ),
        "full_text": cleaned_text,
    }


def _parse_sections(text: str) -> list[dict]:
    matches = list(SECTION_HEADING_PATTERN.finditer(text))
    if not matches:
        return []

    sections = []
    for index, match in enumerate(matches):
        content_start = match.end()
        content_end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        content = text[content_start:content_end].strip()
        sections.append(
            {"heading": match.group("heading").strip(), "content": content}
        )
    return sections


def _extract_matches(
    text: str, patterns: list[re.Pattern[str]], group_name: str
) -> list[str]:
    matches = []
    for pattern in patterns:
        matches.extend(
            match.group(group_name).strip()
            for match in pattern.finditer(text)
            if match.group(group_name).strip()
        )
    return matches
