# BrainBank Architecture

## Overview

BrainBank is a hybrid Vector/Graph RAG system with a standalone frontend visualization. The backend ingests markdown documents and journal entries, extracts structured knowledge via Gemini, stores chunks with embeddings in LanceDB, and stores a weighted concept co-occurrence graph in Kuzu. Query-time retrieval now supports two GraphRAG paths behind the same `POST /query` contract: a local path that expands over weighted `RELATED_TO` edges and pulls latent documents through centroid search, and a global path that answers broad summary questions from persisted community summaries. Grounded answer generation can run through Gemini or a local Ollama model, with provider selection staying entirely on the backend.

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
| Clustering  | igraph + leidenalg      | Weighted Leiden community detection |
| Embeddings  | sentence-transformers   | all-MiniLM-L6-v2, 384-dim       |
| Graph Analytics | NetworkX           | Batch Louvain community detection |
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

LanceDB is the sole source of document identity and the concept-to-document link. The `concepts` field on each chunk bridges the gap between raw text and the Kuzu concept graph.

### LanceDB: `document_centroids` table

| Column          | Type         | Description                                     |
|-----------------|--------------|-------------------------------------------------|
| doc_id          | STRING       | Parent document ID                              |
| doc_name        | STRING       | Human-readable document title                   |
| centroid_vector | FLOAT32[384] | Mean embedding vector across all document chunks |

`backend/services/embeddings.py` computes this centroid by averaging all chunk `vector` values that share the same `doc_id`.

### LanceDB: `concept_centroids` table

| Column          | Type         | Description                                       |
|-----------------|--------------|---------------------------------------------------|
| concept_name    | STRING       | Canonical concept name                            |
| centroid_vector | FLOAT32[384] | Mean embedding vector across chunks tagged with that concept |
| document_count  | INT32        | Number of distinct documents containing the concept |

This table is rebuilt in batch and becomes the preferred local GraphRAG seed source when present. If it is empty, retrieval falls back to scoring concepts from chunk-seed hits.

### LanceDB: `community_summaries` table

| Column          | Type         | Description                                       |
|-----------------|--------------|---------------------------------------------------|
| community_id    | STRING       | Stable batch-assigned id such as `community:0001` |
| member_concepts | STRING[]     | Sorted concept names in the detected community    |
| summary         | STRING       | LLM-generated summary of the community            |
| summary_vector  | FLOAT32[384] | Embedding of the summary text                     |

This table powers the global GraphRAG route. It is refreshed only by the batch rebuild step, not by normal ingest.

### Kuzu: Graph Schema

**Node Tables:**
- `Concept(name STRING, colorScore DOUBLE, community_id INT64, PRIMARY KEY(name))` - knowledge concepts; `community_id` is set by Leiden clustering after each ingestion (-1 / NULL means unclassified)
- `Project(name STRING PRIMARY KEY, status STRING)` - projects the user is building
- `Task(task_id STRING PRIMARY KEY, name STRING, status STRING)` - actionable tasks
- `Reflection(reflection_id STRING PRIMARY KEY, text STRING)` - insights and observations

**Relationship Tables:**
- `RELATED_TO(Concept -> Concept, reason STRING, weight DOUBLE, edge_type STRING)` - concept relationship; `edge_type` is `'RELATED_TO'` for organic shared-document edges and `'SEMANTIC_BRIDGE'` for edges added by `heal_graph`
- `APPLIED_TO_PROJECT(Concept -> Project)` - concept is applied in a project
- `GENERATED_TASK(Concept -> Task)` - concept generated a task
- `SPARKED_REFLECTION(Concept -> Reflection)` - concept sparked a reflection
- `HAS_TASK(Project -> Task)` - project contains a task

Documents are **not** stored in Kuzu. The concept graph is a weighted co-occurrence graph: when two extracted concepts appear in the same ingested document, BrainBank creates or increments a `RELATED_TO` edge with `reason="shared_document"` and a numeric `weight`. Document nodes and MENTIONS edges in the graph API are derived at query time from LanceDB chunk metadata. `GET /api/graph` emits a stable edge shape where `type` is the relationship kind, `reason` is optional edge metadata, and `weight` carries shared-document frequency for weighted relationships. Kuzu still enforces an exclusive lock on its database path, so the API keeps one shared `kuzu.Database` instance open and serves requests with short-lived per-request connections. The backend opens this shared engine during FastAPI lifespan startup and guards singleton creation with a lock to avoid first-request concurrent-open races. When the current Kuzu Python binding reports a same-path concurrent-open failure as either `IndexError: unordered_map::at: key not found` or `IndexError: invalid unordered_map<K, T> key`, `backend/db/kuzu.py` translates that into a clear runtime error telling the caller to stop the running backend or use a different Kuzu path.

