# BrainBank Architecture

## Overview

BrainBank is a hybrid Vector/Graph RAG system with a standalone frontend visualization. The backend ingests markdown documents and journal entries, extracts structured knowledge via Gemini, stores chunks with embeddings in a vector DB, and stores the concept graph in a graph DB. Queries combine vector similarity search with graph traversal to surface hidden connections, while the frontend renders that graph as an interactive 3D neural map with search, hover highlighting, clickable concept relationships, supporting-document detail panels, ingest controls, and a translucent brain-shell overlay. Grounded answer generation can run through Gemini or a local Ollama model, with provider selection staying entirely on the backend.

## Stack

| Layer       | Technology              | Purpose                          |
|-------------|-------------------------|----------------------------------|
| Frontend    | React + Vite + TypeScript | Standalone graph UI            |
| UI Styling  | Tailwind CSS            | Search, sidebar, and overlays    |
| Markdown Rendering | react-markdown   | In-app read-only document viewer |
| 3D Rendering| react-force-graph-3d + Three.js | Force graph and brain shell |
| API         | FastAPI                 | HTTP endpoints                   |
| Vector DB   | LanceDB (embedded)      | Chunk storage + similarity search|
| Graph DB    | Kuzu (embedded)         | Concept graph + traversal        |
| Embeddings  | sentence-transformers   | all-MiniLM-L6-v2, 384-dim       |
| Markdown    | Milkdown Crepe (ProseMirror WYSIWYG) with bundled KaTeX support | Obsidian-like live markdown + LaTeX |
| LLM         | Gemini 2.5 Flash + Ollama | Gemini extraction + grounded answers |

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

Documents are **not** stored in Kuzu. Document nodes and MENTIONS edges in the graph API are derived at query time from LanceDB chunk metadata. `GET /api/graph` now emits a stable edge shape where `type` is the relationship kind (`RELATED_TO`, `MENTIONS`, etc.) and `reason` is optional edge metadata. For concept-to-concept edges, the human-readable relationship text lives in `reason`, not `type`. Kuzu still enforces an exclusive lock on its database path, so the API keeps one shared `kuzu.Database` instance open and serves requests with short-lived per-request connections. When the current Kuzu Python binding reports a same-path concurrent-open failure as `IndexError: unordered_map::at: key not found`, `backend/db/kuzu.py` now translates that into a clear runtime error telling the caller to stop the running backend or use a different Kuzu path.

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
    App.tsx                  - Layout shell, view switching (graph/editor), search
    index.css                - Tailwind import + global theme
    components/
      ChatPanel.tsx          - Right-side chat UI with session list and active conversation
      ConceptDocumentOverlay.tsx - Related-document overlay with document selection state
      EdgeDetailPanel.tsx    - Selected relationship panel with evidence documents
      Graph3D.tsx            - 3D graph scene, edge selection, and interaction behavior
      IngestPanel.tsx        - New Note button + file upload + Notion import
      MarkdownDocumentViewer.tsx - Read-only markdown renderer for selected documents
      NoteEditor.tsx         - Full-page markdown note editor
      NodeTooltip.tsx        - Hover tooltip
      SearchBar.tsx          - Controlled search input
    hooks/
      useChat.ts             - POST /query hook for chat state, retrieval answers, and concept metadata
      useGraphData.ts        - GET /api/graph with mock fallback + refetch
    lib/
      brainModel.ts          - Brain mesh containment math for node bounds
      brainScene.ts          - Brain model centering plus scene-focus and rotation helpers
      chatStorage.ts         - localStorage helpers for persisted chat sessions
      graphData.ts           - Graph payload validation + normalization
      graphView.ts           - Colors, adjacency, search, and camera helpers
    mock/
      mockGraph.ts           - Development graph payload
    test/
      setup.ts               - Vitest setup
    types/
      chat.ts                - Shared chat message and session types
