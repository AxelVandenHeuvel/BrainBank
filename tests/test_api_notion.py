from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from backend.api import app

client = TestClient(app)


@patch("backend.api.ingest_markdown")
@patch("backend.api.fetch_page_markdown")
def test_import_single_page(mock_fetch, mock_ingest):
    mock_fetch.return_value = ("My Page", "# Hello\n\nSome content")
    mock_ingest.return_value = {"doc_id": "abc", "chunks": 2, "concepts": ["Math"]}

    resp = client.post("/ingest/notion", json={
        "token": "ntn_test",
        "url": "https://www.notion.so/My-Page-abc123def456abc123def456abc123de",
    })

    assert resp.status_code == 200
    data = resp.json()
    assert data["imported"] == 1
    assert len(data["pages"]) == 1
    assert data["pages"][0]["title"] == "My Page"
    assert data["pages"][0]["doc_id"] == "abc"
    mock_fetch.assert_called_once_with("ntn_test", "abc123de-f456-abc1-23de-f456abc123de")
    mock_ingest.assert_called_once_with("# Hello\n\nSome content", "My Page")


@patch("backend.api.ingest_markdown")
@patch("backend.api.fetch_page_markdown")
@patch("backend.api.fetch_database_page_ids")
def test_import_database(mock_db_pages, mock_fetch, mock_ingest):
    mock_db_pages.return_value = ["id-1", "id-2"]
    mock_fetch.side_effect = [
        ("Page 1", "Content 1"),
        ("Page 2", "Content 2"),
    ]
    mock_ingest.side_effect = [
        {"doc_id": "d1", "chunks": 1, "concepts": ["A"]},
        {"doc_id": "d2", "chunks": 2, "concepts": ["B"]},
    ]

    resp = client.post("/ingest/notion", json={
        "token": "ntn_test",
        "url": "https://www.notion.so/ws/abc123def456abc123def456abc123de?v=xyz",
    })

    assert resp.status_code == 200
    data = resp.json()
    assert data["imported"] == 2
    assert len(data["pages"]) == 2


def test_import_invalid_url():
    resp = client.post("/ingest/notion", json={
        "token": "ntn_test",
        "url": "https://google.com/random",
    })
    assert resp.status_code == 400
    assert "error" in resp.json()


@patch("backend.api.fetch_page_markdown")
def test_import_bad_token(mock_fetch):
    from notion_client import APIResponseError
    from httpx import Headers

    mock_fetch.side_effect = APIResponseError(
        code="unauthorized",
        status=401,
        message="Invalid token",
        headers=Headers(),
        raw_body_text="",
    )

    resp = client.post("/ingest/notion", json={
        "token": "bad_token",
        "url": "abc123def456abc123def456abc123de",
    })
    assert resp.status_code == 400
    assert "error" in resp.json()
