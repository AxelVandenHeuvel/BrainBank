import type { GraphApiResponse, RelationshipDetails } from '../types/graph';

export const mockGraphApiResponse: GraphApiResponse = {
  nodes: [
    { id: 'concept:Calculus', type: 'Concept', name: 'Calculus' },
    { id: 'concept:Derivatives', type: 'Concept', name: 'Derivatives' },
    { id: 'doc:abc-123', type: 'Document', name: 'Math Notes' },
    { id: 'project:BrainBank', type: 'Project', name: 'BrainBank' },
    { id: 'task:impl-graph', type: 'Task', name: 'Implement graph database' },
    {
      id: 'reflection:r1',
      type: 'Reflection',
      name: 'Graphs are powerful for knowledge',
    },
  ],
  edges: [
    {
      source: 'concept:Calculus',
      target: 'concept:Derivatives',
      type: 'RELATED_TO',
      reason: 'Derivatives are a core tool within calculus',
    },
    {
      source: 'doc:abc-123',
      target: 'concept:Calculus',
      type: 'MENTIONS',
    },
    {
      source: 'project:BrainBank',
      target: 'task:impl-graph',
      type: 'HAS_TASK',
    },
    {
      source: 'reflection:r1',
      target: 'project:BrainBank',
      type: 'INSPIRES',
    },
    {
      source: 'task:impl-graph',
      target: 'concept:Derivatives',
      type: 'RELATED_TO',
      reason: 'Implementation work reinforces derivative concepts',
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
