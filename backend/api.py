from fastapi import FastAPI
from pydantic import BaseModel

from backend.api_graph import graph_router
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
def ingest(req: IngestRequest):
    result = ingest_markdown(req.text, req.title)
    return result


@app.post("/query")
def query(req: QueryRequest):
    result = query_brainbank(req.question)
    return {
        "answer": result["answer"],
        "discovery_concepts": result["discovery_concepts"],
    }


@app.post("/query/test-llm")
def query_test_llm(req: QueryRequest):
    return {
        "answer": generate_test_answer(req.question),
        "discovery_concepts": [],
        "mode": "llm_test",
    }
