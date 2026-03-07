# Brain Bank

## Overview

Brain Bank is a system that converts daily journaling into a **structured personal knowledge graph**.

Instead of storing thoughts as linear text, Brain Bank extracts structured elements from journal entries and organizes them into interconnected nodes. This creates a continuously evolving map of a user's ideas, projects, and knowledge.

The result is a machine-readable representation of the user’s thinking that both **humans and AI systems** can explore.

---

## Core Idea

Traditional journaling stores reflections as unstructured text. This makes it difficult for AI systems to understand context about a user.

Brain Bank converts reflections into structured data that models:

- what the user knows
- what the user is learning
- what the user is building
- how ideas connect over time

This creates a **persistent context layer** that AI systems can reference during conversations.

---

## Data Model

Each journal entry is parsed into structured nodes and relationships. Each node represents a concept. Each concept has documents justfying it's existence, and nodes are connected to other nodes via relationships/edges.

**Concept**
- Ideas or knowledge areas  
- Examples: "Graph Neural Networks", "Probability Theory"


---

### Relationship Types

Nodes are connected through relationships such as:

- `related_to`
- `part_of`
- `inspired_by`
- `depends_on`
- `learned_from`

These relationships form the user’s personal knowledge graph.

---

## Key Capabilities

### Structured Journaling
Journal entries are automatically parsed into nodes and relationships.

### Automatic Knowledge Graph
Concepts, projects, tasks, and reflections are connected into a persistent graph.

### AI-Readable Context
The graph can be exported so AI systems can reason over a user's knowledge and activities.

### Learning Map
Tracks how knowledge grows and how concepts connect over time.

### Project Awareness
Tasks, research, and reflections are linked to the projects they belong to.

---

## Visualization

The knowledge graph is visualized as a **3D brain-like network**.

Concepts:

- Nodes represent ideas, projects, or reflections
- Edges represent relationships between them
- Clusters represent domains of knowledge or activity

The interface allows users to:

- explore their thinking spatially
- see connections between ideas
- identify clusters of knowledge
- observe how their thinking evolves over time

---

## Interaction Features

### Node Highlighting
Hovering over a node highlights it and its connected relationships.

### Search
Searching for a concept highlights its location in the graph.

### Context Usage
When AI uses nodes for reasoning, those nodes visually activate.

### Graph Growth
When new ideas are added, nodes animate into the graph and connect to related nodes.

---

## Vision

Brain Bank becomes a **persistent cognitive layer between humans and AI systems**.

Instead of relying only on the current prompt, AI can reason over a structured model of the user's:

- knowledge
- projects
- interests
- learning history

This enables deeper and more personalized human–AI collaboration.

---

## One Sentence Pitch

Brain Bank turns journaling into a structured knowledge graph that allows AI to understand your ideas, projects, and knowledge over time.