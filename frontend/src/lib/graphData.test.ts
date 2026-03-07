import { describe, expect, it } from 'vitest';

import { normalizeGraphData, validateGraphApiResponse } from './graphData';
import type { GraphApiResponse } from '../types/graph';

const apiGraph: GraphApiResponse = {
  nodes: [
    { id: 'concept:Calculus', type: 'Concept', name: 'Calculus' },
    { id: 'doc:abc-123', type: 'Document', name: 'Math Notes' },
  ],
  edges: [
    { source: 'doc:abc-123', target: 'concept:Calculus', type: 'MENTIONS' },
  ],
};

describe('graphData helpers', () => {
  it('normalizes api edges into links', () => {
    expect(normalizeGraphData(apiGraph)).toEqual({
      nodes: apiGraph.nodes,
      links: [
        { source: 'doc:abc-123', target: 'concept:Calculus', type: 'MENTIONS' },
      ],
    });
  });

  it('accepts the expected api response shape', () => {
    expect(validateGraphApiResponse(apiGraph)).toBe(true);
  });

  it('rejects malformed payloads', () => {
    expect(validateGraphApiResponse({ nodes: 'bad', edges: [] })).toBe(false);
  });
});
