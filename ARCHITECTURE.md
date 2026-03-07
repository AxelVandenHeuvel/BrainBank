# BrainBank Architecture

## Overview

BrainBank is a hybrid Vector/Graph RAG system with a standalone frontend visualization. The backend ingests markdown documents and journal entries, extracts structured knowledge via Gemini, stores chunks with embeddings in a vector DB, and stores the concept graph in a graph DB. Queries combine vector similarity search with graph traversal to surface hidden connections, while the frontend renders that graph as an interactive 3D neural map with search, hover highlighting, ingest controls, and a translucent brain-shell overlay.

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
| LLM         | Gemini 1.5 Flash        | Knowledge extraction + answers   |

## Data Model

### LanceDB: `chunks` table

| Column   | Type              | Description                              |
|----------|-------------------|------------------------------------------|
| chunk_id | STRING            | Unique ID per chunk                      |
| doc_id   | STRING            | Parent document ID                       |
| doc_name | STRING            | Human-readable document title            |
| text     | STRING            | Chunk text content                       |
| concepts | STRING[]          | Concepts mentioned in this chunk         |
| vector   | FLOAT32[384]      | Embedding vector                         |

LanceDB is the sole source of document identity and the concept→document link. The `concepts` field on each chunk bridges the gap between raw text and the Kuzu concept graph.

### Kuzu: Graph Schema

**Node Tables:**
- `Concept(name STRING PRIMARY KEY)` - knowledge concepts extracted from documents
- `Project(name STRING PRIMARY KEY, status STRING)` - projects the user is building
- `Task(task_id STRING PRIMARY KEY, name STRING, status STRING)` - actionable tasks
- `Reflection(reflection_id STRING PRIMARY KEY, text STRING)` - insights and observations

**Relationship Tables:**
- `RELATED_TO(Concept -> Concept, reason STRING)` - semantic relationships between concepts
- `APPLIED_TO_PROJECT(Concept -> Project)` - concept is applied in a project
- `GENERATED_TASK(Concept -> Task)` - concept generated a task
- `SPARKED_REFLECTION(Concept -> Reflection)` - concept sparked a reflection
- `HAS_TASK(Project -> Task)` - project contains a task

Documents are **not** stored in Kuzu. Document nodes and MENTIONS edges in the graph API are derived at query time from LanceDB chunk metadata.

## Project Structure

```
run.sh                      - Starts backend and frontend together
frontend/
  package.json               - Frontend scripts and dependencies
  vite.config.ts             - Vite React config + /api and /ingest proxy
  index.html                 - Frontend HTML entrypoint
  public/assets/
    human-brain.glb          - Embedded glTF brain wireframe asset
  src/
    main.tsx                 - React entrypoint
    App.tsx                  - Layout shell, legend, and search state
    index.css                - Tailwind import + global theme
    components/
      ChatPanel.tsx          - Right-side chat UI for LLM query history
      Graph3D.tsx            - 3D graph scene and interaction behavior
      IngestPanel.tsx        - Note input + file upload for ingestion
      SearchBar.tsx          - Controlled search input
      NodeTooltip.tsx        - Hover tooltip
    hooks/
      useChat.ts             - POST /query hook for chat state and answers
      useGraphData.ts        - GET /api/graph with mock fallback
      useGraphData.ts        - GET /api/graph with mock fallback + refetch
    lib/
      brainModel.ts          - Brain mesh containment math for node bounds
      graphData.ts           - Graph payload validation + normalization
      graphView.ts           - Colors, adjacency, search, and camera helpers
    mock/
      mockGraph.ts           - Development graph payload
    test/
      setup.ts               - Vitest setup
backend/
  api.py                    - FastAPI /ingest and /query endpoints
  api_graph.py              - FastAPI router: /api/graph, /api/concepts, /api/documents, /api/stats, /api/concepts/{name}/documents
  schemas.py                - Shared Pydantic response models (DocumentResponse)
  db/
    lance.py                - LanceDB init + chunks table schema
    kuzu.py                 - Kuzu init + graph schema (nodes + edges)
  services/
    embeddings.py           - Sentence-transformer embedding functions
    llm.py                  - Gemini API for legacy concept extraction, richer knowledge extraction, and answer gen
  ingestion/
    chunker.py              - Text splitting by paragraphs
    journal_parser.py       - Regex-based journal pre-processor for sections, tasks, and reflections
    chunker.py              - Semantic text splitting by topic shift
    processor.py            - Ingest pipeline: chunk -> embed -> extract -> store
  retrieval/
    query.py                - Query pipeline: search -> expand -> answer
tests/
  conftest.py               - Shared fixtures + mock functions
  test_api.py               - API endpoint tests
  test_api_graph.py         - Graph export API tests
  db/
    test_lance.py           - LanceDB init tests
    test_kuzu.py            - Kuzu init tests
  ingestion/
    test_chunker.py         - Chunking logic tests
    test_journal_parser.py  - Journal parsing tests
    test_processor.py       - Ingestion pipeline tests
  services/
    test_llm.py             - LLM extraction tests
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
  |         +-- load -> zoomToFit for default framing
  |         +-- idle (5s) -> slow camera auto-rotation
  |         +-- top-right UI buttons -> zoom in / zoom out / reset
  |         +-- double-click node -> focus camera on that node
  v
GLTFLoader -- load human-brain.glb, derive mesh containment, render wireframe shell
```

