# BrainBank Architecture

## Overview

BrainBank is a hybrid Vector/Graph RAG system with a standalone frontend visualization. The backend ingests markdown documents and journal entries, extracts structured knowledge through a backend-selected LLM provider, stores chunks with embeddings in LanceDB, and stores a weighted concept co-occurrence graph in Kuzu. Ingest now includes concept consolidation: extraction receives top canonical concept hints, semantically equivalent mentions are mapped onto canonical names, low-density concepts can be merged into broader neighbors, and a strict orphan pass can force-merge sparse concepts into a parent candidate set. Query-time retrieval now supports two GraphRAG paths: a local path that expands over weighted `RELATED_TO` edges and pulls latent documents through centroid search, and a global path that answers broad summary questions from persisted community summaries. The legacy `POST /query` route still handles both paths end-to-end, while the local path also exposes a staged flow through `POST /query/prepare` plus `POST /query/answer`. That staged local flow lets the frontend start a neuron-firing animation from the actual retrieval traversal plan before the grounded LLM answer finishes. Both routes surface document provenance in the final answer payload: the local path carries cited source/discovery documents, chunks, and supporting relationships from retrieval-time provenance assembly, while the global path maps cited community concepts back to ranked underlying documents so summary-style answers are not missing note links. Grounded answer generation can run through Gemini or a local Ollama model, with provider selection staying entirely on the backend and flowing through a single provider registry.

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
| LLM         | Gemini 2.5 Flash + Gemini 3.1 Flash-Lite + Ollama | Gemini extraction/forced orphan merge decisions + grounded answers |

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

This table is rebuilt in batch and becomes the preferred local GraphRAG seed source when present. It is also used by ingest for two consolidation tasks: passing high-frequency concept names as extraction hints, and semantic canonicalization/nearest-neighbor merge decisions for concept density control. If it is empty, retrieval falls back to scoring concepts from chunk-seed hits.

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

Documents are **not** stored in Kuzu. The concept graph is a weighted co-occurrence graph: when two extracted concepts appear in the same ingested document, BrainBank creates or increments a `RELATED_TO` edge with `reason="shared_document"` and a numeric `weight`. Document nodes and MENTIONS edges in the graph API are derived at query time from LanceDB chunk metadata. `GET /api/graph` emits a stable edge shape where `type` is the relationship kind, `reason` is optional edge metadata, and `weight` carries shared-document frequency for weighted relationships. Kuzu still enforces an exclusive lock on its database path, so the API keeps one shared `kuzu.Database` instance open and serves requests with short-lived per-request connections. The backend opens this shared engine during FastAPI lifespan startup and guards singleton creation with a lock to avoid first-request concurrent-open races. If the shared Kuzu catalog is unreadable because the file is invalid or internally inconsistent, `get_kuzu_engine()` now backs up the broken file, creates a fresh Kuzu database at the same path, and reconstructs `Concept` plus `RELATED_TO` from LanceDB chunk metadata before reclustering communities. This repair path is intentionally limited to the shared API singleton; `init_kuzu()` remains strict so tests, scripts, and one-off callers still surface invalid-path failures instead of silently mutating arbitrary databases. When the current Kuzu Python binding reports a same-path concurrent-open failure as either `IndexError: unordered_map::at: key not found` or `IndexError: invalid unordered_map<K, T> key`, `backend/db/kuzu.py` translates that into a clear runtime error telling the caller to stop the running backend or use a different Kuzu path. `backend/db/kuzu.py` also exposes `merge_concepts(conn, source_name, target_name)` to move `RELATED_TO` edges from one concept to another, sum overlapping edge weights, and delete the source node; query workers can reuse an already-open database handle for a path if a lock conflict is encountered.

## Project Structure

