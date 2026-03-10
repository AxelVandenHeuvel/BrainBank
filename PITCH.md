# BrainBank — Hackathon Pitch

## One-Liner

**BrainBank turns your notes into a living, queryable 3D brain that AI can reason over.**

---

## The Problem

We all take notes — in class, at work, in journals. But notes rot. They pile up in folders, disconnected and forgotten. When you need to find how two ideas relate, or rediscover something you wrote months ago, you're left scrolling through walls of text.

Current tools treat notes as flat files. Search gives you keyword matches, not understanding. There's no way to see the shape of what you know, what connects to what, or what hidden patterns exist across everything you've written.

---

## What BrainBank Does

BrainBank ingests your notes and automatically builds a **structured knowledge graph** — then lets you explore it as an interactive 3D brain and query it with natural language.

Drop in a markdown file, a PDF, a zip of notes, or import straight from Notion. BrainBank handles the rest.

---

## How It Works

### 1. Ingest — Drop in your notes

Upload `.md`, `.txt`, `.pdf`, or `.zip` files directly in the app, or connect your Notion workspace with a one-click integration. BrainBank accepts anything text-based.

### 2. Extract — AI pulls out structure

An LLM (Gemini 2.5 Flash) reads each document and extracts **concepts** and **relationships** — the ideas your notes are actually about and how they connect. No manual tagging required.

### 3. Consolidate — Keep the graph clean

Ingested concepts go through an automatic consolidation pipeline:
- **Canonical matching** — "ML" and "Machine Learning" get merged into one node, not two
- **Semantic deduplication** — embedding similarity catches near-duplicates the LLM missed
- **Density control** — orphan concepts with too few connections get merged into their nearest neighbor
- **Leiden community detection** — concepts cluster into natural topic communities

### 4. Store — Dual database architecture

Notes are stored in two complementary systems:
- **LanceDB** (vector DB) — chunks with 384-dim embeddings for semantic search
- **Kuzu** (graph DB) — a weighted concept co-occurrence graph for structural traversal

This hybrid Vector + Graph design is what makes BrainBank's retrieval so powerful.

### 5. Visualize — Explore your brain in 3D

The entire knowledge graph renders as an interactive **3D force-directed network** inside a translucent brain wireframe. Concepts are nodes. Relationships are edges. Documents orbit their parent concepts.

You can:
- **Search** across the full graph with instant highlighting
- **Click into concepts** to see their connected documents with a smooth dive animation
- **Double-click documents** to open them in a full WYSIWYG editor (Milkdown/ProseMirror with LaTeX support)
- **See edge details** — click any connection to see why two concepts are linked
- **Toggle the brain mesh** on/off, view live graph stats

### 6. Query — Ask your brain questions

Open the collapsible chat panel and ask natural language questions. BrainBank uses a **hybrid GraphRAG pipeline** with two retrieval paths:

**Local path** — for specific questions ("What did I write about eigenvalues?"):
- Vector search finds the most relevant chunks
- Graph traversal expands outward through weighted concept edges
- Latent discovery pulls in documents you didn't directly search for but are semantically related
- The LLM generates a grounded answer citing specific notes

**Global path** — for broad questions ("Summarize everything I know about linear algebra"):
- Queries pre-built community summaries from Leiden clustering
- Generates partial answers per community, then synthesizes a final response
- Maps community concepts back to source documents so every claim has a citation

**Staged retrieval with live animation** — the local path exposes a two-phase flow: the retrieval plan is returned first so the frontend can animate a **neuron-firing traversal** across the 3D graph in real-time while the LLM generates the final answer. You literally watch your brain think.

### 7. Write — Create and edit notes in-app

A built-in document editor with:
- Obsidian-style live markdown rendering
- KaTeX math support (inline and block equations)
- Tab-based multi-document workflow with a permanent Brain tab
- New notes auto-ingest into the graph on save

### 8. Import — Notion integration

Connect your Notion workspace directly from the sidebar:
- Paste your internal integration token and a page/database URL
- BrainBank pulls pages, converts blocks to markdown (preserving headings, lists, code, equations), and ingests them
- In-app setup guide walks through the entire process

---

## Architecture At a Glance

```
User Notes (.md / .pdf / .zip / Notion)
        |
    [ FastAPI Backend ]
        |
   +---------+-----------+
   |                     |
LanceDB              Kuzu
(vectors, chunks)    (concept graph)
   |                     |
   +----+------+---------+
        |      |
   Local RAG   Global RAG
   (traverse   (community
    + vector    summaries)
    search)        |
        |          |
   [ Gemini LLM / Ollama ]
        |
   Grounded Answer + Citations
        |
   [ React + Three.js Frontend ]
        |
   3D Brain Graph + Chat + Editor
```

---

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| API | FastAPI | Async Python, clean routing |
| Vector DB | LanceDB (embedded) | Zero-config, fast ANN search |
| Graph DB | Kuzu (embedded) | Cypher queries, no server needed |
| Clustering | igraph + leidenalg | Weighted community detection |
| Embeddings | sentence-transformers | all-MiniLM-L6-v2, 384-dim |
| LLM | Gemini 2.5 Flash + Ollama | Cloud or local, backend-selected |
| Frontend | React + TypeScript + Vite | Fast dev, type-safe |
| 3D Rendering | react-force-graph-3d + Three.js | Interactive force-directed graph |
| Editor | Milkdown Crepe (ProseMirror) | WYSIWYG markdown + LaTeX |
| Styling | Tailwind CSS | Utility-first, consistent dark UI |

---

## What Makes BrainBank Different

1. **Not just search — structure.** Other note tools give you full-text search. BrainBank builds an actual knowledge graph with weighted relationships, communities, and semantic bridges.

2. **Dual retrieval.** Combining vector similarity with graph traversal catches connections that either approach alone would miss. The "latent discovery" path surfaces notes you forgot you had.

3. **You can see it think.** The staged retrieval pipeline animates neuron-firing across your 3D brain while the answer generates. It's not a loading spinner — it's the actual traversal plan visualized in real-time.

4. **Automatic concept hygiene.** The consolidation pipeline deduplicates, merges orphans, and clusters concepts without any manual work. Your graph stays clean as it grows.

5. **Write where you think.** The built-in editor with math support means you don't need to switch apps. Write a note, save it, and it's instantly part of your knowledge graph.

---

## The Team

4 Computer Science seniors from CU Boulder (Graduating May 2026).

---

## Demo Flow

1. Show the empty brain
2. Upload a few markdown notes (or import from Notion)
3. Watch concepts and relationships populate the 3D graph
4. Search for a concept — see it light up in the brain
5. Click into a concept, explore its documents
6. Open a document, edit it, save
7. Ask a question in chat — watch the neuron-firing traversal animate across the graph
8. Show the grounded answer with cited sources and discovery documents
9. Ask a broad question — show the global/community path
10. Create a new note in-app, save, show it appear in the graph
