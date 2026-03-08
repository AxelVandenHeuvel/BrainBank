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

  return (
    typeof edge.source === 'string' &&
    typeof edge.target === 'string' &&
    typeof edge.type === 'string' &&
    (edge.type !== 'RELATED_TO' ||
      (typeof edge.reason === 'string' && edge.reason.length > 0)) &&
    (edge.reason === undefined || typeof edge.reason === 'string')
  );
}

export function validateGraphApiResponse(value: unknown): value is GraphApiResponse {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const payload = value as Record<string, unknown>;

  return (
    Array.isArray(payload.nodes) &&
    payload.nodes.every(isGraphNode) &&
    Array.isArray(payload.edges) &&
    payload.edges.every(isGraphEdge)
  );
}

export function normalizeGraphData(response: GraphApiResponse): GraphData {
  return {
    nodes: response.nodes.map((node) => ({ ...node })),
    links: response.edges.map((edge) => ({ ...edge })),
  };
}
