# BrainBank Architecture

## Overview

BrainBank is a hybrid Vector/Graph RAG system with a standalone frontend visualization. The backend ingests markdown documents, extracts concepts and relationships via LLM, stores chunks with embeddings in a vector DB, and stores the concept graph in a graph DB. The frontend renders that graph as an interactive 3D neural map with search, hover highlighting, and a translucent brain-shell overlay.

## Stack

| Layer       | Technology              | Purpose                          |
|-------------|-------------------------|----------------------------------|
| Frontend    | React + Vite + TypeScript | Standalone graph UI            |
| UI Styling  | Tailwind CSS            | Search, sidebar, and overlays    |
| 3D Rendering| react-force-graph-3d + Three.js | Force graph and brain shell |
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

**Relationship Tables:**
- `MENTIONS(Document -> Concept, chunk_ids STRING[])` - which chunks in a document mention a concept
- `RELATED_TO(Concept -> Concept, relationship STRING)` - semantic relationships between concepts

## Project Structure

```
frontend/
  package.json               - Frontend scripts and dependencies
  vite.config.ts             - Vite React config + /api proxy
  index.html                 - Frontend HTML entrypoint
  public/assets/
    human-brain.glb          - Embedded glTF brain wireframe asset
  src/
    main.tsx                 - React entrypoint
    App.tsx                  - Layout shell, legend, and search state
    index.css                - Tailwind import + global theme
    components/
      Graph3D.tsx            - 3D graph scene and interaction behavior
      SearchBar.tsx          - Controlled search input
      NodeTooltip.tsx        - Hover tooltip
    hooks/
      useGraphData.ts        - GET /api/graph with mock fallback
    lib/
      graphData.ts           - Graph payload validation + normalization
      graphView.ts           - Colors, adjacency, and match helpers
    mock/
      mockGraph.ts           - Development graph payload
    test/
      setup.ts               - Vitest setup
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

## Frontend Graph Flow

```
Input: frontend boot
  |
  v
useGraphData() -- GET /api/graph
  |               |
  |               +-- invalid / unavailable -> mockGraph fallback
  v
graphData.normalizeGraphData() -- convert { nodes, edges } -> { nodes, links }
  |
  v
Graph3D -- react-force-graph-3d scene
  |         |
  |         +-- hover -> highlight node + neighbors, tooltip
  |         +-- search -> highlight matches, zoom camera
  |         +-- idle -> orbit controls auto-rotate
  v
GLTFLoader -- load human-brain.glb as a translucent wireframe shell
```

The frontend treats the brain model as a visual shell around the graph, not as a hard layout constraint. During development, Vite proxies `/api/*` requests to `http://localhost:8000`.

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

### `GET /api/graph`
- Intended payload: `{"nodes": [...], "edges": [...]}`
- Current frontend behavior: fetch this route and fall back to local mock data until the backend endpoint exists

## Configuration

| Variable       | Required | Purpose            |
|----------------|----------|--------------------|
| GEMINI_API_KEY | Yes      | Gemini 1.5 Flash   |

Database paths default to `./data/lancedb` and `./data/kuzu`.

## Testing

Tests mock both the LLM (`extract_concepts`, `generate_answer`) and embeddings (`embed_texts`, `embed_query`) so they run without API keys or model downloads. Mock embeddings use deterministic SHA-256 hashes padded to 384 dimensions.

Run: `uv run pytest tests/ -v`

Frontend tests use Vitest and Testing Library to cover payload normalization, helper logic, mock fallback behavior, and the graph shell UI.

Run: `cd frontend && npm test`
