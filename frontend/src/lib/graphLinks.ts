import {
  ACTIVE_LINK_COLOR,
  DIMMED_LINK_COLOR,
  isDirectHoverLink,
} from './graphView';
import {
  BASE_LINK_COLOR,
  ESTABLISHED_LINK_WIDTH_MULTIPLIER,
  GHOST_EDGE_COLOR,
  GHOST_EDGE_WIDTH,
  SEMANTIC_BRIDGE_COLOR,
  SEMANTIC_BRIDGE_WIDTH,
} from './graphConstants';
import type { GraphLink, GraphNode } from '../types/graph';

export interface LinkContext {
  hoveredNode: GraphNode | null;
  selectedEdge: { sourceId: string; targetId: string } | null;
  focusedEdgeNodeId: string | null;
  expandedNodeIds: Set<string> | null;
  hasChatFocus: boolean;
  chatFocusHighlightedNodeIds: Set<string>;
}

export function isGhostLink(link: GraphLink): boolean {
  return link.isGhost === true || link.type === 'LATENT_DISCOVERY';
}

export function isSemanticBridgeLink(link: GraphLink): boolean {
  return link.type === 'SEMANTIC_BRIDGE';
}

function isSelectedLink(
  link: GraphLink,
  selectedEdge: { sourceId: string; targetId: string } | null,
): boolean {
  if (!selectedEdge) {
    return false;
  }

  const source = typeof link.source === 'string' ? link.source : link.source.id;
  const target = typeof link.target === 'string' ? link.target : link.target.id;

  return source === selectedEdge.sourceId && target === selectedEdge.targetId;
}

function isFocusedNodeLink(link: GraphLink, focusedEdgeNodeId: string | null): boolean {
  if (!focusedEdgeNodeId) {
    return false;
  }

  const source = typeof link.source === 'string' ? link.source : link.source.id;
  const target = typeof link.target === 'string' ? link.target : link.target.id;

  return source === focusedEdgeNodeId || target === focusedEdgeNodeId;
}

export function getLinkColor(link: GraphLink, ctx: LinkContext): string {
  // When a concept is expanded, only show doc-doc links; hide everything else
  if (ctx.expandedNodeIds) {
    const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
    const targetId = typeof link.target === 'string' ? link.target : link.target.id;
    if (ctx.expandedNodeIds.has(sourceId) && ctx.expandedNodeIds.has(targetId)) {
      return ACTIVE_LINK_COLOR;
    }
    return 'rgba(0,0,0,0)';
  }

  if (isGhostLink(link)) {
    return GHOST_EDGE_COLOR;
  }

  if (isSemanticBridgeLink(link)) {
    if (
      isSelectedLink(link, ctx.selectedEdge) ||
      isFocusedNodeLink(link, ctx.focusedEdgeNodeId) ||
      isDirectHoverLink(link, ctx.hoveredNode)
    ) {
      return ACTIVE_LINK_COLOR;
    }
    if (ctx.focusedEdgeNodeId || ctx.hoveredNode) {
      return DIMMED_LINK_COLOR;
    }
    return SEMANTIC_BRIDGE_COLOR;
  }

  if (isSelectedLink(link, ctx.selectedEdge)) {
    return ACTIVE_LINK_COLOR;
  }

  if (ctx.hasChatFocus) {
    const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
    const targetId = typeof link.target === 'string' ? link.target : link.target.id;

    return ctx.chatFocusHighlightedNodeIds.has(sourceId) &&
      ctx.chatFocusHighlightedNodeIds.has(targetId)
      ? ACTIVE_LINK_COLOR
      : DIMMED_LINK_COLOR;
  }

  if (ctx.focusedEdgeNodeId) {
    return isFocusedNodeLink(link, ctx.focusedEdgeNodeId) ? ACTIVE_LINK_COLOR : DIMMED_LINK_COLOR;
  }

  if (ctx.hoveredNode) {
    return isDirectHoverLink(link, ctx.hoveredNode) ? ACTIVE_LINK_COLOR : DIMMED_LINK_COLOR;
  }

  return BASE_LINK_COLOR;
}

export function getLinkWidth(link: GraphLink, expandedNodeIds: Set<string> | null): number {
  if (expandedNodeIds) {
    const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
    const targetId = typeof link.target === 'string' ? link.target : link.target.id;
    if (!expandedNodeIds.has(sourceId) || !expandedNodeIds.has(targetId)) {
      return 0;
    }
  }

  if (isGhostLink(link)) {
    return GHOST_EDGE_WIDTH;
  }

  if (isSemanticBridgeLink(link)) {
    return SEMANTIC_BRIDGE_WIDTH;
  }

  const weight =
    typeof link.weight === 'number' && Number.isFinite(link.weight) && link.weight > 0
      ? link.weight
      : 1;

  return Math.log(weight + 1) * ESTABLISHED_LINK_WIDTH_MULTIPLIER;
}

export function getLinkLineDash(link: GraphLink): [number, number] | undefined {
  if (isGhostLink(link)) {
    return [2, 1];
  }

  return undefined;
}