```
run.sh                      - Starts backend and frontend together
frontend/
  package.json               - Frontend scripts and dependencies
  vite.config.ts             - Vite React config + /api and /ingest proxy
  index.html                 - Frontend HTML entrypoint
  public/assets/
    human-brain.glb          - Embedded glTF brain wireframe asset (neuron GLB removed; nodes are procedural dodecahedrons)
  src/
    main.tsx                 - React entrypoint
    App.tsx                  - Layout shell with collapsible sidebar, top search bar, permanent Brain tab, fully wired tab system, async document loading states, FileExplorer, a dedicated scrollable files rail with a minimal right-side hot-pink scrollbar, TabBar, DocumentEditor, Graph3D callbacks, and always-mounted graph
    index.css                - Tailwind import + global theme
    components/
      ChatPanel.tsx          - Right-side chat UI with compact history dropdown, deletable sessions, bottom-anchored composer, in-stream loading status bubble, assistant-response graph focus toggles, traversal-state callback wiring, answer provenance sections, inline clickable document hyperlinks inside assistant responses, and mock-data warning when chat is not grounded in live backend notes
      ConceptDocumentOverlay.tsx - Related-document overlay with automatic first-document selection
      DocumentEditor.tsx     - Milkdown Crepe editor with explicit manual saves, lightweight draft creation for new notes, lightweight PUT updates for existing notes, and a scroll-contained editor region
      EdgeDetailPanel.tsx    - Selected relationship panel with a fixed header, bounded height, and internally scrollable evidence documents
      EditorArea.tsx         - Container combining TabBar + DocumentEditor (legacy; no longer used by App.tsx, which renders TabBar and DocumentEditor directly)
      Graph3D.tsx            - 3D graph scene with right-side zoom/reset/brain-mesh controls, a soft pink brain wireframe shell that fades in and out, a compact bottom-center stats footer that shows visible nodes/edges plus backend total documents, dodecahedron nodes, force-directed layout, animated node-to-node focus transitions, temporary neuron-firing pulses driven by staged local retrieval traversal plans, query-time traversal washout that turns unreached nodes gray until they are traversed, bright eased gray-to-color pulsing plus a matching pulsing outline on already-revealed traversal nodes while the answer is still in flight, concept dive-in with document sub-graph, compact hover-only node tooltips, and callback props (onOpenDocument, onConceptFocused) for parent tab integration
      FileExplorer.tsx       - Sidebar file tree: collapsible concept folders with document items, auto-expand on highlight, refetchSignal prop for parent-triggered refresh
      IngestPanel.tsx        - New Note button + file upload + Notion import
      MarkdownDocumentViewer.tsx - Read-only markdown renderer for selected documents
      NoteEditor.tsx         - Full-page markdown note editor (legacy, replaced by DocumentEditor for tab system)
      NodeTooltip.tsx        - Compact hover tooltip that renders `name (connectionCount)` above the hovered node
      SearchBar.tsx          - Slim horizontal search input for the top bar
      TabBar.tsx             - Horizontal tab bar with active highlighting, conditional close buttons (hidden when `closable === false`), and new-tab italic indicator
    hooks/
      useChat.ts             - Staged local query hook: POST /query/prepare + POST /query/answer for traversal-aware chat, with automatic fallback to POST /query for global prompts, plus answer provenance metadata and session deletion/fallback behavior
      useFileTree.ts         - GET /api/concepts + /api/documents hook, builds the sidebar tree and groups concept-less drafts under a `Notes` bucket
      useGraphData.ts        - GET /api/graph with mock fallback + refetch
    lib/
      brainModel.ts          - Brain mesh containment math for node bounds
      brainScene.ts          - Brain model centering plus scene-focus and rotation helpers
      chatStorage.ts         - localStorage helpers for persisted chat sessions
      graphData.ts           - Graph payload validation + normalization
      graphView.ts           - Colors, adjacency, search, and camera helpers
    mock/
      mockGraph.ts           - Focused 29-concept student knowledge graph with hand-written documents and weighted edges
    test/
      setup.ts               - Vitest setup
    types/
      chat.ts                - Shared chat message and session types
      traversal.ts           - Shared frontend traversal-plan and active-run types for neuron firing
      graph.ts               - Graph node, edge, link, and discovery types
      notes.ts               - OpenTab interface for the tab system (includes optional `closable` field)
backend/
  api.py                    - FastAPI /ingest, /query, /query/prepare, and /query/answer endpoints
  api_graph.py              - FastAPI router: /api/graph, /api/recluster, /api/relationships/details, /api/discovery/latent/{concept_name}, /api/concepts, /api/documents, /api/documents/{doc_id} (GET + PUT lightweight + POST reingest), /api/stats, /api/concepts/{name}/documents
  graph_visualization.py    - Terminal-friendly concept graph loading from Kuzu with LanceDB fallback and ASCII rendering
  schemas.py                - Shared Pydantic response models for documents, graph edges, and relationship details
  sample_data/
    college_math_notes.py   - Loads and seeds the sample college math corpus
    mock_demo.py            - Builds and seeds the hackathon demo corpus that mirrors the frontend mock graph
  db/
    lance.py                - LanceDB init + chunks/document/concept/community schemas + duplicate document lookup + delete_document_chunks
    kuzu.py                 - Kuzu init + graph schema (nodes + edges) + shared-engine repair from LanceDB + update_node_communities() + clear concurrent-open error translation
  services/
    clustering.py           - Leiden community detection: build igraph from RELATED_TO edges and return concept→community_id map
    embeddings.py           - Sentence-transformer embedding functions + document centroid calculation
    llm.py                  - BrainBank prompt workflows + JSON parsing + provider-agnostic 429 backoff/retry handling
    llm_providers.py        - Provider registry plus Gemini/Ollama transport adapters
    notion.py               - Notion API integration: URL parsing, block→markdown conversion, page/database fetching
    pdf.py                  - PDF text extraction using PyMuPDF
  scripts/
    heal_graph.py           - Standalone script: adds SEMANTIC_BRIDGE RELATED_TO edges via chunk-vector cosine similarity
  ingestion/
    chunker.py              - Semantic text splitting by topic shift
    consolidator.py         - Canonical concept mapping + density-control merges with threshold gates, batched LLM decisions, and forced orphan reaper merges
    processor.py            - Ingest pipeline: chunk -> embed -> hinted extract -> canonicalize -> store -> consolidate
  session/
    memory.py               - In-memory session store with bounded turn window and TTL
    prepared_query_store.py - Short-lived in-memory store for staged local query state between prepare and answer
  retrieval/
    artifacts.py            - Batch rebuild for concept centroids and community summaries
    context.py              - Deterministic context assembly for local/global GraphRAG
    global_search.py        - Community-summary retrieval plus map/reduce answer synthesis
    latent_discovery.py     - Shared concept-centroid to document-centroid discovery helpers
    local_search.py         - Local GraphRAG seed selection, weighted expansion, and latent evidence retrieval
    traversal.py            - BFS traversal-plan builder for neuron firing animation
    provenance.py          - Query-time answer provenance assembly for cited documents, evidence chunks, and supporting relationships
    query.py                - Route-aware query orchestration plus staged local prepare/answer helpers
    routing.py              - LOCAL vs GLOBAL query classification
    types.py                - Retrieval dataclasses and internal config defaults
sample_data/
  college_math_notes/
    catalog.json            - Metadata for the sample math note corpus
    *.md                    - College student math note documents for document-opening tests
scripts/
  print_concept_graph.py      - Prints the current concept graph as an ASCII adjacency tree, with LanceDB fallback if Kuzu cannot open
  seed_college_math_notes.py - Seeds the sample math note corpus into local databases
  seed_mock_demo_data.py     - Seeds the hackathon demo corpus into local databases
  rebuild_graphrag_artifacts.py - Runs concept-consolidation cleanup → heal_graph (semantic bridges) → forced orphan reaper → recomputes concept centroids and community summaries
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
    test_consolidator.py    - Concept canonicalization + density-control merge tests
  scripts/
    test_heal_graph.py      - heal_graph: cosine similarity, centroid computation, edge-exists, bridge insertion tests
    test_rebuild_graphrag_artifacts.py - rebuild script integration test for consolidation cleanup pass
  services/
    test_clustering.py      - Leiden clustering: empty/small-graph handling + community assignment tests
    test_llm.py             - Prompt workflow and extraction tests
    test_llm_providers.py   - Provider registry and Gemini/Ollama adapter tests
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

`backend/sample_data/mock_demo.py` provides a larger hackathon demo corpus that mirrors the frontend mock graph. It combines curated calculus, physics, philosophy, and journal notes with generated domain notes for Computer Science, Biology, Economics, Psychology, Product Design, History, Arts, and Data Science. The seeder writes chunks, document centroids, Concept nodes, RELATED_TO edges, concept centroids, and deterministic community summaries so the backend query, discovery, graph, and overview flows all have demo data immediately. `scripts/seed_mock_demo_data.py` seeds that corpus into arbitrary LanceDB/Kuzu paths, while `POST /ingest/demo/mock` runs the same seeding logic inside the live backend process using the shared Kuzu handle so it avoids the embedded database file-lock conflict.

## Mock Data

`frontend/src/mock/mockGraph.ts` provides a focused, hand-curated fallback dataset of 29 concept nodes representing a university student's knowledge graph across four domains:

- **Math** (9 nodes): Calculus, Limits, Derivatives, Integrals, Chain Rule, Fundamental Theorem of Calculus, Differential Equations, Linear Algebra, Probability
- **Physics** (7 nodes): Classical Mechanics, Newton's Laws, Conservation of Energy, Electromagnetism, Maxwell's Equations, Thermodynamics, Entropy
- **Philosophy** (8 nodes): Epistemology, Rationalism, Empiricism, Ethics, Utilitarianism, Existentialism, Free Will, Determinism
- **Personal** (5 nodes): Study Habits, Time Management, Motivation, Career Goals

The graph has 35 edges with numeric `weight` values (1–6) reflecting relationship strength. Stronger weights (e.g., Calculus↔Derivatives at 6) appear as thicker lines in the 3D graph. Cross-domain bridges connect subjects meaningfully: Calculus↔Classical Mechanics, Entropy↔Determinism, Existentialism↔Motivation, Epistemology↔Probability. All concepts have hand-written student documents with personal voice (references to professors, midterm reflections, study struggles). `getMockDocumentsForConcept()` returns these documents with a simple fallback for unmapped concepts.

## Frontend Graph Flow

```
Input: frontend boot
  |
  v
