import { useCallback, useEffect, useState } from 'react';

import { normalizeGraphData, validateGraphApiResponse } from '../lib/graphData';
import { mockGraphApiResponse } from '../mock/mockGraph';
import type { GraphData, GraphSource } from '../types/graph';

interface UseGraphDataResult {
  data: GraphData;
  source: GraphSource;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

const emptyGraphData: GraphData = { nodes: [], links: [] };
const fallbackGraphData = normalizeGraphData(mockGraphApiResponse);

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

        if (!validateGraphApiResponse(payload)) {
          throw new Error('Invalid graph payload');
        }

        setResult({
          data: normalizeGraphData(payload),
          source: 'api',
          isLoading: false,
          error: null,
        });
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        setResult({
          data: fallbackGraphData,
          source: 'mock',
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