## Project Structure

```
run.sh                      - Starts backend and frontend together
frontend/
  package.json               - Frontend scripts and dependencies
  vite.config.ts             - Vite React config + /api and /ingest proxy
  index.html                 - Frontend HTML entrypoint
  public/assets/
    human-brain.glb          - Embedded glTF brain wireframe asset
    neuron-spinous-stellate-cell.glb - Simplified glTF neuron asset used for every graph node
  src/
    main.tsx                 - React entrypoint
    App.tsx                  - Layout shell, view switching (graph/editor), search
    index.css                - Tailwind import + global theme
    components/
      ChatPanel.tsx          - Right-side chat UI with session list and active conversation
      ConceptDocumentOverlay.tsx - Related-document overlay with automatic first-document selection
      EdgeDetailPanel.tsx    - Selected relationship panel with evidence documents
      Graph3D.tsx            - 3D graph scene, enlarged brain shell, cloned neuron nodes, fixed layout anchors, and interaction behavior
      IngestPanel.tsx        - New Note button + file upload + Notion import
      MarkdownDocumentViewer.tsx - Read-only markdown renderer for selected documents
      NoteEditor.tsx         - Full-page markdown note editor
      NodeTooltip.tsx        - Hover or selected-node card with optional action button
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
      mockGraph.ts           - Large multi-domain mock graph with curated notes, generated concept docs, and bridge edges
    test/
      setup.ts               - Vitest setup
    types/
      chat.ts                - Shared chat message and session types
backend/
  api.py                    - FastAPI /ingest and /query endpoints
  api_graph.py              - FastAPI router: /api/graph, /api/recluster, /api/relationships/details, /api/discovery/latent/{concept_name}, /api/concepts, /api/documents, /api/stats, /api/concepts/{name}/documents
  graph_visualization.py    - Terminal-friendly concept graph loading from Kuzu with LanceDB fallback and ASCII rendering
  schemas.py                - Shared Pydantic response models for documents, graph edges, and relationship details
  sample_data/
    college_math_notes.py   - Loads and seeds the sample college math corpus
  db/
    lance.py                - LanceDB init + chunks/document/concept/community schemas + duplicate document lookup
    kuzu.py                 - Kuzu init + graph schema (nodes + edges) + update_node_communities() + clear concurrent-open error translation
  services/
    clustering.py           - Leiden community detection: build igraph from RELATED_TO edges and return concept→community_id map
    embeddings.py           - Sentence-transformer embedding functions + document centroid calculation
    llm.py                  - Gemini extraction plus Gemini/Ollama answer generation
    notion.py               - Notion API integration: URL parsing, block→markdown conversion, page/database fetching
    pdf.py                  - PDF text extraction using PyMuPDF
  scripts/
    heal_graph.py           - Standalone script: adds SEMANTIC_BRIDGE RELATED_TO edges via chunk-vector cosine similarity
  ingestion/
    chunker.py              - Semantic text splitting by topic shift
    processor.py            - Ingest pipeline: chunk -> embed -> extract -> store
  session/
    memory.py               - In-memory session store with bounded turn window and TTL
  retrieval/
    artifacts.py            - Batch rebuild for concept centroids and community summaries
    context.py              - Deterministic context assembly for local/global GraphRAG
    global_search.py        - Community-summary retrieval plus map/reduce answer synthesis
    latent_discovery.py     - Shared concept-centroid to document-centroid discovery helpers
    local_search.py         - Local GraphRAG seed selection, weighted expansion, and latent evidence retrieval
    query.py                - Route-aware query orchestration
    routing.py              - LOCAL vs GLOBAL query classification
    types.py                - Retrieval dataclasses and internal config defaults
sample_data/
  college_math_notes/
    catalog.json            - Metadata for the sample math note corpus
    *.md                    - College student math note documents for document-opening tests
scripts/
  print_concept_graph.py      - Prints the current concept graph as an ASCII adjacency tree, with LanceDB fallback if Kuzu cannot open
  seed_college_math_notes.py - Seeds the sample math note corpus into local databases
  rebuild_graphrag_artifacts.py - Recomputes concept centroids and community summaries in batch
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
  scripts/
    test_heal_graph.py      - heal_graph: cosine similarity, centroid computation, edge-exists, bridge insertion tests
  services/
    test_clustering.py      - Leiden clustering: empty/small-graph handling + community assignment tests
    test_llm.py             - LLM extraction tests
    test_notion.py          - Notion URL parsing, rich text, and block→markdown tests
    test_pdf.py             - PDF text extraction tests
  test_api_notion.py        - Notion import API endpoint tests
  test_api_upload.py        - File upload API endpoint tests
  session/
    test_memory.py          - Session store TTL, isolation, and window tests
    test_query_with_history.py - History-aware query pipeline tests
    test_api_session.py     - Session-aware API endpoint tests
  retrieval/
    test_context.py         - Context ordering, dedupe, and budget tests
    test_local_search.py    - Seed retrieval, traversal, and discovery chunk tests
    test_query.py           - Query pipeline tests
```