useGraphData() -- GET /api/graph
  |               |
  |               +-- invalid / unavailable -> mockGraph fallback
  |               +-- valid API payload -> keep API edges authoritative, optionally pad missing nodes from mockGraph
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
  |         +-- load -> zoomToFit for default framing + immediate idle rotation
  |         +-- idle rotation -> spins by default on load, stops permanently when user
  |         |                    drags, clicks a node, or clicks an edge; resumes only
  |         |                    when the reset button is pressed
  |         +-- top-right UI buttons -> zoom in / zoom out / reset
  |         +-- scroll wheel -> zoom camera in or out around the current focus point
  |         +-- single-click node -> smooth camera fly to that node (same animation as search), request latent discovery tethers, and call onConceptFocused callback
  |         +-- selected assistant response -> keep source concepts fully lit, dim all unrelated nodes with hidden labels, and render discovery concepts as dimmed nodes with gold outline + visible labels
  |         +-- active local traversal run -> wash visible nodes to gray, reveal traversed nodes in their normal colors as each traversal step fires, keep revealed nodes slowly pulsing brightly between gray and color with a matching pulsing outline while the answer request is still running, and fade all nodes back to the resting palette when the answer request completes
  |         +-- double-click concept node -> "dive into" concept: zoom very close, inject document sub-nodes in a ring around the concept with connecting edges, dim all other nodes
  |         +-- double-click doc sub-node -> call onOpenDocument callback to open that document in the editor
  |         +-- clicked concept node -> becomes the active rotation pivot
  |         +-- double-click empty space / Escape -> restore brain-centered pivot
  |         +-- left-button drag -> rotate the scene object instead of orbiting the camera
  |         +-- panel resize -> recenter the home view when the measured graph viewport changes
  v
