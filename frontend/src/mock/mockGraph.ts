import type { GraphApiResponse, RelationshipDetails } from '../types/graph';

export const mockGraphApiResponse: GraphApiResponse = {
  nodes: [
    { id: 'concept:RAG', type: 'Concept', name: 'RAG' },
    { id: 'concept:Machine Learning', type: 'Concept', name: 'Machine Learning' },
    { id: 'concept:Neural Networks', type: 'Concept', name: 'Neural Networks' },
    { id: 'concept:Transformers', type: 'Concept', name: 'Transformers' },
    { id: 'concept:Vector Database', type: 'Concept', name: 'Vector Database' },
    { id: 'concept:Knowledge Graph', type: 'Concept', name: 'Knowledge Graph' },
    { id: 'concept:Python', type: 'Concept', name: 'Python' },
    { id: 'concept:Embeddings', type: 'Concept', name: 'Embeddings' },
    { id: 'project:BrainBank', type: 'Project', name: 'BrainBank' },
    { id: 'task:impl-graph', type: 'Task', name: 'Implement graph database' },
    { id: 'task:add-chat', type: 'Task', name: 'Add chat interface' },
    {
      id: 'reflection:r1',
      type: 'Reflection',
      name: 'Knowledge graphs surface hidden connections',
    },
  ],
  edges: [
    { source: 'concept:RAG', target: 'concept:Vector Database', type: 'RELATED_TO' },
    { source: 'concept:RAG', target: 'concept:Knowledge Graph', type: 'RELATED_TO' },
    { source: 'concept:RAG', target: 'concept:Machine Learning', type: 'RELATED_TO' },
    { source: 'concept:RAG', target: 'concept:Embeddings', type: 'RELATED_TO' },
    { source: 'concept:Machine Learning', target: 'concept:Neural Networks', type: 'RELATED_TO' },
    { source: 'concept:Neural Networks', target: 'concept:Transformers', type: 'RELATED_TO' },
    { source: 'concept:Embeddings', target: 'concept:Vector Database', type: 'RELATED_TO' },
    { source: 'concept:Knowledge Graph', target: 'concept:Python', type: 'RELATED_TO' },
    { source: 'concept:Python', target: 'concept:Machine Learning', type: 'RELATED_TO' },
    { source: 'project:BrainBank', target: 'task:impl-graph', type: 'HAS_TASK' },
    { source: 'project:BrainBank', target: 'task:add-chat', type: 'HAS_TASK' },
    { source: 'concept:RAG', target: 'project:BrainBank', type: 'RELATED_TO' },
    { source: 'reflection:r1', target: 'concept:Knowledge Graph', type: 'RELATED_TO' },
  ],
};

// ---------------------------------------------------------------------------
// Mock document responses — used as a fallback when the backend is not running.
// Shape matches GET /api/concepts/{name}/documents.
// ---------------------------------------------------------------------------

export interface MockDocument {
  doc_id: string;
  name: string;
  full_text: string;
}