Each file has a single responsibility. Tests mirror the source structure.

## Sample Data Seeding

`sample_data/college_math_notes` contains a small college-student math corpus for frontend document-opening tests. `scripts/seed_college_math_notes.py` loads the catalog, splits each markdown file into paragraph chunks, writes deterministic vectors plus chunk text into LanceDB, and upserts the matching Concept and RELATED_TO graph data into Kuzu. The seeder skips any sample `doc_id` values that are already present, so rerunning it does not duplicate the sample documents.

## Mock Data

`frontend/src/mock/mockGraph.ts` now provides a broader fallback dataset with about 100 concept nodes so the 3D brain does not collapse into a sparse center-heavy cluster during offline or demo use. The original college-student knowledge base is still there as the curated core:

- **Calculus / Physics / Philosophy / Personal reflection** keep the hand-written notes and relationship snippets that power the richer document overlays.
- **Computer Science, Biology, Economics, Psychology, Product Design, History, Arts, and Data Science** expand the graph into additional study areas so the brain has multiple visible lobes and more cross-cluster bridges.

The fallback graph currently ships with 98 concept nodes and a much denser set of `RELATED_TO` edges. Cross-domain bridges intentionally connect technical, human, and reflective areas, such as Machine Learning↔Statistics, Behavioral Economics↔Cognitive Biases, Ethics↔Accessibility, Differential Equations↔Control Theory, and Entropy↔Information Theory. Curated concepts still use the detailed markdown notes in `MOCK_CONCEPT_DOCUMENTS`, while generated concepts use domain-aware document text so opening a node still shows a useful note instead of an empty placeholder.

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
  |         +-- single-click node -> smooth camera fly to that node, pin a translucent card above it, and request latent discovery tethers
  |         +-- card "Open docs" -> open the clicked concept's related documents overlay
  |         +-- double-click node -> fly closer and open its documents in the expansion overlay
  |         +-- click document title in overlay -> render that document in the markdown reader
  |         +-- clicked concept node -> becomes the active rotation pivot
  |         +-- double-click empty space / Escape -> restore brain-centered pivot
  |         +-- right-button drag -> rotate the scene object instead of orbiting the camera
  |         +-- panel resize -> recenter the home view when the measured graph viewport changes
  v
GLTFLoader -- load human-brain.glb for the wireframe shell and neuron-spinous-stellate-cell.glb for every node clone
```

### Ingest Panel

The sidebar has a "New Note" button and a file upload option:

1. **New Note** - clicking opens a full-page WYSIWYG markdown editor (NoteEditor) that covers the entire viewport. The editor uses Milkdown Crepe (ProseMirror-based) which renders markdown inline as you type — headings appear as headings, bold renders as bold, lists indent, LaTeX math renders via KaTeX (`$inline$` and `$$block$$`). A toolbar provides formatting buttons. Markdown shortcuts work like Obsidian: type `###` for a heading, `**` for bold, `-` for a list. On save it `POST /ingest`s, refreshes the graph, and switches back to the graph view.
2. **File Upload** - user picks one or more `.md`, `.txt`, `.pdf`, or `.zip` files from the sidebar. Files are sent individually as `multipart/form-data` via `POST /ingest/upload` with per-file progress tracking ("Uploading 1 of 3..."). PDFs are converted to text server-side using PyMuPDF. Zip files are extracted in-memory; `__MACOSX` metadata and hidden files are skipped, and only `.md`, `.txt`, `.pdf` entries inside are processed. Duplicate documents (matching `doc_name` in LanceDB) are skipped, and the frontend shows a notification naming which files already exist (e.g. "notes already exists"). On completion, a summary shows the total ingested count, duplicate names, or a partial-failure message.