GLTFLoader -- load human-brain.glb for the wireframe shell; nodes are procedural dodecahedrons (no GLB)
```

### Ingest Panel

The sidebar has a "New Note" button and a file upload option:

1. **New Note** - clicking will open a document in the tab system (wired by other agents). The NoteEditor full-page overlay has been removed in favor of the new tab-based editing flow.
2. **File Upload** - user picks one or more `.md`, `.txt`, `.pdf`, or `.zip` files from the sidebar. Files are sent individually as `multipart/form-data` via `POST /ingest/upload` with per-file progress tracking ("Uploading 1 of 3..."). PDFs are converted to text server-side using PyMuPDF. Zip files are extracted in-memory; `__MACOSX` metadata and hidden files are skipped, and only `.md`, `.txt`, `.pdf` entries inside are processed. Duplicate documents (matching `doc_name` in LanceDB) are skipped, and the frontend shows a notification naming which files already exist (e.g. "notes already exists"). On completion, a summary shows the total ingested count, duplicate names, or a partial-failure message.

3. **Import from Notion** - user clicks "Import from Notion" in the sidebar, enters their Notion integration token and a page/database URL, and clicks Import. The frontend `POST /ingest/notion` sends `{token, url}`. The backend parses the URL to determine page vs database, fetches content via the Notion API, converts blocks to markdown, and runs each page through the standard ingest pipeline. Success shows the number of pages imported.

All modes trigger `useGraphData.refetch()` to reload the 3D graph. Vite proxies `/ingest` to the backend alongside `/api`.

The desktop layout uses a flex-based shell with a collapsible left sidebar (default expanded at 22rem, collapsed to 3rem with a chevron toggle and CSS transitions), a top search bar spanning the main content area, a tab bar below the search bar, and the content area below the tabs. The graph is always mounted in the DOM; when a document tab is active (i.e. `activeTabId !== BRAIN_TAB_ID`), the graph section is hidden with CSS (`invisible` + absolute positioning) to preserve Three.js state, and the editor surface appears in its place. Existing-document tabs can now carry a transient `isLoading` state in `OpenTab`, so async opens from the sidebar or chat render a lightweight loading panel until `GET /api/documents/{doc_id}` returns real content; this avoids mounting a blank editor and relying on a second open to hydrate it. When the Brain tab is active, the graph is fully visible and the editor is not rendered. Tab system state (`openTabs`, `activeTabId`, `highlightedConcept`, `fileTreeRefetchSignal`) is declared in `App.tsx` and fully wired to all child components. The `OpenTab` interface is exported from `types/notes.ts` and includes optional `isLoading` and `closable` fields (`closable` defaults to `true`; set to `false` for the Brain tab). The old `view: 'graph' | 'editor'` state machine and NoteEditor full-page overlay have been removed.

The sidebar renders a `FileExplorer` below the data source panel. FileExplorer shows concept folders with nested document items and adds a synthetic `Notes` folder for lightweight-saved documents that do not have any concept tags yet. Clicking a document opens it in a tab immediately; if mock content is already available it is shown right away, and if not the tab stays in a loading state until the canonical payload arrives from `GET /api/documents/{doc_id}`. The `highlightedConcept` state flows from `Graph3D` (via `onConceptFocused`) to `FileExplorer`, which auto-expands and scrolls to the highlighted folder. After a document save or ingest, `App.tsx` increments `fileTreeRefetchSignal` which triggers FileExplorer to re-fetch its tree data. The sidebar `Files` section is now just the shell; `FileExplorer` owns the actual scroll container, hides the native browser scrollbar, and renders a custom square-edged hot-pink `3px` left-side thumb so the visual rail stays consistent even on macOS overlay-scrollbar setups while the file tree content itself remains left-to-right.

`Graph3D` receives two callback props wired in App.tsx: `onOpenDocument(docId, name, content)` creates or activates a tab for the document, and `onConceptFocused(conceptName | null)` updates the `highlightedConcept` state. The IngestPanel's "New Note" button creates a blank tab with a generated ID, `isNew: true`, and activates it. When that new note is successfully saved, App closes the draft tab and returns focus to the Brain tab or the next available document tab.

### Tab System

The tab bar always shows a permanent "Brain" tab (`BRAIN_TAB_ID = '__brain__'`) as its first entry. This tab cannot be closed (`closable: false` on the `OpenTab` type). When the Brain tab is active, the 3D graph is visible. Document tabs are appended after the Brain tab; when a document tab is active, the graph is hidden via CSS and the `DocumentEditor` is shown. Closing the last document tab returns focus to the Brain tab. `App.tsx` computes `allTabs` via a memo that prepends the brain tab before any document tabs. `activeTabId` defaults to `BRAIN_TAB_ID`.

The system is composed of two active components rendered directly in `App.tsx` (EditorArea is no longer used by App.tsx):

- **TabBar** (`TabBar.tsx`) - Horizontal row of tabs showing document titles. The active tab has a pink accent border. Each closable tab has a close button (x) that stops propagation to avoid also selecting; the close button is hidden when the tab's `closable` field is `false`. New/unsaved tabs display their title in italic. Returns null when no tabs are open.
- **DocumentEditor** (`DocumentEditor.tsx`) - Milkdown Crepe editor. Reuses the same Crepe configuration as the legacy NoteEditor (ProseMirror WYSIWYG with LaTeX support). Content and title edits stay local while the user types. Saving is explicit: clicking the header `Save note` button POSTs new documents to `/api/documents` for a fast lightweight draft save and PUTs existing documents to `/api/documents/{docId}`. Title-only drafts are allowed, and the save status indicator reflects only user-triggered save requests. The editor body is its own scroll container, uses overscroll containment, and stops wheel propagation so document scrolling does not leak into the underlying graph/page. Saving a brand-new note closes the draft editor so the user exits the creation flow immediately after persistence succeeds.
- **EditorArea** (`EditorArea.tsx`) - Legacy container that combines TabBar at the top with DocumentEditor below. Still exists but is no longer imported or used by `App.tsx`, which renders `TabBar` and `DocumentEditor` directly for more control over the Brain tab layout.

The layout locks the app to the viewport and gives the left rail, main graph/editor area, and chat column their own internal scroll behavior so a standard browser window does not need to scroll the whole page to reach the chat form or the bottom of the sidebar. The frontend uses the loaded brain mesh as a real containment boundary for the graph, not just a visual shell. It builds raycastable mesh geometry, finds an interior anchor point, and clamps out-of-bounds nodes back inward with extra surface inset so the dodecahedron nodes stay inside the shell. Before the brain is added to the Three.js scene, `brainScene.centerObject3DAtOrigin()` rescales it to a larger target diagonal (`325`) so the default framing gives the visualization more room. The graph shell itself now defaults to a single solid `#0E0F10` backdrop while the brain mesh defaults to a very light white wireframe overlay (`#FFFFFF`, `opacity: 0.06`), so background testing is not confounded by extra gradient blobs. A dedicated brain-mesh button lives in the same top-right circular control stack as zoom-in, zoom-out, and reset. That control fades the mesh in and out instead of snapping visibility while still leaving node layout untouched. A dedicated bottom gradient bar now owns the footer area and shows only graph counts from the graph that is actually being rendered on screen (`displayData`, including temporary expanded document nodes and links when present). That bottom bar intentionally covers the old helper-copy lane so control-instruction text such as the left-click rotate hint cannot leak through underneath the stats. Each graph node is rendered as a procedural `DodecahedronGeometry` with flat shading and a text label sprite above it, colored by community palette when a `community_id` is present or by the red-to-blue score gradient otherwise.

