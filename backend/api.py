import asyncio
import logging
import os
import threading
import zipfile
from contextlib import asynccontextmanager
from functools import partial
from io import BytesIO

from fastapi import FastAPI, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from backend.api_graph import graph_router
from backend.db.kuzu import get_kuzu_engine, update_node_communities
from backend.db.lance import init_lancedb
from backend.ingestion.consolidator import ConceptConsolidator
from backend.ingestion.processor import ingest_markdown
from backend.retrieval.query import query_brainbank
from backend.retrieval.query import prepare_brainbank_query, answer_prepared_local_query
from backend.retrieval.routing import QueryRoute
from backend.session.prepared_query_store import PreparedQueryStore
from backend.sample_data.mock_demo import seed_mock_demo_data
from backend.services.clustering import run_leiden_clustering
from backend.services.llm import generate_test_answer
from backend.services.notes_fs import content_hash_bytes, generate_doc_id, write_note
from backend.services.sync_agent import SyncAgent, get_assets_dir, get_notes_dir
from backend.services.notion import (
    fetch_database_page_ids,
    fetch_page_markdown,
    parse_notion_url,
)
from backend.services.pdf import pdf_to_text
from backend.session.memory import SessionMemory


logger = logging.getLogger(__name__)
_manual_ingest_count = 0
_manual_ingest_lock = threading.Lock()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Open the shared Kuzu database, run clustering, and start file watcher at startup."""
    db = get_kuzu_engine()
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _run_startup_clustering, db)

    sync_agent = SyncAgent(notes_dir=get_notes_dir(), auto_start=True)
    _app.state.sync_agent = sync_agent

    yield

    sync_agent.stop()


def _run_startup_clustering(db) -> None:
    if db is None:
        return
    import kuzu as _kuzu

    conn = _kuzu.Connection(db)
    try:
        community_map = run_leiden_clustering(conn)
        update_node_communities(conn, community_map)
    finally:
        conn.close()


def _run_periodic_orphan_consolidation(
    lance_db_path: str = "./data/lancedb",
) -> dict[str, int]:
    db, chunks_table = init_lancedb(lance_db_path)
    concept_centroids_table = db.open_table("concept_centroids")

    kuzu_db = get_kuzu_engine()
    import kuzu as _kuzu

    conn = _kuzu.Connection(kuzu_db)
    try:
        consolidator = ConceptConsolidator(
            chunks_table=chunks_table,
            concept_centroids_table=concept_centroids_table,
            lance_db=db,
        )
        summary = consolidator.force_consolidate_orphans(conn)
        logger.info(
            "Periodic orphan consolidation summary: forced_merges=%d orphans_seen=%d",
            summary.get("forced_merges", 0),
            summary.get("orphans_seen", 0),
        )
        return summary
    finally:
        conn.close()


app = FastAPI(title="BrainBank", version="0.1.0", lifespan=lifespan)
app.include_router(graph_router)

session_memory = SessionMemory()
prepared_query_store = PreparedQueryStore()


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


class PreparedQueryAnswerRequest(BaseModel):
    prepared_query_id: str
    session_id: str | None = None
    history: list[HistoryTurn] | None = None


@app.post("/ingest")
async def ingest(req: IngestRequest):
    global _manual_ingest_count

    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        None,
        partial(ingest_markdown, req.text, req.title, shared_kuzu_db=get_kuzu_engine()),
    )

    run_orphan_cleanup = False
    with _manual_ingest_lock:
        _manual_ingest_count += 1
        run_orphan_cleanup = (_manual_ingest_count % 5) == 0

    if run_orphan_cleanup:
        await loop.run_in_executor(None, _run_periodic_orphan_consolidation)

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
        "source_documents": result["source_documents"],
        "discovery_documents": result["discovery_documents"],
        "source_chunks": result["source_chunks"],
        "discovery_chunks": result["discovery_chunks"],
        "supporting_relationships": result["supporting_relationships"],
    }


@app.post("/query/prepare")
async def query_prepare(req: QueryRequest):
    loop = asyncio.get_event_loop()
    preparation = await loop.run_in_executor(
        None,
        partial(prepare_brainbank_query, req.question, shared_kuzu_db=get_kuzu_engine()),
    )

    if preparation.requires_direct_query:
        return preparation.to_prepare_response()

    prepared_local_query = preparation.prepared_local_query
    if prepared_local_query is None:
        return preparation.to_prepare_response()

    prepared_query_id = prepared_query_store.create(
        route=QueryRoute.LOCAL,
        preparation=prepared_local_query,
    )
    return preparation.to_prepare_response(prepared_query_id=prepared_query_id)


@app.post("/query/answer")
async def query_answer(req: PreparedQueryAnswerRequest):
    record = prepared_query_store.consume(req.prepared_query_id)
    if record is None:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="Prepared query not found or expired")

    history_dicts = None
    if req.history:
        history_dicts = [{"role": t.role, "content": t.content} for t in req.history]

    if req.session_id:
        session_memory.add_turn(req.session_id, "user", record.preparation.user_query)

    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        None,
        partial(answer_prepared_local_query, record.preparation, history=history_dicts),
    )

    if req.session_id:
        session_memory.add_turn(req.session_id, "assistant", result["answer"])

    return result


@app.post("/query/test-llm")
async def query_test_llm(req: QueryRequest):
    loop = asyncio.get_event_loop()
    answer = await loop.run_in_executor(None, partial(generate_test_answer, req.question))
    return {
        "answer": answer,
        "source_concepts": [],
        "discovery_concepts": [],
        "source_documents": [],
        "discovery_documents": [],
        "source_chunks": [],
        "discovery_chunks": [],
        "supporting_relationships": [],
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


def _save_pdf_asset(filename: str, data: bytes) -> str:
    """Save original PDF to ASSETS_DIR. Returns the asset path."""
    assets_dir = get_assets_dir()
    os.makedirs(assets_dir, exist_ok=True)
    asset_path = os.path.join(assets_dir, filename)
    with open(asset_path, "wb") as f:
        f.write(data)
    return asset_path


def _ingest_uploaded_file(filename: str, data: bytes, title: str) -> dict:
    """Process a single uploaded file: save to disk and register in manifest.

    PDFs are preserved in ASSETS_DIR and a .md stub is written to NOTES_DIR.
    Text files (.md, .txt) are written directly to NOTES_DIR.
    The manifest is updated and the SyncAgent will handle ingestion.
    """
    from backend.db.manifest import Manifest

    notes_dir = get_notes_dir()
    ext = os.path.splitext(filename)[1].lower()

    if ext == ".pdf":
        asset_path = _save_pdf_asset(filename, data)
        text = pdf_to_text(data)
        md_body = f"{text}\n\n---\nSource: [[assets/{filename}]]"
        file_path = write_note(notes_dir, title, md_body)
    else:
        text = data.decode("utf-8", errors="replace")
        file_path = write_note(notes_dir, title, text)

    content_hash = content_hash_bytes(text.encode("utf-8"))

    manifest = Manifest(notes_dir)
    existing = manifest.get_by_path(file_path)
    doc_id = existing["doc_id"] if existing else generate_doc_id()
    manifest.upsert(doc_id, file_path, content_hash, is_managed=True, status="pending")
    manifest.close()

    return {"doc_id": doc_id, "title": title, "status": "saved"}


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
                    try:
                        entry_data = zf.read(entry)
                    except Exception:
                        continue
                    result = await loop.run_in_executor(
                        None, partial(_ingest_uploaded_file, os.path.basename(entry), entry_data, title)
                    )
                    results.append(result)
        else:
            title = os.path.splitext(f.filename or "Untitled")[0]
            result = await loop.run_in_executor(
                None, partial(_ingest_uploaded_file, f.filename or "Untitled", raw, title)
            )
            results.append(result)

    imported = sum(1 for r in results if not r.get("skipped"))
    return {"imported": imported, "results": results}


@app.post("/ingest/demo/mock")
async def ingest_demo_mock():
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        None,
        partial(seed_mock_demo_data, shared_kuzu_db=get_kuzu_engine()),
    )
    return result
