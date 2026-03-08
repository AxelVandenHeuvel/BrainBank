import { describe, expect, it } from 'vitest';

import { normalizeGraphData, validateGraphApiResponse } from './graphData';
import type { GraphApiResponse } from '../types/graph';

const apiGraph: GraphApiResponse = {
  nodes: [
    { id: 'concept:Calculus', type: 'Concept', name: 'Calculus' },
    { id: 'doc:abc-123', type: 'Document', name: 'Math Notes' },
  ],
  edges: [
    {
      source: 'concept:Calculus',
      target: 'concept:Derivatives',
      type: 'RELATED_TO',
      reason: 'Derivatives are a core tool within calculus',
    },
    { source: 'doc:abc-123', target: 'concept:Calculus', type: 'MENTIONS' },
  ],
};

describe('graphData helpers', () => {
  it('normalizes api edges into links', () => {
    expect(normalizeGraphData(apiGraph)).toEqual({
      nodes: apiGraph.nodes,
      links: [
        {
          source: 'concept:Calculus',
          target: 'concept:Derivatives',
          type: 'RELATED_TO',
          reason: 'Derivatives are a core tool within calculus',
          weight: 1,
        },
        {
          source: 'doc:abc-123',
          target: 'concept:Calculus',
          type: 'MENTIONS',
          reason: undefined,
          weight: 1,
        },
      ],
    });
  });

  it('accepts the expected api response shape', () => {
    expect(validateGraphApiResponse(apiGraph)).toBe(true);
  });

  it('rejects malformed payloads', () => {
    expect(validateGraphApiResponse({ nodes: 'bad', edges: [] })).toBe(false);
  });

  it('accepts related edges that omit reason', () => {
    expect(
      validateGraphApiResponse({
        nodes: apiGraph.nodes,
        edges: [
          {
            source: 'concept:Calculus',
            target: 'concept:Derivatives',
            type: 'RELATED_TO',
          },
        ],
      }),
    ).toBe(true);
  });

  it('accepts related edges when reason is null and weight is present', () => {
    expect(
      validateGraphApiResponse({
        nodes: apiGraph.nodes,
        edges: [
          {
            source: 'concept:Calculus',
            target: 'concept:Derivatives',
            type: 'RELATED_TO',
            reason: null,
            weight: 2,
          },
        ],
      }),
    ).toBe(true);
  });

  it('keeps valid edges and drops malformed edges during normalization', () => {
    const mixedPayload = {
      nodes: apiGraph.nodes,
      edges: [
        {
          source: 'concept:Calculus',
          target: 'concept:Derivatives',
          type: 'RELATED_TO',
          weight: 3,
        },
        {
          source: 123,
          target: 'concept:Derivatives',
          type: 'RELATED_TO',
        },
      ],
    } as unknown as GraphApiResponse;

    const normalized = normalizeGraphData(mixedPayload);

    expect(normalized.links).toHaveLength(1);
    expect(normalized.links[0]).toEqual({
      source: 'concept:Calculus',
      target: 'concept:Derivatives',
      type: 'RELATED_TO',
      reason: undefined,
      weight: 3,
    });
  });

  it('keeps edges when backend returns null weight and defaults to 1', () => {
    const payload = {
      nodes: apiGraph.nodes,
      edges: [
        {
          source: 'concept:Calculus',
          target: 'concept:Derivatives',
          type: 'RELATED_TO',
          weight: null,
        },
      ],
    } as unknown as GraphApiResponse;

    const normalized = normalizeGraphData(payload);

    expect(normalized.links).toEqual([
      {
        source: 'concept:Calculus',
        target: 'concept:Derivatives',
        type: 'RELATED_TO',
        reason: undefined,
        weight: 1,
      },
    ]);
  });
});