Node placement uses a force-directed layout: each node id is seeded to a deterministic position via hash, then d3-force-3d runs with charge repulsion (`-150`), collision avoidance (`forceCollide(18)`), and weight-based link distance/strength. After the simulation settles, all node positions are pinned (`fx/fy/fz`) so they never move again; subsequent reheats are immediately suppressed by re-pinning from a saved position map on every engine tick. Brain containment clamping runs during simulation ticks to keep nodes inside the shell. `Graph3D` disables the built-in navigation controls, keeps idle motion and left-button drag on the scene object's own rotation, reserves single-click for node interactions, maps scroll-wheel input to the same camera-distance zoom system used by the right-side zoom buttons, and explicitly disables the force-graph library's default cursor-following hover label. That shared focus animation path also fixes the old regression where clicking from one node to another used to snap the view instead of flying between targets. The scene spins by default on load and stops permanently when the user drags, clicks a node, or clicks an edge; rotation resumes only when the reset button is pressed after the camera-return animation completes. Hovering a node renders a compact tooltip in the format `Name (connectionCount)` above the node, and the hovered node's in-scene text sprite fades out so the hover state shows only one label. Clicking a node no longer pins a separate card in place. Double-clicking a concept node triggers a one-way dive-in experience: the camera zooms inward to frame the expanded visible set, the rest of the brain fades away during that inward motion, and the expanded view keeps the selected concept plus its revealed document nodes visible in place without a follow-up zoom-back-out bounce. Double-clicking a document sub-node opens it in the editor via the `onOpenDocument` callback, and `App.tsx` refreshes an existing tab with newly provided content instead of preserving stale blank content. Pressing Escape, clicking reset, or clicking the background exits the expanded view and restores the brain overview. `Graph3D` also drives the staged local retrieval animation: unrevealed nodes wash to gray, retrieved nodes ease back toward their normal color as traversal reaches them, and already-revealed nodes keep a bright pulsing fill plus a matching pulsing outline while the answer request is still in flight. The bottom stats footer no longer repeats concepts because that count mirrors concept-only graph nodes; instead it shows visible node and edge counts from the currently rendered scene plus total document count from `GET /api/stats` when the frontend is using the live backend, falling back to visible document nodes only in mock mode or if the stats request fails. `Graph3D` accepts two callback props for the tab system: `onOpenDocument(docId, name, content)` is called when a document sub-node is double-clicked in dive-in view, and `onConceptFocused(conceptName | null)` is called when a concept node gains or loses focus. `ChatPanel` receives its own `onOpenDocument(docId, name)` callback from `App.tsx`, so clicking a cited answer document opens the same editor flow and then hydrates the tab with `GET /api/documents/{doc_id}`. Relationship edges render as plain static lines with no directional particle animation, while `linkHoverPrecision` stays elevated so edge hitboxes remain easy to click. Link width scales by relationship weight (`Math.log((weight || 1) + 1) * 2.2`) so stronger relationships still read clearly without dominating the scene, and discovery ghost links stay dashed with `[2, 1]` line dashes so they read as temporary tethers. Semantic bridge edges from `heal_graph` use a distinct amber tint and thinner width. Unfocused edges use a softer translucent bluish-white base color, the graph-level edge opacity is lowered, and ghost tethers are thinner so the nodes remain the visual priority before any hover or selection. Edge highlighting is color-only; the rendered line width stays thin even when a node or relationship is focused. The scene tracks a local focus point: the home view pins the brain centroid at world origin, and clicking or searching for a node animates that local focus point toward the target instead of teleporting it there first. When a concept node is focused, `Graph3D` stores that node's id as the active rotation target and persists highlight on the node's adjacent edges until the focus is cleared. During search, non-matching nodes and their labels are dimmed to 8% opacity while matched nodes stay fully visible. A `ResizeObserver` watches the graph panel's real rendered size, feeds those measured dimensions into `ForceGraph3D`, and recalculates the home view both when the chat column opens or closes and when the graph panel receives its first non-zero layout size on initial page load. The chat overlay starts closed on first render, leaving the graph unobstructed until the user opens chat from the right-side handle. During development, Vite proxies `/api/*` and `/ingest` requests to `http://localhost:8000`.