3. **Import from Notion** - user clicks "Import from Notion" in the sidebar, enters their Notion integration token and a page/database URL, and clicks Import. The frontend `POST /ingest/notion` sends `{token, url}`. The backend parses the URL to determine page vs database, fetches content via the Notion API, converts blocks to markdown, and runs each page through the standard ingest pipeline. Success shows the number of pages imported.

All modes trigger `useGraphData.refetch()` to reload the 3D graph. Vite proxies `/ingest` to the backend alongside `/api`.

The desktop layout locks the app to the viewport and gives the left rail, main graph/editor area, and chat column their own internal scroll behavior so a standard browser window does not need to scroll the whole page to reach the chat form or the bottom of the sidebar. The frontend uses the loaded brain mesh as a real containment boundary for the graph, not just a visual shell. It builds raycastable mesh geometry, finds an interior anchor point, and clamps out-of-bounds nodes back inward with extra surface inset so the enlarged neuron models stay inside the shell. Before the brain is added to the Three.js scene, `brainScene.centerObject3DAtOrigin()` rescales it to a larger target diagonal (`325`) so the default framing gives the visualization more room. That shell is rendered as a very light wireframe overlay (`opacity: 0.06`) so it frames the brain without competing with the neurons. `Graph3D` also loads a simplified `neuron-spinous-stellate-cell.glb`, rescales that node model to a target diagonal of `26`, clones it for every node, and recolors each clone with the same red-to-blue score gradient that the previous sphere renderer used.

Node placement is now deterministic. `Graph3D` assigns each node id a hardcoded 3D anchor from a fixed layout table, pins that anchor with `fx`, `fy`, and `fz`, and then lets the brain containment pass make any final inward adjustment that is needed. That keeps neurons distributed throughout the brain volume instead of drifting toward the center, and it makes click fly-to animations smoother because the target node no longer slides under the camera while the scene is animating. `Graph3D` disables the built-in navigation controls, keeps idle motion and right-button drag on the scene object's own rotation, reserves left-click for node interactions (single click = smooth camera fly to node, pin a semi-translucent card above the selected node, and request latent discovery tether request for concepts; double click = fly closer and open document expansion overlay), and maps scroll-wheel input to the same camera-distance zoom system used by the top-right zoom buttons. The selected-node card reuses the tooltip positioning path, but once a node is clicked it stays anchored above that node until the user clears selection or opens another target; concept cards expose an `Open docs` button that opens the same related-document overlay as the double-click path. Wheel zoom is ignored while the full-screen document overlay is open so the overlay can keep normal vertical scrolling. Relationship edges render as plain static lines with no directional particle animation, while `linkHoverPrecision` stays elevated so edge hitboxes remain easy to click. Link width scales by relationship weight (`Math.log((weight || 1) + 1) * 2.2`) so stronger relationships still read clearly without dominating the scene, and discovery ghost links stay dashed with `[2, 1]` line dashes so they read as temporary tethers. Unfocused edges use a softer translucent bluish-white base color, the graph-level edge opacity is lowered, and ghost tethers are thinner so the neuron models remain the visual priority before any hover or selection. Edge highlighting is color-only; the rendered line width stays thin even when a node or relationship is focused. The scene tracks a local focus point: the home view pins the brain centroid at world origin, and clicking or searching for a node shifts the scene position so that local node sits at world origin before any camera move. That keeps the actual rotation pivot centered in the viewport by default and keeps the selected node centered while the scene rotates. When a concept node is focused, `Graph3D` stores that node's id as the active rotation target, resolves that node's live graph coordinates on each rotation update so the selected concept center remains the local focus point during idle rotation and right-drag rotation, and persists highlight on the node's adjacent edges until the focus is cleared. Reset, `Escape`, or double-clicking empty space clears that focused pivot and restores the default brain-centered rotation mode. When a concept overlay is open, `ConceptDocumentOverlay` lists the related documents returned by `/api/concepts/{concept}/documents`, automatically opens the first document in `MarkdownDocumentViewer`, and still lets the user switch documents from the left-hand list without another API request. A `ResizeObserver` watches the graph panel's real rendered size, feeds those measured dimensions into `ForceGraph3D`, and recalculates the home view both when the chat column opens or closes and when the graph panel receives its first non-zero layout size on initial page load. That keeps the centered brain shell visually centered in the actual graph viewport instead of centering relative to stale pre-layout or full-window dimensions. During development, Vite proxies `/api/*` and `/ingest` requests to `http://localhost:8000`.

