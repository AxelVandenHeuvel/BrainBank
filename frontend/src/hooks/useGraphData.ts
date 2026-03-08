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

const fallbackGraphData = normalizeGraphData(mockGraphApiResponse);

/** Merge API graph data on top of mock data. API nodes/edges override mock by id. */
function mergeWithMock(apiData: GraphData): GraphData {
  const apiNodeIds = new Set(apiData.nodes.map((n) => n.id));
  const mockOnlyNodes = fallbackGraphData.nodes.filter((n) => !apiNodeIds.has(n.id));

  const apiEdgeKeys = new Set(
    apiData.links.map((l) => {
      const s = typeof l.source === 'string' ? l.source : l.source.id;
      const t = typeof l.target === 'string' ? l.target : l.target.id;
      return `${s}->${t}`;
    }),
  );
  const mockOnlyEdges = fallbackGraphData.links.filter((l) => {
    const s = typeof l.source === 'string' ? l.source : l.source.id;
    const t = typeof l.target === 'string' ? l.target : l.target.id;
    return !apiEdgeKeys.has(`${s}->${t}`);
  });

  return {
    nodes: [...mockOnlyNodes, ...apiData.nodes],
    links: [...mockOnlyEdges, ...apiData.links],
  };
}

export function useGraphData(): UseGraphDataResult {
  const [result, setResult] = useState<Omit<UseGraphDataResult, 'refetch'>>({
    data: fallbackGraphData,
    source: 'mock',
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
        const merged = mergeWithMock(apiData);

        setResult({
          data: merged,
          source: apiData.nodes.length > 0 ? 'api' : 'mock',
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