When a user clicks any visible edge, the frontend keeps that exact edge selected, dims unrelated nodes, and opens `EdgeDetailPanel` showing the edge type. Discovery mode still adds temporary latent tethers from the selected concept to semantically similar documents returned by `/api/discovery/latent/{concept_name}`, but it no longer has a visible UI toggle; those ghost links stay dashed and use a distinct violet tint so they still read as temporary discovery hints. For `RELATED_TO` edges, the frontend also fetches `/api/relationships/details?source=...&target=...` and renders the stored reason plus shared, source-only, and target-only supporting documents. Relationship detail lookup is direction-agnostic, so the panel still opens even if the clicked edge is queried in reverse endpoint order. Non-`RELATED_TO` edges use local panel details only and do not trigger the backend evidence lookup. The panel is height-bounded to the graph viewport, keeps its title and close button pinned at the top, and scrolls long relationship evidence inside its body instead of letting content run off-screen. Its scroll region uses overscroll containment and stops wheel propagation so scrolling relationship evidence does not zoom or scroll the underlying brain view. That panel can be dismissed either with its close button or by pressing `Escape`.

## Frontend Chat Flow

```
Input: user question in right-side panel
  |
  v
ChatPanel -- controlled input + active conversation with collapsible session history
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
Backend returns answer text plus provenance:
  - `source_concepts`
  - `discovery_concepts`
  - `source_documents`
  - `discovery_documents`
  - `source_chunks`
  - `discovery_chunks`
  - `supporting_relationships`
  |
  v
ChatPanel -- render assistant answer + inline clickable document links, concept provenance sections, evidence excerpts, and supporting relationships
  |
  +-- click assistant response -> toggle graph focus selection in App
  |
  +-- while waiting -> render an in-stream assistant loading bubble with rotating status phrases
  |
  +-- when graph source is mock -> show warning that chat only queries live backend notes
```

Chat state now persists in browser `localStorage` under explicit `brainbank.chat.*` keys. `useChat` owns a list of chat sessions, tracks the active session, creates a default empty session when needed, renames a session from its first user message, keeps sessions ordered by `updatedAt`, and supports deleting any session. Deleting the active session falls back to the next-most-recent chat; deleting the last remaining chat immediately creates a fresh empty session so the panel never enters a dead state. `App` keeps the chat subtree mounted at all times so closing the overlay is purely a visibility change and does not reset local component state. The frontend uses the real retrieval route, and assistant messages preserve both concept-level provenance (`sourceConcepts`, `discoveryConcepts`) and evidence provenance (`sourceDocuments`, `discoveryDocuments`, `sourceChunks`, `discoveryChunks`, `supportingRelationships`). `ChatPanel` treats the active conversation as the default surface and moves the session switcher into a compact dropdown summary that stays collapsed until the user asks for history; each history row now includes its own delete control. The lower panel body is a true flex column with the message list as the only scrollable region, which keeps the composer pinned to the bottom edge instead of letting it float directly under short conversations. While a query is in flight, the panel appends a temporary assistant-style loading bubble inside the message stream and rotates status phrases on a slower fade cadence. Clicking an assistant response toggles a graph focus mode in `App`: source concepts stay fully lit, discovery concepts stay label-visible with a gold outline over a dimmed body, and every other node follows the existing search-style dimming path with labels hidden until the response is deselected. Clicking a cited document opens the existing editor flow and hydrates that tab through `GET /api/documents/{doc_id}` so users can inspect the exact note behind an answer. When the graph view has fallen back to local mock data, `ChatPanel` renders an explicit warning so users do not assume those mock concepts are queryable through `/query`. Model access still happens only on the backend; the frontend never receives or stores provider credentials.

## Ingestion Flow (`POST /ingest`)

```
Input: text + title
  |
  v
LanceDB concept_centroids lookup -- fetch top 50 frequent concepts as extraction hints
  |
  v
llm.extract_concepts(existing_concepts=...) -- Gemini extracts 4-8 balanced concepts and prefers mapping to known canonical names
  |
  v
chunker.semantic_chunk_text() -- split by topic shift using sentence similarity
  |
  v
embeddings.embed_texts() -- sentence-transformers -> 384-dim vectors
  |
  v
ingestion.consolidator.canonicalize_concepts() -- map semantically equivalent mentions to canonical concept names (cosine > 0.85)
  |
  v
LanceDB.add() -- store chunks with doc_name, canonical concepts[], and vectors
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
ingestion.consolidator.consolidate_graph() -- AUTO-MERGE if similarity > 0.92, SKIP if < 0.75, else send batched merge decisions to LLM
```

Note: Per-ingest Leiden clustering has been removed. Community detection now runs only via batch rebuild (`scripts/rebuild_graphrag_artifacts.py`) or the `/api/recluster` endpoint.

Key behavior: Concepts are **upserted** via Cypher `MERGE`. Documents are never stored in Kuzu and document identity/concept tagging live entirely in LanceDB chunks. Consolidation keeps concept density targeted around 3-10 documents per concept by attempting merges for sparse concepts and logging rename/merge counts during ingest. The API also runs a strict orphan reaper pass (`force_consolidate_orphans`) every 5th manual `POST /ingest` call.