When a user clicks any visible edge, the frontend keeps that exact edge selected, dims unrelated nodes, and opens `EdgeDetailPanel` showing the edge type. Discovery Mode adds temporary latent tethers from the selected concept to semantically similar documents returned by `/api/discovery/latent/{concept_name}`; these ghost links are dashed and use a distinct violet tint, and the user can toggle them on or off from the graph UI. For `RELATED_TO` edges, the frontend also fetches `/api/relationships/details?source=...&target=...` and renders the stored reason plus shared, source-only, and target-only supporting documents. Relationship detail lookup is direction-agnostic, so the panel still opens even if the clicked edge is queried in reverse endpoint order. Non-`RELATED_TO` edges use local panel details only and do not trigger the backend evidence lookup. That panel can be dismissed either with its close button or by pressing `Escape`.

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
llm.extract_concepts() -- Gemini extracts 4-8 balanced concepts (1-2 anchors + 2-6 specific methods/entities) plus concise relationships to improve graph connectivity without concept sprawl
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
embeddings.calculate_document_centroid() -- average chunk vectors for this doc_id
  |
  v
LanceDB.add() -- store centroid row in document_centroids
  |
  v
Kuzu MERGE -- upsert Concept nodes only (no Document nodes)
  |
  v
Kuzu MERGE -- RELATED_TO edges (concept->concept) with shared-document weighting
  |
  v
clustering.run_leiden_clustering() -- build igraph from RELATED_TO edges, run Leiden (weighted)
  |
  v
kuzu.update_node_communities() -- SET c.community_id on every Concept node
```

Key behavior: Concepts are **upserted** via Cypher `MERGE`. Documents are never stored in Kuzu — document identity and concept tagging live entirely in LanceDB chunks.

## GraphRAG Artifact Rebuild Flow

```
Input: current LanceDB chunks + current Kuzu weighted concept graph
  |
  v
retrieval.artifacts._build_concept_centroid_records() -- average chunk vectors per concept
  |
  v
LanceDB replace concept_centroids -- persist concept_name, centroid_vector, document_count
  |
  v
retrieval.artifacts._load_weighted_concept_graph() -- export Concept nodes + RELATED_TO.weight
  |
  v
networkx.louvain_communities() -- deterministic weighted community detection (seed=0)
  |
  v
retrieval.artifacts._select_representative_evidence() -- choose chunk texts for each community
  |
  v
llm.generate_community_summary() -- summarize each community from member concepts + evidence
  |
  v
embeddings.embed_texts() -- embed each summary
  |
  v
LanceDB replace community_summaries -- persist community summaries for global GraphRAG
```

This rebuild is intentionally batch-only. Normal ingest updates `chunks`, `document_centroids`, `Concept` nodes, and weighted `RELATED_TO` edges immediately, but `concept_centroids` and `community_summaries` are refreshed only when `scripts/rebuild_graphrag_artifacts.py` is run.

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

## Session Memory

`backend/session/memory.py` provides an in-memory session store scoped per user session. It is separate from the knowledge graph — session memory is ephemeral and never ingested into LanceDB or Kuzu.

- **Bounded window**: each session retains at most 20 turns (configurable via `max_turns`). Older turns are trimmed automatically.
- **TTL expiration**: inactive sessions expire after 30 minutes (configurable via `ttl_seconds`). `cleanup_expired()` removes stale sessions.
- **Thread-safe**: all access is protected by a threading lock since FastAPI dispatches query work to a thread pool.
- **Session isolation**: each `session_id` has its own independent turn list.

The frontend sends `session_id` (the localStorage chat session UUID) and `history` (the last 20 messages) with each `/query` request. The backend records each user/assistant turn in the session store and passes the conversation history into the LLM prompt so it can resolve references like "it", "that", and "the second one".

## Query Flow (`POST /query`)

```
Input: { question, session_id?, history? }
  |
  v
