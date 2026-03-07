# BrainBank Architecture

## Overview

BrainBank is a hybrid Vector/Graph RAG system. It ingests markdown documents, extracts concepts and relationships via LLM, stores chunks with embeddings in a vector DB, and stores the concept graph in a graph DB. Queries combine vector similarity search with graph traversal to surface hidden connections.

## Stack

| Layer       | Technology              | Purpose                          |
|-------------|-------------------------|----------------------------------|
| API         | FastAPI                 | HTTP endpoints                   |
| Vector DB   | LanceDB (embedded)      | Chunk storage + similarity search|
| Graph DB    | Kuzu (embedded)         | Concept graph + traversal        |
| Embeddings  | sentence-transformers   | all-MiniLM-L6-v2, 384-dim       |
| LLM         | Gemini 1.5 Flash        | Concept extraction + answers     |

## Data Model

### LanceDB: `chunks` table

| Column   | Type              | Description                |
|----------|-------------------|----------------------------|
| chunk_id | STRING            | Unique ID per chunk        |
| doc_id   | STRING            | Parent document ID         |
| text     | STRING            | Chunk text content         |
| vector   | FLOAT32[384]      | Embedding vector           |

### Kuzu: Graph Schema

**Node Tables:**
- `Concept(name STRING PRIMARY KEY)` - knowledge concepts
- `Document(doc_id STRING PRIMARY KEY, name STRING)` - ingested documents
- `Project(name STRING PRIMARY KEY, status STRING)` - projects the user is building
- `Task(task_id STRING PRIMARY KEY, name STRING, status STRING)` - actionable tasks
- `Reflection(reflection_id STRING PRIMARY KEY, text STRING)` - insights and observations

**Relationship Tables:**
- `MENTIONS(Document -> Concept, chunk_ids STRING[])` - which chunks in a document mention a concept
- `RELATED_TO(Concept -> Concept, relationship STRING)` - semantic relationships between concepts
- `PART_OF(Concept -> Concept)` - concept is a sub-concept of another
- `INSPIRED_BY(Concept -> Concept)` - concept was inspired by another
- `DEPENDS_ON(Concept -> Concept)` - concept depends on another
- `LEARNED_FROM(Concept -> Concept)` - concept was learned from another
- `HAS_TASK(Project -> Task)` - project contains a task
- `USES_CONCEPT(Project -> Concept)` - project uses a concept
- `HAS_REFLECTION(Document -> Reflection)` - document contains a reflection
- `MENTIONS_PROJECT(Document -> Project)` - document mentions a project
- `MENTIONS_TASK(Document -> Task)` - document mentions a task

## Project Structure

```
backend/
  api.py                    - FastAPI /ingest and /query endpoints
  db/
    lance.py                - LanceDB init + chunks table schema
    kuzu.py                 - Kuzu init + graph schema (nodes + edges)
  services/
    embeddings.py           - Sentence-transformer embedding functions
    llm.py                  - Gemini API for concept extraction + answer gen
  ingestion/
    chunker.py              - Text splitting by paragraphs
    processor.py            - Ingest pipeline: chunk -> embed -> extract -> store
  retrieval/
    query.py                - Query pipeline: search -> expand -> answer
tests/
  conftest.py               - Shared fixtures + mock functions
  test_api.py               - API endpoint tests
  db/
    test_lance.py           - LanceDB init tests
    test_kuzu.py            - Kuzu init tests
  ingestion/
    test_chunker.py         - Chunking logic tests
    test_processor.py       - Ingestion pipeline tests
  retrieval/
    test_query.py           - Query pipeline tests
```

Each file has a single responsibility. Tests mirror the source structure.

## Ingestion Flow (`POST /ingest`)

```
Input: text + title
  |
  v
chunker.chunk_text() -- split by paragraphs, ~500 chars each
  |
  v
embeddings.embed_texts() -- sentence-transformers -> 384-dim vectors
  |
  v
LanceDB.add() -- store chunks with vectors
  |
  v
llm.extract_concepts() -- Gemini extracts concepts + relationships
  |
  v
Kuzu MERGE -- upsert Concept nodes (no duplicates)
  |
  v
Kuzu CREATE edges -- MENTIONS (doc->concept with chunk_ids)
                  -- RELATED_TO (concept->concept)
```

Key behavior: Concepts are **upserted** via Cypher `MERGE`. If "Calculus" already exists from a previous document, it is reused, not duplicated. New MENTIONS edges link the new document's chunks to the existing concept.

## Query Flow (`POST /query`)

```
Input: question
  |
  v
embeddings.embed_query() -- embed question to 384-dim vector
  |
  v
LanceDB.search() -- top 5 nearest chunks (vector similarity)
  |
  v
Kuzu: find Concepts -- for each chunk_id, find linked Concept nodes
  |                     via MENTIONS edges (list_contains on chunk_ids)
  v
Kuzu: 1-hop expansion -- for each source Concept, find RELATED_TO
  |                       neighbors = "discovery concepts"
  v
Retrieve expanded chunks -- get chunk texts for discovery concepts
  |
  v
llm.generate_answer() -- Gemini generates grounded answer from all context
  |
  v
Output: { answer, discovery_concepts }
```

The 1-hop graph expansion is what surfaces "hidden" connections - concepts not in the original search results but semantically linked through the knowledge graph.

## API Endpoints

### `POST /ingest`
- Body: `{"text": "...", "title": "..."}`
- Returns: `{"doc_id": "...", "chunks": N, "concepts": [...]}`

### `POST /query`
- Body: `{"question": "..."}`
- Returns: `{"answer": "...", "discovery_concepts": [...]}`

## Configuration

| Variable       | Required | Purpose            |
|----------------|----------|--------------------|
| GEMINI_API_KEY | Yes      | Gemini 1.5 Flash   |

Database paths default to `./data/lancedb` and `./data/kuzu`.

## Testing

Tests mock both the LLM (`extract_concepts`, `generate_answer`) and embeddings (`embed_texts`, `embed_query`) so they run without API keys or model downloads. Mock embeddings use deterministic SHA-256 hashes padded to 384 dimensions.

Run: `uv run pytest tests/ -v`