## GraphRAG Artifact Rebuild Flow

```
Input: current LanceDB chunks + current Kuzu weighted concept graph
  |
  v
scripts.rebuild_graphrag_artifacts.run_consolidation_cleanup() -- run density-control merges over existing graph/chunk metadata
  |
  v
scripts.heal_graph.heal_graph() -- add SEMANTIC_BRIDGE edges between similar but disconnected concepts
  |
  v
scripts.rebuild_graphrag_artifacts.run_force_orphan_cleanup() -- strict orphan pass: force concepts with <3 docs into top-1 vector neighbor (LLM decision, fallback to nearest if LLM fails)
  |
  v
retrieval.artifacts._build_concept_centroid_records() -- average chunk vectors per canonical concept
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

This rebuild is batch-oriented and runs in order: density-control merges → semantic bridge healing → forced orphan reaper (with LLM decision + vector-neighbor fallback) → concept centroids → community summaries.

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

The frontend sends `session_id` (the localStorage chat session UUID) and `history` (the last 20 messages) with each `/query` request, and with each staged `/query/prepare` + `/query/answer` sequence for local traversal-aware queries. The backend records each user/assistant turn in the session store when the final answer request is handled and passes the conversation history into the LLM prompt so it can resolve references like "it", "that", and "the second one".

`backend/session/prepared_query_store.py` provides a second ephemeral store for the staged local flow. It keeps prepared local-query state in memory for up to 5 minutes, caps the store at 100 items, evicts the oldest item when full, and deletes each prepared query as soon as `/query/answer` consumes it.

## Query Flow (`POST /query`, `POST /query/prepare`, `POST /query/answer`)

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
  |   Output: { answer, source_concepts, discovery_concepts=[], source_documents=[], discovery_documents=[], source_chunks=[], discovery_chunks=[], supporting_relationships=[] }
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
      provenance.build_local_answer_provenance() -- dedupe cited documents, carry evidence excerpts, and surface RELATED_TO edges among retrieved concepts
        |
        v
      llm.generate_answer() -- grounded final answer from the assembled local GraphRAG context
        |                    includes conversation history when provided
        |
        v
      api.py -> record assistant turn in SessionMemory (if session_id present)
        |
        v
      Output: { answer, source_concepts, discovery_concepts, source_documents, discovery_documents, source_chunks, discovery_chunks, supporting_relationships }
```

The query route no longer opens Kuzu from path on every request. Instead it reuses the module-level `kuzu.Database` from the API layer and creates a short-lived `kuzu.Connection` inside the retrieval worker thread. Retrieval still preserves the stable `/query` contract, but internally it is now route-aware and GraphRAG-specific. Local retrieval defaults to chunk/document artifacts already produced during ingest and upgrades itself when `concept_centroids` exists. Global retrieval only activates when `community_summaries` exists; otherwise overview-style questions transparently fall back to the local path. Local answers assemble full provenance from retrieval hits, and global answers map their surfaced source concepts back to ranked documents so both routes can drive clickable note citations in chat. When `session_id` and `history` are provided, the API stores turns in `SessionMemory`, and the history turns are prepended to the LLM prompt so the model can resolve follow-up references against prior turns.

The staged local flow works like this:

```
Input: { question, session_id?, history? }
  |
  v
POST /query/prepare
  |
  +-- classify GLOBAL?
  |     |
  |     +-- yes -> return { route:"GLOBAL", requires_direct_query:true, prepared_query_id:null, traversal_plan:null }
  |     +-- no  -> run local retrieval only
  |
  +-- local retrieval
  |     |
  |     +-- embeddings.embed_query()
  |     +-- local_search.run_local_search()
  |     +-- context.build_local_context()
  |     +-- provenance.build_local_answer_provenance()
  |     +-- traversal.build_traversal_plan()
  |     v
  |   prepared_query_store.create(...)
  |
  v
Return: { route:"LOCAL", requires_direct_query:false, prepared_query_id, source_concepts, discovery_concepts, traversal_plan }
  |
  v
Frontend starts neuron-firing animation from traversal_plan and concurrently calls POST /query/answer
  |
  v
POST /query/answer
  |
  +-- prepared_query_store.consume(...)
  +-- session_memory.add_turn(user) when session_id present
  +-- immediate no-results response OR llm.generate_answer(prepared context, prepared concepts, history)
  +-- session_memory.add_turn(assistant) when session_id present
  v
Return: same final answer payload shape as POST /query
```

The traversal plan contract is fixed for v1:
- `root_node_id`
- `step_interval_ms = 160`
- `pulse_duration_ms = 320`
- `brightness_decay = 0.65`
- `brightness_threshold = 0.25`
- `steps = [{ node_id, concept, hop, brightness, delay_ms }]`

The plan is built only for LOCAL queries. It starts from the highest-ranked source concept, walks breadth-first across `RELATED_TO` edges, emits only concepts that were already selected as source or discovery concepts, and drops steps once hop depth or brightness would exceed the configured stop conditions.

If LanceDB has zero ingested chunks, `/query` returns a specific empty-database message instead of the generic "No relevant information found." response. That makes it clear the failure is missing ingested data rather than a bad retrieval match.

## API Endpoints

### `POST /ingest`
- Body: `{"text": "...", "title": "..."}`
- Returns: `{"doc_id": "...", "chunks": N, "concepts": [...]}`
- Every 5th manual ingest request triggers `force_consolidate_orphans` after ingest completes, using the shared Kuzu engine and a fresh short-lived connection.