backend/
  api.py                    - FastAPI /ingest and /query endpoints
  api_graph.py              - FastAPI router: /api/graph, /api/relationships/details, /api/concepts, /api/documents, /api/stats, /api/concepts/{name}/documents
  schemas.py                - Shared Pydantic response models for documents, graph edges, and relationship details
  sample_data/
    college_math_notes.py   - Loads and seeds the sample college math corpus
  db/
    lance.py                - LanceDB init + chunks table schema + duplicate document lookup
    kuzu.py                 - Kuzu init + graph schema (nodes + edges) + clear concurrent-open error translation
  services/
    embeddings.py           - Sentence-transformer embedding functions
    llm.py                  - Gemini extraction plus Gemini/Ollama answer generation
    notion.py               - Notion API integration: URL parsing, block→markdown conversion, page/database fetching
    pdf.py                  - PDF text extraction using PyMuPDF
  ingestion/
    chunker.py              - Semantic text splitting by topic shift
    processor.py            - Ingest pipeline: chunk -> embed -> extract -> store
  retrieval/
    context.py              - Context dedupe + budgeted prompt assembly for retrieval
    local_search.py         - Seed retrieval, graph expansion, and discovery chunk ranking
    query.py                - Query orchestration: embed -> local search -> context -> answer
    types.py                - Retrieval dataclasses and internal config defaults
sample_data/
  college_math_notes/
    catalog.json            - Metadata for the sample math note corpus
    *.md                    - College student math note documents for document-opening tests
scripts/
  seed_college_math_notes.py - Seeds the sample math note corpus into local databases
tests/
  conftest.py               - Shared fixtures + mock functions
  test_api.py               - API endpoint tests
  test_api_graph.py         - Graph export API tests
  sample_data/
    test_college_math_notes.py - Sample data loading and seeding tests
  db/
    test_lance.py           - LanceDB init tests
    test_kuzu.py            - Kuzu init tests
  ingestion/
    test_chunker.py         - Chunking logic tests
    test_processor.py       - Ingestion pipeline tests
  services/
    test_llm.py             - LLM extraction tests
    test_notion.py          - Notion URL parsing, rich text, and block→markdown tests
    test_pdf.py             - PDF text extraction tests
  test_api_notion.py        - Notion import API endpoint tests
  test_api_upload.py        - File upload API endpoint tests
  retrieval/
    test_context.py         - Context ordering, dedupe, and budget tests
    test_local_search.py    - Seed retrieval, traversal, and discovery chunk tests
    test_query.py           - Query pipeline tests
```

Each file has a single responsibility. Tests mirror the source structure.

## Sample Data Seeding

`sample_data/college_math_notes` contains a small college-student math corpus for frontend document-opening tests. `scripts/seed_college_math_notes.py` loads the catalog, splits each markdown file into paragraph chunks, writes deterministic vectors plus chunk text into LanceDB, and upserts the matching Concept and RELATED_TO graph data into Kuzu. The seeder skips any sample `doc_id` values that are already present, so rerunning it does not duplicate the sample documents.

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
  |         +-- click concept node -> persist highlight on directly connected edges
  |         +-- click RELATED_TO edge -> fetch /api/relationships/details
  |         +-- selected RELATED_TO edge -> strongest highlight + EdgeDetailPanel
  |         +-- search -> highlight matches, smooth camera fly to the first match, dim non-matching nodes
  |         +-- load -> zoomToFit for default framing
  |         +-- idle (5s) -> slow in-place scene rotation around the brain center
  |         |                 or around the currently focused concept node
  |         +-- top-right UI buttons -> zoom in / zoom out / reset
  |         +-- scroll wheel -> zoom camera in or out around the current focus point
  |         +-- single-click node -> smooth camera fly to that node (no overlay)
  |         +-- double-click node -> fly closer and open its documents in the expansion overlay
  |         +-- click document title in overlay -> render that document in the markdown reader
  |         +-- clicked concept node -> becomes the active rotation pivot
  |         +-- double-click empty space / Escape -> restore brain-centered pivot
  |         +-- right-button drag -> rotate the scene object instead of orbiting the camera
  |         +-- panel resize -> recenter the home view when the measured graph viewport changes
  v
GLTFLoader -- load human-brain.glb, center the model at the scene origin, derive mesh containment, render wireframe shell
```

