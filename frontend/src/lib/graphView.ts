import type { GraphData, GraphLink, GraphNode, GraphNodeType } from '../types/graph';

interface CameraPosition {
  x: number;
  y: number;
  z: number;
}

interface ForceGraphCameraHandle {
  cameraPosition(): CameraPosition;
  cameraPosition(
    position: CameraPosition,
    lookAt?: CameraPosition,
    durationMs?: number,
  ): unknown;
}

interface ForceGraphCameraRef {
  current: ForceGraphCameraHandle | null;
}

export const NODE_TYPE_COLORS: Record<GraphNodeType, string> = {
  Concept: '#3b82f6',
  Document: '#22c55e',
  Project: '#f97316',
  Task: '#eab308',
  Reflection: '#a855f7',
};

export const DIMMED_NODE_COLOR = 'rgba(148, 163, 184, 0.2)';
export const DIMMED_SEARCH_COLOR = 'rgba(71, 85, 105, 0.35)';
export const DIMMED_LINK_COLOR = 'rgba(51, 65, 85, 0.22)';
export const ACTIVE_LINK_COLOR = 'rgba(125, 211, 252, 0.9)';

export function getNodeId(nodeOrId: string | GraphNode): string {
  return typeof nodeOrId === 'string' ? nodeOrId : nodeOrId.id;
}

export function buildAdjacencyMap(data: GraphData): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();

  data.nodes.forEach((node) => {
    adjacency.set(node.id, new Set<string>());
  });

  data.links.forEach((link) => {
    const source = getNodeId(link.source);
    const target = getNodeId(link.target);

    adjacency.get(source)?.add(target);
    adjacency.get(target)?.add(source);
  });

  return adjacency;
}

export function getConnectionCount(
  nodeId: string,
  adjacency: Map<string, Set<string>>,
): number {
  return adjacency.get(nodeId)?.size ?? 0;
}

export function findMatchingNodeIds(
  nodes: GraphNode[],
  query: string,
): Set<string> {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return new Set<string>();
  }

  return new Set(
    nodes
      .filter((node) => node.name.toLowerCase().includes(normalizedQuery))
      .map((node) => node.id),
  );
}

export function createFocusSet(
  hoveredNode: GraphNode | null,
  adjacency: Map<string, Set<string>>,
): Set<string> {
  if (!hoveredNode) {
    return new Set<string>();
  }

  return new Set([
    hoveredNode.id,
    ...(adjacency.get(hoveredNode.id) ?? new Set<string>()),
  ]);
}

export function isDirectHoverLink(
  link: GraphLink,
  hoveredNode: GraphNode | null,
): boolean {
  if (!hoveredNode) {
    return false;
  }

  const source = getNodeId(link.source);
  const target = getNodeId(link.target);

  return source === hoveredNode.id || target === hoveredNode.id;
}

export function autoRotateCamera(
  fgRef: ForceGraphCameraRef,
  speed = 0.002,
): void {
  const currentPosition = fgRef.current?.cameraPosition();

  if (!currentPosition) {
    return;
  }

  const cosine = Math.cos(speed);
  const sine = Math.sin(speed);

  fgRef.current?.cameraPosition({
    x: currentPosition.x * cosine - currentPosition.z * sine,
    y: currentPosition.y,
    z: currentPosition.x * sine + currentPosition.z * cosine,
  });
}

export function zoomToNode(
  fgRef: ForceGraphCameraRef,
  node: GraphNode,
  distance = 100,
): void {
  const lookAt = {
    x: node.x ?? 0,
    y: node.y ?? 0,
    z: node.z ?? 0,
  };

  fgRef.current?.cameraPosition(
    {
      x: lookAt.x + distance,
      y: lookAt.y + distance * 0.25,
      z: lookAt.z + distance,
    },
    lookAt,
    1200,
  );
}
