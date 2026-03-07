🧠 Brain Bank
Your thoughts, structured. Your context, persistent.
Brain Bank is a high-fidelity personal knowledge graph that transforms unstructured journaling into a navigable 3D neural map. By leveraging LLM-based entity extraction and vector-graph hybrid storage, it creates a "cognitive twin" that enables AI systems to reason with the same context as the user.

🏗️ Technical Architecture
Brain Bank operates on a Relational-Vector Hybrid Pipeline:

Ingestion: Daily logs are processed via FastAPI using Claude/GPT-4o for Named Entity Recognition (NER).

Structuring: Entities are mapped into a Graph Schema (Nodes: Concept, Project, Task, Reflection).

Embedding: Text chunks are vectorized and stored in Pinecone for semantic retrieval.

Spatial Mapping: Relationships are calculated using d3-force-3d and rendered in a 60fps React Three Fiber environment.

🛠️ The Stack
🚀 Key Features (MVP)
🛰️ Semantic 3D Navigation
Unlike flat list-based note apps, Brain Bank uses force-directed layouts to cluster related ideas spatially.

Dynamic Linking: Connection strengths grow based on cross-references and semantic similarity.

Level-Awareness: The graph tracks your "Mastery" (e.g., distinguishing between your Calc 1 vs. Calc 2 nodes).

🤖 Recursive RAG (Retrieval-Augmented Generation)
When you ask the AI a question, it doesn't just search text; it traverses the graph.

Personalized Context: "Explain this like I just finished Calc 2 but haven't started Linear Algebra."

Temporal Recall: Ask what you were researching 6 months ago; the graph retrieves the exact node and its inspired-by links.

📈 Roadmap
[ ] Phase 1 (Hackathon): Core 3D visualization, Google Docs/Notion ingestion, and basic Pinecone RAG.

[ ] Phase 2: Local-First implementation using SQLite/WASM for 100% privacy.

[ ] Phase 3: Automated Code Analysis. Integrate C/Rust parsers to link your source code directly to your project nodes.

[ ] Phase 4: Chrome Extension. Real-time note-taking that suggests "Existing Connections" as you browse.

🤝 The Team
We are a group of 4 Computer Science seniors from CU Boulder (Graduating May 2026). Our background includes internships at Charter Communications and Bio-Rad, with deep experience in:

Low-level programming (C/Rust)

Distributed Systems & Full-Stack Development

Machine Learning (PyTorch/Transformers)

🎯 One Sentence Pitch
Brain Bank converts the chaos of daily thoughts into a structured 3D knowledge graph, providing a persistent context layer for the next generation of personalized AI.