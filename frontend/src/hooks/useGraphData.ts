import { useCallback, useEffect, useState } from 'react';

import { normalizeGraphData, validateGraphApiResponse } from '../lib/graphData';
import type { GraphData, GraphSource } from '../types/graph';

interface UseGraphDataResult {
  data: GraphData;
  source: GraphSource;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

const emptyGraphData: GraphData = { nodes: [], links: [] };

export function useGraphData(): UseGraphDataResult {
  const [result, setResult] = useState<Omit<UseGraphDataResult, 'refetch'>>({
    data: emptyGraphData,
    source: 'api',
    isLoading: true,
    error: null,
  });
  const [fetchKey, setFetchKey] = useState(0);

  const refetch = useCallback(() => {
    setFetchKey((k) => k + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    async function loadGraph() {
      try {
        const response = await fetch('/api/graph', {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }

        const payload = await response.json();
        const graphPayload = Array.isArray((payload as { edges?: unknown[] }).edges)
          ? payload
          : Array.isArray((payload as { links?: unknown[] }).links)
            ? { ...payload, edges: (payload as { links: unknown[] }).links }
            : payload;

        if (!validateGraphApiResponse(graphPayload)) {
          throw new Error('Invalid graph payload');
        }

        const apiData = normalizeGraphData(graphPayload);

        setResult({
          data: apiData,
          source: 'api',
          isLoading: false,
          error: null,
        });
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        setResult({
          data: emptyGraphData,
          source: 'api',
          isLoading: false,
          error: error instanceof Error ? error.message : 'Failed to load graph',
        });
      }
    }

    void loadGraph();

    return () => {
      controller.abort();
    };
  }, [fetchKey]);

  return { ...result, refetch };
}
