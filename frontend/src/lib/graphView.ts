import type { GraphData, GraphLink, GraphNode, GraphNodeType } from '../types/graph';

interface CameraPosition {
  x: number;
  y: number;
  z: number;
}

const HOME_VIEW_HEIGHT_FACTOR = 0.08;

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

/**
 * Returns an HSL color for a Concept node based on its colorScore.
 * 0.0 (logical) → red (hue 0), 1.0 (creative) → blue (hue 240).
 * Falls back to the default Concept color when score is not available.
 */
export function conceptColorFromScore(score: number | undefined): string {
  if (score === undefined || score === null) {
    return NODE_TYPE_COLORS.Concept;
  }
  const hue = Math.round(score * 240);
  return `hsl(${hue}, 75%, 60%)`;
}

/** Ten distinct colors mirroring D3's schemeCategory10. */
const COMMUNITY_PALETTE = [
  '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
  '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf',
];

/**
 * Maps a Leiden community_id to a distinct palette color.
 * Falls back to the default Concept color when community_id is absent.
 */
export function communityColor(communityId: number | null | undefined): string {
  if (communityId === undefined || communityId === null || communityId < 0) {
    return NODE_TYPE_COLORS.Concept;
  }
  return COMMUNITY_PALETTE[communityId % COMMUNITY_PALETTE.length];
}

export const DIMMED_NODE_COLOR = 'rgba(148, 163, 184, 0.2)';
export const DIMMED_SEARCH_COLOR = 'rgba(71, 85, 105, 0.35)';
export const DIMMED_LINK_COLOR = 'rgba(51, 65, 85, 0.22)';
export const ACTIVE_LINK_COLOR = 'rgba(125, 211, 252, 0.9)';

function getNodeId(nodeOrId: string | GraphNode): string {
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

export function centerCameraOnTarget(
  fgRef: ForceGraphCameraRef,
  target: CameraPosition,
  distance: number,
  durationMs = 1200,
): void {
  fgRef.current?.cameraPosition(
    {
      x: target.x,
      y: target.y + distance * HOME_VIEW_HEIGHT_FACTOR,
      z: target.z + distance,
    },
    target,
    durationMs,
  );
}