### Ingest Panel

The sidebar has a "New Note" button and a file upload option:

1. **New Note** - clicking opens a full-page WYSIWYG markdown editor (NoteEditor) that covers the entire viewport. The editor uses Milkdown Crepe (ProseMirror-based) which renders markdown inline as you type — headings appear as headings, bold renders as bold, lists indent, LaTeX math renders via KaTeX (`$inline$` and `$$block$$`). A toolbar provides formatting buttons. Markdown shortcuts work like Obsidian: type `###` for a heading, `**` for bold, `-` for a list. On save it `POST /ingest`s, refreshes the graph, and switches back to the graph view.
2. **File Upload** - user picks one or more `.md`, `.txt`, `.pdf`, or `.zip` files from the sidebar. Files are sent individually as `multipart/form-data` via `POST /ingest/upload` with per-file progress tracking ("Uploading 1 of 3..."). PDFs are converted to text server-side using PyMuPDF. Zip files are extracted in-memory; `__MACOSX` metadata and hidden files are skipped, and only `.md`, `.txt`, `.pdf` entries inside are processed. Duplicate documents (matching `doc_name` in LanceDB) are skipped, and the frontend shows a notification naming which files already exist (e.g. "notes already exists"). On completion, a summary shows the total ingested count, duplicate names, or a partial-failure message.

3. **Import from Notion** - user clicks "Import from Notion" in the sidebar, enters their Notion integration token and a page/database URL, and clicks Import. The frontend `POST /ingest/notion` sends `{token, url}`. The backend parses the URL to determine page vs database, fetches content via the Notion API, converts blocks to markdown, and runs each page through the standard ingest pipeline. Success shows the number of pages imported.

All modes trigger `useGraphData.refetch()` to reload the 3D graph. Vite proxies `/ingest` to the backend alongside `/api`.

The desktop layout locks the app to the viewport and gives the left rail, main graph/editor area, and chat column their own internal scroll behavior so a standard browser window does not need to scroll the whole page to reach the chat form or the bottom of the sidebar. The frontend also uses the loaded brain mesh as a real containment boundary for the force layout, not just a visual shell. It builds raycastable mesh geometry, finds an interior anchor point, and clamps out-of-bounds nodes back inward with extra surface inset so the full rendered node spheres stay inside the model during simulation. Before the brain is added to the Three.js scene, `brainScene.centerObject3DAtOrigin()` rescales the loaded GLTF, computes its bounding-box centroid, and offsets the model into a zeroed pivot group at the scene origin. `Graph3D` disables the built-in navigation controls, keeps idle motion and right-button drag on the scene object's own rotation, reserves left-click for node interactions (single click = smooth camera fly to node, double click = fly closer and open document expansion overlay), and maps scroll-wheel input to the same camera-distance zoom system used by the top-right zoom buttons. Wheel zoom is ignored while the full-screen document overlay is open so the overlay can keep normal vertical scrolling. Relationship edges render as plain static lines with no directional particle animation, while `linkHoverPrecision` stays elevated so edge hitboxes remain easy to click. Edge highlighting is color-only; the rendered line width stays thin even when a node or relationship is focused. The scene now tracks a local focus point: the home view pins the brain centroid at world origin, and clicking or searching for a node shifts the scene position so that local node sits at world origin before any camera move. That keeps the actual rotation pivot centered in the viewport by default and keeps the selected node centered while the scene rotates. When a concept node is focused, `Graph3D` also stores that node's id as the active rotation target, resolves that node's live graph coordinates on each rotation update so the selected concept center remains the local focus point during idle rotation and right-drag rotation, and persists highlight on the node's adjacent edges until the focus is cleared. Reset, `Escape`, or double-clicking empty space clears that focused pivot and restores the default brain-centered rotation mode. When a concept overlay is open, `ConceptDocumentOverlay` lists the related documents returned by `/api/concepts/{concept}/documents`, and clicking a document title sends that document into `MarkdownDocumentViewer`, which renders `full_text` in-place via `react-markdown` without another API request. A `ResizeObserver` watches the graph panel's real rendered size, feeds those measured dimensions into `ForceGraph3D`, and recalculates the home view both when the chat column opens or closes and when the graph panel receives its first non-zero layout size on initial page load. That keeps the centered brain shell visually centered in the actual graph viewport instead of centering relative to stale pre-layout or full-window dimensions. During development, Vite proxies `/api/*` and `/ingest` requests to `http://localhost:8000`.

