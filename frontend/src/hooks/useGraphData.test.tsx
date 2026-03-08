import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { normalizeGraphData } from '../lib/graphData';
import { mockGraphApiResponse } from '../mock/mockGraph';
import { useGraphData } from './useGraphData';

describe('useGraphData', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses api data merged with mock data when the endpoint returns the expected payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          nodes: [{ id: 'project:BrainBank', type: 'Project', name: 'BrainBank' }],
          edges: [],
        }),
      }),
    );

    const { result } = renderHook(() => useGraphData());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.source).toBe('api');
    // API node is present alongside mock nodes
    expect(result.current.data.nodes.find((n) => n.id === 'project:BrainBank')).toBeTruthy();
    // Mock nodes are still present
    expect(result.current.data.nodes.find((n) => n.name === 'Calculus')).toBeTruthy();
  });

  it('falls back to mock data when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    const { result } = renderHook(() => useGraphData());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.source).toBe('mock');
    expect(result.current.data).toEqual(normalizeGraphData(mockGraphApiResponse));
    expect(result.current.error).toBe('offline');
  });

  it('falls back to mock data when the payload is invalid', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ nodes: [], bad: true }),
      }),
    );

    const { result } = renderHook(() => useGraphData());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.source).toBe('mock');
    expect(result.current.error).toBe('Invalid graph payload');
  });

  it('uses api data when related edges include null reason', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          nodes: [
            { id: 'concept:Calculus', type: 'Concept', name: 'Calculus' },
            { id: 'concept:Derivatives', type: 'Concept', name: 'Derivatives' },
          ],
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
      }),
    );

    const { result } = renderHook(() => useGraphData());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.source).toBe('api');
    expect(result.current.error).toBeNull();
  });

  it('uses api data even when some edges are malformed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          nodes: [
            { id: 'concept:Calculus', type: 'Concept', name: 'Calculus' },
            { id: 'concept:Derivatives', type: 'Concept', name: 'Derivatives' },
          ],
          edges: [
            {
              source: 'concept:Calculus',
              target: 'concept:Derivatives',
              type: 'RELATED_TO',
              weight: 2,
            },
            {
              source: 123,
              target: 'concept:Derivatives',
              type: 'RELATED_TO',
            },
          ],
        }),
      }),
    );

    const { result } = renderHook(() => useGraphData());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.source).toBe('api');
    expect(result.current.error).toBeNull();
    // The valid API edge is present (merged with mock edges)
    const calcDerivEdge = result.current.data.links.find(
      (l) => {
        const s = typeof l.source === 'string' ? l.source : l.source.id;
        const t = typeof l.target === 'string' ? l.target : l.target.id;
        return s === 'concept:Calculus' && t === 'concept:Derivatives' && l.weight === 2;
      },
    );
    expect(calcDerivEdge).toBeTruthy();
  });


  it('preserves edge weight values from the API payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          nodes: [
            { id: 'concept:Calculus', type: 'Concept', name: 'Calculus' },
            { id: 'concept:Derivatives', type: 'Concept', name: 'Derivatives' },
          ],
          edges: [
            {
              source: 'concept:Calculus',
              target: 'concept:Derivatives',
              type: 'RELATED_TO',
              weight: 5,
            },
          ],
        }),
      }),
    );

    const { result } = renderHook(() => useGraphData());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.source).toBe('api');
    // API edge with weight=5 overrides the mock edge for the same pair
    const edge = result.current.data.links.find((l) => {
      const s = typeof l.source === 'string' ? l.source : l.source.id;
      const t = typeof l.target === 'string' ? l.target : l.target.id;
      return s === 'concept:Calculus' && t === 'concept:Derivatives';
    });
    expect(edge?.weight).toBe(5);
  });
  it('uses api data when backend returns links instead of edges', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          nodes: [{ id: 'concept:Calculus', type: 'Concept', name: 'Calculus' }],
          links: [{ source: 'concept:Calculus', target: 'concept:Derivatives', type: 'RELATED_TO' }],
        }),
      }),
    );

    const { result } = renderHook(() => useGraphData());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.source).toBe('api');
    expect(result.current.error).toBeNull();
    // The API link is present in the merged result
    const apiLink = result.current.data.links.find((l) => {
      const s = typeof l.source === 'string' ? l.source : l.source.id;
      const t = typeof l.target === 'string' ? l.target : l.target.id;
      return s === 'concept:Calculus' && t === 'concept:Derivatives';
    });
    expect(apiLink).toBeTruthy();
  });
});

