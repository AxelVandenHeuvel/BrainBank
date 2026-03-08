import asyncio
from functools import partial

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from backend.api_graph import graph_router
from backend.db.kuzu import get_kuzu_engine
from backend.ingestion.processor import ingest_markdown
from backend.retrieval.query import query_brainbank
from backend.services.llm import generate_test_answer
from backend.services.notion import (
    fetch_database_page_ids,
    fetch_page_markdown,
    parse_notion_url,
)

app = FastAPI(title="BrainBank", version="0.1.0")
app.include_router(graph_router)


class IngestRequest(BaseModel):
    text: str
    title: str


class NotionImportRequest(BaseModel):
    token: str
    url: str


class QueryRequest(BaseModel):
    question: str


@app.post("/ingest")
async def ingest(req: IngestRequest):
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        None,
        partial(ingest_markdown, req.text, req.title, shared_kuzu_db=get_kuzu_engine()),
    )
    return result


@app.post("/query")
async def query(req: QueryRequest):
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, partial(query_brainbank, req.question))
    return {
        "answer": result["answer"],
        "source_concepts": result["source_concepts"],
        "discovery_concepts": result["discovery_concepts"],
    }


@app.post("/query/test-llm")
async def query_test_llm(req: QueryRequest):
    loop = asyncio.get_event_loop()
    answer = await loop.run_in_executor(None, partial(generate_test_answer, req.question))
    return {
        "answer": answer,
        "discovery_concepts": [],
        "mode": "llm_test",
    }


@app.post("/ingest/notion")
async def ingest_notion(req: NotionImportRequest):
    try:
        kind, uid = parse_notion_url(req.url)
    except ValueError as e:
        return JSONResponse(status_code=400, content={"error": str(e)})

    loop = asyncio.get_event_loop()

    try:
        if kind == "page":
            page_ids = [uid]
        else:
            page_ids = await loop.run_in_executor(
                None, partial(fetch_database_page_ids, req.token, uid)
            )

        pages = []
        for pid in page_ids:
            title, markdown = await loop.run_in_executor(
                None, partial(fetch_page_markdown, req.token, pid)
            )
            result = await loop.run_in_executor(
                None, partial(ingest_markdown, markdown, title)
            )
            pages.append({"title": title, **result})

        return {"imported": len(pages), "pages": pages}
    except Exception as e:
        return JSONResponse(status_code=400, content={"error": str(e)})
