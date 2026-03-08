import asyncio
from functools import partial

from fastapi import FastAPI
from pydantic import BaseModel

from backend.api_graph import graph_router, kuzu_db
from backend.ingestion.processor import ingest_markdown
from backend.retrieval.query import query_brainbank
from backend.services.llm import generate_test_answer

app = FastAPI(title="BrainBank", version="0.1.0")
app.include_router(graph_router)


class IngestRequest(BaseModel):
    text: str
    title: str


class QueryRequest(BaseModel):
    question: str


@app.post("/ingest")
async def ingest(req: IngestRequest):
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, partial(ingest_markdown, req.text, req.title, shared_kuzu_db=kuzu_db))
    return result


@app.post("/query")
async def query(req: QueryRequest):
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, partial(query_brainbank, req.question))
    return {
        "answer": result["answer"],
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
