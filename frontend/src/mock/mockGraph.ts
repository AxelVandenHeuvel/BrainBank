import type { GraphApiResponse } from '../types/graph';

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
    },
  ],
};