api.py -> record user turn in SessionMemory (if session_id present)
  |
  v
api.py -> get_kuzu_engine() -- reuse the shared Kuzu Database handle
  |
  v
embeddings.embed_query() -- embed question to 384-dim vector
  |
  v
route.classify_query_route() -- GLOBAL for overview/theme prompts, otherwise LOCAL
  |
  +-- GLOBAL and community_summaries present?
  |     |
  |     v
  |   global_search.run_global_search()
  |     |
  |     +-- LanceDB search community_summaries by query vector
  |     +-- llm.generate_partial_answer() once per selected community
  |     +-- llm.synthesize_answers() if more than one community matched
  |     v
  |   Output: { answer, source_concepts, discovery_concepts=[] }
  |
  +-- otherwise LOCAL
        |
        v
      local_search.run_local_search()
        |
        +-- search concept_centroids when present, else build chunk seeds from top chunk hits
        +-- score source concepts from seed evidence
        +-- weighted BFS over RELATED_TO edges up to configured hop depth
        +-- concept-centroid -> document-centroid search for latent documents
        +-- select top chunks per latent document
        v
      context.build_local_context() -- source concepts, discovery concepts, seed evidence, latent evidence
        |
        v
      llm.generate_answer() -- grounded final answer from the assembled local GraphRAG context
        |                    includes conversation history when provided
        |
        v
      api.py -> record assistant turn in SessionMemory (if session_id present)
        |
        v
      Output: { answer, source_concepts, discovery_concepts }
```

The query route no longer opens Kuzu from path on every request. Instead it reuses the module-level `kuzu.Database` from the API layer and creates a short-lived `kuzu.Connection` inside the retrieval worker thread. Retrieval still preserves the stable `/query` contract, but internally it is now route-aware and GraphRAG-specific. Local retrieval defaults to chunk/document artifacts already produced during ingest and upgrades itself when `concept_centroids` exists. Global retrieval only activates when `community_summaries` exists; otherwise overview-style questions transparently fall back to the local path. When `session_id` and `history` are provided, the API stores turns in `SessionMemory`, and the history turns are prepended to the LLM prompt so the model can resolve follow-up references against prior turns.

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
- Returns: `{"nodes": [{"id", "type", "name", "colorScore", "community_id"}], "edges": [{"source", "target", "type", "reason", "weight"}]}`
- Full graph for frontend 3D visualization; `community_id` drives community-palette coloring in the 3D brain

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


### `GET /api/discovery/latent/{concept_name}`
- Returns: `{"concept_name": "...", "results": [{"doc_name", "similarity_score"}]}`
- Uses the same latent discovery helper as the local GraphRAG query path.
- Reads a persisted concept centroid when available, otherwise computes one from chunk vectors tagged with `concept_name`.
- Searches `document_centroids` by vector similarity.
- Excludes documents that already contain `concept_name`.
- Returns at most 5 latent-similar documents.
### `POST /api/recluster`
- No body required
- Runs Leiden clustering over all current Concept nodes and writes `community_id` back
- Returns: `{"clustered": N}` (count of concepts assigned a community)
- Useful for seeding community IDs on existing databases without triggering a new ingest

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

Frontend utility modules keep only runtime-facing exports; tests avoid depending on private helper-only camera/orbit utilities, and `graphView` is limited to the helpers the UI still calls at runtime. Graph payload validation accepts optional or null `reason` values and optional/null numeric `weight` on edges, then normalizes missing/null weights to `1` for rendering. The graph loader also tolerates `links` as a legacy alias for `edges` when normalizing API responses, and the backend graph route defaults absent relationship weights to `1.0`.

Backend API tests isolate database access at the route boundary when a handler eagerly acquires the shared Kuzu engine, so mocked ingest flows do not depend on the real `./data/kuzu` file lock.

Run: `cd frontend && npm test`