### Ingest Panel

The sidebar includes a collapsible IngestPanel with two modes:

1. **Quick Note** - user types a title + markdown content, clicks "Add to Brain"
2. **File Upload** - user picks a `.md` or `.txt` file, contents are read client-side

Both modes `POST /ingest` with `{title, text}`. On success the panel shows concept count and triggers `useGraphData.refetch()` to reload the 3D graph with new data. Vite proxies `/ingest` to the backend alongside `/api`.

The frontend uses the loaded brain mesh as a real containment boundary for the force layout, not just a visual shell. It builds raycastable mesh geometry, finds an interior anchor point, and clamps out-of-bounds nodes back inward with extra surface inset so the full rendered node spheres stay inside the model during simulation. Graph3D also manages its own camera state: it auto-centers on load, resumes slow rotation after 5 seconds of inactivity, cancels rotation on pointer activity, exposes floating controls in the upper-right corner, and supports double-click node focus. During development, Vite proxies `/api/*` and `/ingest` requests to `http://localhost:8000`.

## Frontend Chat Flow

```
Input: user question in right-side panel
  |
  v
ChatPanel -- controlled input + session message history
  |
  v
useChat.sendMessage() -- append user message and set loading state
  |
  v
POST http://localhost:8000/query
  |
  v
Backend returns { answer, discovery_concepts }
  |
  v
ChatPanel -- render assistant answer + discovery concept tags
```

Chat history persists for the current browser session because it lives in React state inside `useChat`. No local storage or backend persistence is involved yet. The panel is toggled from a single side-mounted control so it can collapse without adding a second toolbar area.

## Ingestion Flow (`POST /ingest`)

```
Input: text + title
  |
  v
llm.extract_concepts() -- Gemini extracts concepts + relationships
  |
  v
chunker.semantic_chunk_text() -- split by topic shift using sentence similarity
  |
  v
embeddings.embed_texts() -- sentence-transformers -> 384-dim vectors
  |
  v
LanceDB.add() -- store chunks with doc_name, concepts[], and vectors
  |              concepts field is the doc<->concept bridge (no Kuzu Document node)
  v
Kuzu MERGE -- upsert Concept nodes only (no Document nodes)
  |
  v
Kuzu CREATE -- RELATED_TO edges (concept->concept with reason)
```

Key behavior: Concepts are **upserted** via Cypher `MERGE`. Documents are never stored in Kuzu — document identity and concept tagging live entirely in LanceDB chunks.

## Journal Parsing Flow

```
Input: raw journal text
  |
  v
journal_parser.parse_journal_entry()
  |
  +-- sections         -- extracted from `##` headings
  +-- raw_tasks        -- extracted from `- [ ]` and `- TODO`
  +-- raw_reflections  -- extracted from `Today I learned` and `Insight:`
  |
  v
full_text             -- cleaned text passed to later extraction steps
```

This parser is intentionally shallow. It provides structure hints only. Semantic extraction remains the LLM's responsibility.

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
- Returns: `{"nodes": [{"id", "type", "name"}], "edges": [{"source", "target", "type"}]}`
- Full graph for frontend 3D visualization

### `GET /api/concepts`
- Returns: `{"concepts": [{"name", "document_count", "related_concepts"}]}`

### `GET /api/documents`
- Returns: `{"documents": [{"doc_id", "name", "chunk_count", "concepts"}]}`

### `GET /api/concepts/{concept_name}/documents`
- Returns: `[{"doc_id", "name", "full_text"}]`
- Queries LanceDB only (no Kuzu). Filters chunks by concept tag, deduplicates by doc_id, and joins all chunk texts into one readable document per result.
- Returns `[]` if no documents are found for the concept.

### `GET /api/stats`
- Returns: `{"total_documents", "total_chunks", "total_concepts", "total_relationships"}`

## Configuration

| Variable       | Required | Purpose            |
|----------------|----------|--------------------|
| GEMINI_API_KEY | Yes      | Gemini 1.5 Flash   |

Database paths default to `./data/lancedb` and `./data/kuzu`.

## Testing

Tests mock both the LLM (`extract_concepts`, `extract_knowledge`, `generate_answer`) and embeddings (`embed_texts`, `embed_query`) so they run without API keys or model downloads. Mock embeddings use deterministic SHA-256 hashes padded to 384 dimensions.

Run: `uv run pytest tests/ -v`

Frontend tests use Vitest and Testing Library to cover payload normalization, helper logic, brain containment math, mock fallback behavior, and the graph shell UI.

Run: `cd frontend && npm test`
