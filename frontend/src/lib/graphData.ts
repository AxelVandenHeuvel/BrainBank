import type { GraphApiResponse, GraphData, GraphEdge, GraphNode } from '../types/graph';

const GRAPH_NODE_TYPES = new Set([
  'Concept',
  'Document',
  'Project',
  'Task',
  'Reflection',
]);

function isGraphNode(value: unknown): value is GraphNode {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const node = value as Record<string, unknown>;

  return (
    typeof node.id === 'string' &&
    typeof node.name === 'string' &&
    typeof node.type === 'string' &&
    GRAPH_NODE_TYPES.has(node.type)
  );
}

function isGraphEdge(value: unknown): value is GraphEdge {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const edge = value as Record<string, unknown>;
  const hasValidReasonShape =
    edge.reason === undefined || edge.reason === null || typeof edge.reason === 'string';
  const hasValidWeightShape =
    edge.weight === undefined || edge.weight === null || typeof edge.weight === 'number';

  return (
    typeof edge.source === 'string' &&
    typeof edge.target === 'string' &&
    typeof edge.type === 'string' &&
    hasValidReasonShape &&
    hasValidWeightShape
  );
}

export function validateGraphApiResponse(value: unknown): value is GraphApiResponse {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const payload = value as Record<string, unknown>;

  // Accept any payload with array-shaped nodes/edges; invalid items are filtered in normalizeGraphData.
  return Array.isArray(payload.nodes) && Array.isArray(payload.edges);
}

export function normalizeGraphData(response: GraphApiResponse): GraphData {
  const safeNodes = response.nodes.filter(isGraphNode).map((node) => ({ ...node }));
  const safeEdges = response.edges
    .filter(isGraphEdge)
    .map((edge) => ({
      ...edge,
      reason: edge.reason ?? undefined,
      weight: edge.weight ?? 1,
    }));

  return {
    nodes: safeNodes,
    links: safeEdges,
  };
}