When a user clicks any visible edge, the frontend keeps that exact edge selected, dims unrelated nodes, and opens `EdgeDetailPanel` showing the edge type. For `RELATED_TO` edges, the frontend also fetches `/api/relationships/details?source=...&target=...` and renders the stored reason plus shared, source-only, and target-only supporting documents. Relationship detail lookup is direction-agnostic, so the panel still opens even if the clicked edge is queried in reverse endpoint order. Non-`RELATED_TO` edges use local panel details only and do not trigger the backend evidence lookup. That panel can be dismissed either with its close button or by pressing `Escape`.

## Frontend Chat Flow

```
Input: user question in right-side panel
  |
  v
ChatPanel -- controlled input + session message history
  |
  v
useChat -- load/create/select persisted sessions and expose active messages
  |
  +-- localStorage via chatStorage -- restore sessions + active session id
  |
  v
useChat.sendMessage() -- append user message to active session and set loading state
  |
  v
POST /query -- proxied by Vite in development to the backend API
  |
  v
Backend returns { answer, source_concepts, discovery_concepts }
  |
  v
ChatPanel -- render assistant answer + separate source/discovery concept sections
```

Chat state now persists in browser `localStorage` under explicit `brainbank.chat.*` keys. `useChat` owns a list of chat sessions, tracks the active session, creates a default empty session when needed, renames a session from its first user message, and keeps sessions ordered by `updatedAt`. `App` keeps the chat subtree mounted at all times so closing the overlay is purely a visibility change and does not reset local component state. The frontend uses the real retrieval route, and assistant messages preserve both `sourceConcepts` and `discoveryConcepts` so the UI can show what came directly from search versus graph expansion. Model access still happens only on the backend; the frontend never receives or stores provider credentials.

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

## Notion Import Flow (`POST /ingest/notion`)

```
Input: { token, url }
  |
  v
parse_notion_url(url) -- extract (kind, uuid) from Notion URL or raw ID
  |                       "page" if no ?v= param, "database" if ?v= present
  v
kind == "database"?
  |          |
  no         yes -> fetch_database_page_ids(token, uuid) -- query DB for page IDs
  |          |
  v          v
page_ids = [uuid]    page_ids = [id1, id2, ...]
  |
  v
For each page_id:
  fetch_page_markdown(token, page_id) -- Notion API: retrieve page + all blocks
    |
    v
  blocks_to_markdown(blocks) -- convert Notion blocks to markdown string
    |                            supports: headings, paragraphs, lists, code,
    |                            quotes, callouts, equations, to-dos, dividers
    v
  ingest_markdown(markdown, title) -- standard ingest pipeline (chunk, embed, store)
  |
  v
Output: { imported: N, pages: [{ title, doc_id, chunks, concepts }] }
```

The Notion service (`backend/services/notion.py`) handles URL parsing, rich text annotation conversion (bold, italic, code, strikethrough, links), and block-to-markdown translation. It uses the `notion-client` Python SDK. Each imported page goes through the same ingestion pipeline as manually created notes.

## Query Flow (`POST /query`)

