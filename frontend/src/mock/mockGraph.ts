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
        'Retrieval-Augmented Generation combines retrieval with a grounded generator.',
    },
    {
      doc_id: 'rag-2',
      name: 'Building a RAG Pipeline.md',
      full_text:
        'Embed the query, retrieve relevant chunks, then answer against retrieved context.',
    },
  ],
  'Machine Learning': [
    {
      doc_id: 'ml-1',
      name: 'ML Fundamentals.md',
      full_text:
        'Machine learning trains models on data so they can make predictions or decisions.',
    },
  ],
  'Neural Networks': [
    {
      doc_id: 'nn-1',
      name: 'Neural Network Basics.md',
      full_text:
        'A neural network is a stack of layers trained with gradient-based optimization.',
    },
    {
      doc_id: 'nn-2',
      name: 'Activation Functions.md',
      full_text: 'ReLU, GELU, and sigmoid are common activation functions.',
    },
  ],
  Transformers: [
    {
      doc_id: 'tf-1',
      name: 'Attention Is All You Need - Notes.md',
      full_text:
        'Transformers replace recurrence with self-attention and train in parallel.',
    },
    {
      doc_id: 'tf-2',
      name: 'BERT and GPT Differences.md',
      full_text:
        'BERT is bidirectional for representation, while GPT is causal for generation.',
    },
  ],
  'Vector Database': [
    {
      doc_id: 'vdb-1',
      name: 'LanceDB Setup.md',
      full_text: 'LanceDB is an embedded vector database that supports semantic search.',
    },
  ],
  'Knowledge Graph': [
    {
      doc_id: 'kg-1',
      name: 'Why Knowledge Graphs.md',
      full_text:
        'Knowledge graphs model entities and relationships as traversable structures.',
    },
    {
      doc_id: 'kg-2',
      name: 'Kuzu Graph Database.md',
      full_text:
        'Kuzu is an embedded graph database that supports Cypher queries in-process.',
    },
  ],
  Embeddings: [
    {
      doc_id: 'emb-1',
      name: 'Sentence Transformers.md',
      full_text:
        'Sentence transformers encode text into vectors that support similarity search.',
    },
  ],
  Python: [
    {
      doc_id: 'py-1',
      name: 'Python for ML.md',
      full_text:
        'Python dominates ML tooling through libraries like NumPy, PyTorch, and Hugging Face.',
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