### `POST /ingest/demo/mock`
- Body: empty
- Returns: `{"seeded_documents": N, "skipped_documents": N, "total_concepts": N, "community_summaries": N}`
- Seeds the hackathon demo corpus through the running backend process, reusing the shared Kuzu engine so it is safe even while FastAPI already owns the Kuzu file lock.

### `POST /query`
- Body: `{"question": "..."}`
- Returns: `{"answer": "...", "source_concepts": [...], "discovery_concepts": [...], "source_documents": [{"doc_id", "name"}], "discovery_documents": [{"doc_id", "name"}], "source_chunks": [{"chunk_id", "doc_id", "doc_name", "text"}], "discovery_chunks": [{"chunk_id", "doc_id", "doc_name", "text"}], "supporting_relationships": [{"source", "target", "type", "reason"}]}`

### `POST /query/prepare`
- Body: `{"question": "...", "session_id"?: "...", "history"?: [{"role", "content"}]}`
- Returns local staged-query metadata for LOCAL prompts: `{"route": "LOCAL", "requires_direct_query": false, "prepared_query_id": "...", "source_concepts": [...], "discovery_concepts": [...], "traversal_plan": {...}}`
- Returns global fallback metadata for GLOBAL prompts: `{"route": "GLOBAL", "requires_direct_query": true, "prepared_query_id": null, "source_concepts": [], "discovery_concepts": [], "traversal_plan": null}`

### `POST /query/answer`
- Body: `{"prepared_query_id": "...", "session_id"?: "...", "history"?: [{"role", "content"}]}`
- Returns the same final answer payload shape as `POST /query`
- Rejects missing, expired, or already-consumed prepared query IDs with `404`

### `GET /api/graph`
- Intended payload: `{"nodes": [...], "edges": [...]}`
- Current frontend behavior: fetch this route and fall back to local mock data when the backend graph payload is unavailable, invalid, or empty; when the payload is valid, API edges remain authoritative and only missing nodes may be padded from the local mock graph
- Returns: `{"nodes": [{"id", "type", "name", "colorScore", "community_id"}], "edges": [{"source", "target", "type", "reason", "weight"}]}`
- Full graph for frontend 3D visualization; `community_id` drives community-palette coloring in the 3D brain

### `GET /api/concepts`
- Returns: `{"concepts": [{"name", "document_count", "related_concepts"}]}`

### `GET /api/documents`
- Returns: `{"documents": [{"doc_id", "name", "chunk_count", "concepts"}]}`

### `POST /api/documents`
- Body: `{"text": "...", "title": "..."}`
- Fast draft save: creates a lightweight LanceDB-backed document immediately, without embeddings, LLM extraction, or graph updates
- Returns: `{"doc_id": "...", "status": "saved"}`
- Accepts empty `text`, which allows title-only notes to persist before the user writes the body

### `GET /api/documents/{doc_id}`
- Returns: `{"doc_id", "name", "full_text"}`
- Reads the full stored text for one document directly from LanceDB
- Returns `404` if `doc_id` does not exist

### `PUT /api/documents/{doc_id}`
- Body: `{"text": "...", "title": "..."}`
- Lightweight save: updates document text in LanceDB without re-running LLM extraction, embedding, or clustering
- Returns: `{"doc_id": "...", "status": "saved"}`
- Returns `404` if `doc_id` does not exist

### `POST /api/documents/{doc_id}/reingest`
- Body: `{"text": "...", "title": "..."}`
- Full re-ingest: deletes old chunks, re-embeds, re-extracts concepts, rebuilds graph edges
- Returns: `{"doc_id": "...", "chunks": N, "concepts": [...]}`

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
| BRAINBANK_LLM_PROVIDER | No | Default backend LLM provider for extraction and retrieval answers (default: `gemini`) |
| GEMINI_API_KEY | Yes      | Gemini API authentication |
| GEMINI_MODEL   | No       | Override model name (default: `gemini-2.5-flash`) |
| TEST_LLM_PROVIDER | No    | Optional override for the `/test-llm` route; if unset it reuses `BRAINBANK_LLM_PROVIDER` |
| OLLAMA_BASE_URL | No      | Local Ollama base URL (default: `http://localhost:11434`) |
| OLLAMA_MODEL | No         | Local Ollama model for any Ollama-backed route (default: `llama3.2:3b`) |

Database paths default to `./data/lancedb` and `./data/kuzu`.

## Testing

Tests mock both the LLM (`extract_concepts`, `generate_answer`) and embeddings (`embed_texts`, `embed_query`) so they run without API keys or model downloads. Mock embeddings use deterministic SHA-256 hashes padded to 384 dimensions.

Run: `uv run pytest tests/ -v`

Frontend tests use Vitest and Testing Library to cover payload normalization, helper logic, brain containment math, mock fallback behavior, and the graph shell UI.

Frontend utility modules keep only runtime-facing exports; tests avoid depending on private helper-only camera/orbit utilities, and `graphView` is limited to the helpers the UI still calls at runtime. Graph payload validation accepts optional or null `reason` values and optional/null numeric `weight` on edges, then normalizes missing/null weights to `1` for rendering. The graph loader also tolerates `links` as a legacy alias for `edges` when normalizing API responses, and the backend graph route defaults absent relationship weights to `1.0`.

Backend API tests isolate database access at the route boundary when a handler eagerly acquires the shared Kuzu engine, so mocked ingest flows do not depend on the real `./data/kuzu` file lock.

Run: `cd frontend && npm test`