const MOCK_CONCEPT_DOCUMENTS: Record<string, MockDocument[]> = {
  RAG: [
    {
      doc_id: 'rag-1',
      name: 'RAG Architecture Overview.md',
      full_text:
        'Retrieval-Augmented Generation combines a vector retrieval step with a generative LLM. The retriever finds relevant chunks; the generator synthesises an answer grounded in those chunks.',
    },
    {
      doc_id: 'rag-2',
      name: 'Building a RAG Pipeline.md',
      full_text:
        'Step 1: chunk documents. Step 2: embed chunks with a sentence-transformer. Step 3: store vectors in LanceDB. Step 4: at query time, embed the question, search LanceDB, pass top-k chunks to the LLM.',
    },
    {
      doc_id: 'rag-3',
      name: 'RAG vs Fine-Tuning.md',
      full_text:
        'RAG is preferable when the knowledge base changes frequently. Fine-tuning is better when the task style matters more than factual grounding.',
    },
  ],
  'Machine Learning': [
    {
      doc_id: 'ml-1',
      name: 'ML Fundamentals.md',
      full_text:
        'Machine learning is the practice of training models on data so they can make predictions or decisions without being explicitly programmed for each case.',
    },
    {
      doc_id: 'ml-2',
      name: 'Supervised vs Unsupervised.md',
      full_text:
        'Supervised learning uses labelled examples. Unsupervised learning finds structure in unlabelled data. Reinforcement learning trains an agent via reward signals.',
    },
  ],
  'Neural Networks': [
    {
      doc_id: 'nn-1',
      name: 'Neural Network Basics.md',
      full_text:
        'A neural network is a stack of linear layers separated by non-linear activations. Backpropagation computes gradients; gradient descent updates weights.',
    },
    {
      doc_id: 'nn-2',
      name: 'Activation Functions.md',
      full_text:
        'ReLU, GELU, and Sigmoid are common activation functions. ReLU is fast; GELU is smoother and preferred in transformers.',
    },
  ],
  Transformers: [
    {
      doc_id: 'tf-1',
      name: 'Attention Is All You Need — Notes.md',
      full_text:
        'The transformer architecture replaces recurrence with self-attention. Each token attends to every other token in the sequence, enabling parallelism during training.',
    },
    {
      doc_id: 'tf-2',
      name: 'BERT and GPT Differences.md',
      full_text:
        'BERT uses bidirectional masked language modelling for representation. GPT uses causal (left-to-right) language modelling for generation.',
    },
  ],
  'Vector Database': [
    {
      doc_id: 'vdb-1',
      name: 'LanceDB Setup.md',
      full_text:
        'LanceDB is an embedded vector database built on the Lance columnar format. It supports approximate nearest-neighbour search and integrates directly with Python.',
    },
  ],
  'Knowledge Graph': [
    {
      doc_id: 'kg-1',
      name: 'Why Knowledge Graphs.md',
      full_text:
        'Knowledge graphs model entities and their relationships as nodes and edges. They enable reasoning and traversal that flat vector search cannot provide.',
    },
    {
      doc_id: 'kg-2',
      name: 'Kuzu Graph Database.md',
      full_text:
        'Kuzu is an embedded property graph database. It supports Cypher queries and runs in-process alongside Python, making it ideal for a local-first knowledge tool.',
    },
  ],
  Embeddings: [
    {
      doc_id: 'emb-1',
      name: 'Sentence Transformers.md',
      full_text:
        'Sentence transformers encode text into dense 384-dimensional vectors. Cosine similarity between these vectors approximates semantic relatedness.',
    },
  ],
  Python: [
    {
      doc_id: 'py-1',
      name: 'Python for ML.md',
      full_text:
        'Python dominates the ML ecosystem via NumPy, PyTorch, and the Hugging Face library. Its dynamic typing and REPL workflow suit rapid experimentation.',
    },
  ],
};

export const mockRelationshipDetailsByEdge: Record<string, RelationshipDetails> = {
  'concept:Calculus->concept:Derivatives': {
    source: 'Calculus',
    target: 'Derivatives',
    type: 'RELATED_TO',
    reason: 'Derivatives are a core tool within calculus',
    source_documents: [
      {
        doc_id: 'doc-math-notes',
        name: 'Math Notes',
        full_text: 'Calculus introduces derivatives as a way to measure change.',
      },
      {
        doc_id: 'doc-calculus-guide',
        name: 'Calculus Guide',
        full_text: 'Limits and derivatives are foundational topics in calculus.',
      },
    ],
    target_documents: [
      {
        doc_id: 'doc-math-notes',
        name: 'Math Notes',
        full_text: 'Calculus introduces derivatives as a way to measure change.',
      },
      {
        doc_id: 'doc-derivative-rules',
        name: 'Derivative Rules',
        full_text: 'Power, product, and chain rules are core derivative tools.',
      },
    ],
    shared_document_ids: ['doc-math-notes'],
  },
};

/** Returns mock documents for a concept name, with a generic fallback. */
export function getMockDocumentsForConcept(conceptName: string): MockDocument[] {
  return (
    MOCK_CONCEPT_DOCUMENTS[conceptName] ?? [
      {
        doc_id: `mock-${conceptName.toLowerCase().replace(/\s+/g, '-')}`,
        name: `${conceptName} Notes.md`,
        full_text: `Research notes and observations about ${conceptName}.`,
      },
    ]
  );
}
