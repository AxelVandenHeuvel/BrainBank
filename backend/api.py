import asyncio
import os
import zipfile
from functools import partial
from io import BytesIO

from fastapi import FastAPI, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from backend.api_graph import graph_router
from backend.db.kuzu import get_kuzu_engine
from backend.db.lance import find_existing_document
from backend.ingestion.processor import ingest_markdown
from backend.retrieval.query import query_brainbank
from backend.session.memory import SessionMemory
from backend.services.llm import generate_test_answer
from backend.services.pdf import pdf_to_text
from backend.services.notion import (
    fetch_database_page_ids,
    fetch_page_markdown,
    parse_notion_url,
)

app = FastAPI(title="BrainBank", version="0.1.0")
app.include_router(graph_router)

session_memory = SessionMemory()


class IngestRequest(BaseModel):
    text: str
    title: str


class NotionImportRequest(BaseModel):
    token: str
    url: str


class HistoryTurn(BaseModel):
    role: str
    content: str


class QueryRequest(BaseModel):
    question: str
    session_id: str | None = None
    history: list[HistoryTurn] | None = None


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
    history_dicts = None
    if req.session_id:
        session_memory.add_turn(req.session_id, "user", req.question)
    if req.session_id and req.history:
        history_dicts = [{"role": t.role, "content": t.content} for t in req.history]

    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        None,
        partial(query_brainbank, req.question, shared_kuzu_db=get_kuzu_engine(), history=history_dicts),
    )

    if req.session_id:
        session_memory.add_turn(req.session_id, "assistant", result["answer"])

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
                None, partial(ingest_markdown, markdown, title, shared_kuzu_db=get_kuzu_engine())
            )
            pages.append({"title": title, **result})

        return {"imported": len(pages), "pages": pages}
    except Exception as e:
        return JSONResponse(status_code=400, content={"error": str(e)})


ALLOWED_EXTENSIONS = {".txt", ".md", ".pdf"}
UPLOAD_EXTENSIONS = ALLOWED_EXTENSIONS | {".zip"}


def _should_skip(name: str) -> bool:
    """Return True for __MACOSX metadata or hidden (dot) files."""
    parts = name.replace("\\", "/").split("/")
    return any(p.startswith("__MACOSX") or p.startswith(".") for p in parts)


def _extract_text(filename: str, data: bytes) -> str:
    """Extract text content from a supported file's raw bytes."""
    ext = os.path.splitext(filename)[1].lower()
    if ext == ".pdf":
        return pdf_to_text(data)
    return data.decode("utf-8", errors="replace")


@app.post("/ingest/upload")
async def ingest_upload(files: list[UploadFile]):
    for f in files:
        ext = os.path.splitext(f.filename or "")[1].lower()
        if ext not in UPLOAD_EXTENSIONS:
            return JSONResponse(
                status_code=400,
                content={"error": f"Unsupported file type: {f.filename}"},
            )

    loop = asyncio.get_event_loop()
    results = []

    for f in files:
        raw = await f.read()
        ext = os.path.splitext(f.filename or "")[1].lower()

        if ext == ".zip":
            with zipfile.ZipFile(BytesIO(raw)) as zf:
                for entry in zf.namelist():
                    if _should_skip(entry) or entry.endswith("/"):
                        continue
                    entry_ext = os.path.splitext(entry)[1].lower()
                    if entry_ext not in ALLOWED_EXTENSIONS:
                        continue
                    title = os.path.splitext(os.path.basename(entry))[0]
                    existing = await loop.run_in_executor(
                        None, partial(find_existing_document, title)
                    )
                    if existing:
                        results.append({"title": title, "skipped": True, "reason": "duplicate"})
                        continue
                    try:
                        text = _extract_text(entry, zf.read(entry))
                    except Exception:
                        continue
                    result = await loop.run_in_executor(
                        None, partial(ingest_markdown, text, title, shared_kuzu_db=get_kuzu_engine())
                    )
                    results.append({"title": title, **result})
        else:
            title = os.path.splitext(f.filename or "Untitled")[0]
            existing = await loop.run_in_executor(
                None, partial(find_existing_document, title)
            )
            if existing:
                results.append({"title": title, "skipped": True, "reason": "duplicate"})
                continue
            text = _extract_text(f.filename or "", raw)
            result = await loop.run_in_executor(
                None, partial(ingest_markdown, text, title, shared_kuzu_db=get_kuzu_engine())
            )
            results.append({"title": title, **result})

    imported = sum(1 for r in results if not r.get("skipped"))
    return {"imported": imported, "results": results}
