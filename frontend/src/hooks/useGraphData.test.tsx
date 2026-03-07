import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mockGraphApiResponse } from '../mock/mockGraph';
import { useGraphData } from './useGraphData';

describe('useGraphData', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses api data when the endpoint returns the expected payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          nodes: [
            { id: 'project:BrainBank', type: 'Project', name: 'BrainBank' },
          ],
          edges: [],
        }),
      }),
    );

    const { result } = renderHook(() => useGraphData());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.source).toBe('api');
    expect(result.current.data.nodes).toEqual([
      { id: 'project:BrainBank', type: 'Project', name: 'BrainBank' },
    ]);
    expect(result.current.data.links).toEqual([]);
  });

  it('falls back to mock data when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    const { result } = renderHook(() => useGraphData());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.source).toBe('mock');
    expect(result.current.data).toEqual({
      nodes: mockGraphApiResponse.nodes,
      links: mockGraphApiResponse.edges,
    });
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
});