```
Input: question
  |
  v
api.py -> get_kuzu_engine() -- reuse the shared Kuzu Database handle
  |
  v
embeddings.embed_query() -- embed question to 384-dim vector
  |
  v
local_search.build_chunk_seed_set() -- top 5 nearest chunks + ordered source concepts
  |
  v
local_search.expand_related_concepts() -- configurable BFS over RELATED_TO edges
  v
local_search.select_discovery_chunks() -- ranked extra chunks for discovery concepts
  v
context.assemble_context_chunks() -- seed chunks first, then discovery chunks,
  |                                 dedupe by chunk id/text, apply word budget
  |
  v
context.build_context_text() -- join selected chunk texts with separators
  |
  v
llm.generate_answer() -- Gemini or Ollama generates grounded answer from ordered context
  |
  v
Output: { answer, source_concepts, discovery_concepts }
```

The query route no longer opens Kuzu from path on every request. Instead it reuses the module-level `kuzu.Database` from the API layer and creates a short-lived `kuzu.Connection` inside the retrieval worker thread. The retrieval path is still local-search-only in this phase, but it is now split into explicit steps with an internal `RetrievalConfig` for seed limits, graph-hop depth, discovery-chunk limits, and context budget. Default behavior stays equivalent to the old path: top-5 chunk seeds, 1-hop graph expansion, and the same external `/query` response shape.

## API Endpoints

### `POST /ingest`
- Body: `{"text": "...", "title": "..."}`
- Returns: `{"doc_id": "...", "chunks": N, "concepts": [...]}`

### `POST /query`
- Body: `{"question": "..."}`
- Returns: `{"answer": "...", "source_concepts": [...], "discovery_concepts": [...]}`

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

### `POST /ingest/upload`
- Body: `multipart/form-data` with one or more files under the `files` field
- Accepts `.md`, `.txt`, `.pdf`, `.zip` files
- PDFs are converted to text server-side via PyMuPDF
- Zip files are extracted in-memory; `__MACOSX`/hidden files skipped, only `.md`/`.txt`/`.pdf` entries processed
- Duplicate documents (matching `doc_name` in LanceDB) are skipped with `{"skipped": true, "reason": "duplicate"}`
- Returns: `{"imported": N, "results": [{"title", "doc_id", "chunks", "concepts"}]}`
- Errors: `400` with `{"error": "..."}` for unsupported file types

### `POST /ingest/notion`
- Body: `{"token": "ntn_...", "url": "https://notion.so/..."}`
- URL can be a Notion page URL, database URL (with `?v=`), or raw 32-hex ID
- Returns: `{"imported": N, "pages": [{"title", "doc_id", "chunks", "concepts"}]}`
- Errors: `400` with `{"error": "..."}` for invalid URLs or Notion API failures

### `GET /api/stats`
- Returns: `{"total_documents", "total_chunks", "total_concepts", "total_relationships"}`

## Configuration

| Variable       | Required | Purpose            |
|----------------|----------|--------------------|
| GEMINI_API_KEY | Yes      | Gemini API authentication |
| GEMINI_MODEL   | No       | Override model name (default: `gemini-2.5-flash`) |
| TEST_LLM_PROVIDER | No    | Test route provider: `gemini` or `ollama` |
| OLLAMA_BASE_URL | No      | Local Ollama base URL (default: `http://localhost:11434`) |
| OLLAMA_MODEL | No         | Local Ollama model for the test route (default: `llama3.2:3b`) |

Database paths default to `./data/lancedb` and `./data/kuzu`.

## Testing

Tests mock both the LLM (`extract_concepts`, `generate_answer`) and embeddings (`embed_texts`, `embed_query`) so they run without API keys or model downloads. Mock embeddings use deterministic SHA-256 hashes padded to 384 dimensions.

Run: `uv run pytest tests/ -v`

Frontend tests use Vitest and Testing Library to cover payload normalization, helper logic, brain containment math, mock fallback behavior, and the graph shell UI.

Frontend utility modules keep only runtime-facing exports; tests avoid depending on private helper-only camera/orbit utilities, and `graphView` is limited to the helpers the UI still calls at runtime.

Backend API tests isolate database access at the route boundary when a handler eagerly acquires the shared Kuzu engine, so mocked ingest flows do not depend on the real `./data/kuzu` file lock.

Run: `cd frontend && npm test`
