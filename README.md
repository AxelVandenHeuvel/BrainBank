# Brain Bank

Your thoughts, structured. Your context, persistent.

Brain Bank is a hybrid Vector/Graph RAG system that transforms unstructured journaling into a navigable 3D knowledge graph. It extracts concepts, projects, tasks, and reflections from journal entries and connects them into an explorable network.

## Quick Start

### Prerequisites

- Python 3.12+
- Node.js 18+
- [uv](https://docs.astral.sh/uv/) (Python package manager)
- A [Gemini API key](https://aistudio.google.com/apikey) (free)

### Setup

```bash
# Clone and install backend
git clone https://github.com/AxelVandenHeuvel/BrainBank.git
cd BrainBank
uv venv && uv pip install -e ".[dev]"

# Install frontend
cd frontend && npm install && cd ..
```

### Run

**Terminal 1 — Backend:**
```bash
export GEMINI_API_KEY=your_key_here
uv run uvicorn backend.api:app --reload --port 8000
```

**Terminal 2 — Frontend:**
```bash
cd frontend && npm run dev
```

Open http://localhost:5173 in your browser.

### Ingest a journal entry

```bash
curl -X POST http://localhost:8000/ingest \
  -H "Content-Type: application/json" \
  -d '{"text": "Today I worked on BrainBank. I learned about graph databases and vector search. They relate to knowledge representation.", "title": "Dev Journal"}'
```

Refresh the frontend to see your knowledge graph populate.

### Seed sample college math notes

```bash
uv run python scripts/seed_college_math_notes.py
```

This loads six college-student math note documents directly into LanceDB and Kuzu so the graph and document-opening flows have realistic sample content without calling Gemini.

### Rebuild GraphRAG artifacts

```bash
uv run python scripts/rebuild_graphrag_artifacts.py
```

This batch step rebuilds persisted `concept_centroids` and `community_summaries` from the current chunk store and weighted concept graph. Ingest still updates chunks, document centroids, concepts, and `RELATED_TO` edges immediately; the community/global GraphRAG artifacts refresh only when you run this command.

### Print the current concept graph

```bash
uv run python scripts/print_concept_graph.py
```

This prints the current concept graph as an ASCII adjacency tree so you can quickly inspect which concepts are connected and how strong those connections are. By default it reads Kuzu from `./data/kuzu` and, if that fails, tries to reconstruct the graph from LanceDB chunk concept tags in `./data/lancedb`.

You can also point it at explicit paths:

```bash
uv run python scripts/print_concept_graph.py --kuzu-db-path /path/to/kuzu --lance-db-path /path/to/lancedb
```

### Run tests

```bash
# Backend (60 tests, no API key needed)
uv run pytest tests/ -v

# Frontend
cd frontend && npm test
```

## Tech Stack

| Layer       | Technology              | Purpose                          |
|-------------|-------------------------|----------------------------------|
| API         | FastAPI                 | HTTP endpoints                   |
| Vector DB   | LanceDB (embedded)      | Chunk storage + similarity search|
| Graph DB    | Kuzu (embedded)         | Concept graph + traversal        |
| Embeddings  | sentence-transformers   | all-MiniLM-L6-v2, 384-dim       |
| LLM         | Gemini 1.5 Flash        | Concept extraction + answers     |
| Frontend    | React + Three.js        | 3D knowledge graph visualization |

## API Endpoints

| Method | Endpoint          | Description                        |
|--------|-------------------|------------------------------------|
| POST   | `/ingest`         | Ingest text + title                |
| POST   | `/query`          | Ask a question, get grounded answer|
| GET    | `/api/graph`      | Full graph for visualization       |
| GET    | `/api/discovery/latent/{concept_name}` | Latent document discovery |
| GET    | `/api/concepts`   | List concepts with metadata        |
| GET    | `/api/documents`  | List documents with metadata       |
| GET    | `/api/stats`      | Aggregate counts                   |

See [ARCHITECTURE.md](ARCHITECTURE.md) for full technical details.

## The Team

4 Computer Science seniors from CU Boulder (Graduating May 2026).
