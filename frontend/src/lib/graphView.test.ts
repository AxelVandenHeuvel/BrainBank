import { describe, expect, it } from 'vitest';

import {
  NODE_TYPE_COLORS,
  buildAdjacencyMap,
  conceptColorFromScore,
  findMatchingNodeIds,
  getConnectionCount,
} from './graphView';
import type { GraphData } from '../types/graph';

const graph: GraphData = {
  nodes: [
    { id: 'concept:Calculus', type: 'Concept', name: 'Calculus' },
    { id: 'concept:Derivatives', type: 'Concept', name: 'Derivatives' },
    { id: 'doc:abc-123', type: 'Document', name: 'Math Notes' },
  ],
  links: [
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
  ],
};

describe('graphView helpers', () => {
  it('maps score 0 to red, score 1 to blue, and undefined to the default concept color', () => {
    expect(conceptColorFromScore(0)).toBe('hsl(0, 75%, 60%)');
    expect(conceptColorFromScore(0.5)).toBe('hsl(120, 75%, 60%)');
    expect(conceptColorFromScore(1)).toBe('hsl(240, 75%, 60%)');
    expect(conceptColorFromScore(undefined)).toBe(NODE_TYPE_COLORS.Concept);
  });

  it('maps each node type to the required color', () => {
    expect(NODE_TYPE_COLORS).toEqual({
      Concept: '#3b82f6',
      Document: '#22c55e',
      Project: '#f97316',
      Task: '#eab308',
      Reflection: '#a855f7',
    });
  });

  it('builds adjacency data from links', () => {
    const adjacency = buildAdjacencyMap(graph);

    expect(Array.from(adjacency.get('concept:Calculus') ?? []).sort()).toEqual([
      'concept:Derivatives',
      'doc:abc-123',
    ]);
  });

  it('counts direct node connections', () => {
    const adjacency = buildAdjacencyMap(graph);

    expect(getConnectionCount('concept:Calculus', adjacency)).toBe(2);
    expect(getConnectionCount('doc:abc-123', adjacency)).toBe(1);
  });

  it('matches nodes by case-insensitive name search', () => {
    const matches = findMatchingNodeIds(graph.nodes, 'calc');

    expect(matches).toEqual(new Set(['concept:Calculus']));
  });

});
