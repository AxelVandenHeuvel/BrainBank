import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph3D from 'react-force-graph-3d';
// @ts-expect-error - no types available
import { forceCollide } from 'd3-force-3d';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import {
  DIMMED_NODE_COLOR,
  DIMMED_SEARCH_COLOR,
  NODE_TYPE_COLORS,
  buildAdjacencyMap,
  conceptColorFromScore,
  communityColor,
  createFocusSet,
  findMatchingNodeIds,
  getConnectionCount,
} from '../lib/graphView';
import {
  clampNodesToContainment,
  createBrainContainment,
  type BrainContainment,
} from '../lib/brainModel';
import {
  centerObject3DAtOrigin,
  keepLocalPointAtWorldOrigin,
  rotateObjectFromPointerDelta,
} from '../lib/brainScene';
import type {
  GraphData,
  GraphLink,
  GraphNode,
  GraphSource,
  GraphStatsResponse,
  DiscoveryResponse,
  RelationshipDocument,
  RelationshipDetails,
} from '../types/graph';
import type { ActiveTraversal } from '../types/traversal';
import { EdgeDetailPanel } from './EdgeDetailPanel';
import { NodeTooltip } from './NodeTooltip';

import {
  TRAVERSAL_INACTIVE_COLOR,
  TRAVERSAL_AMBIENT_BLINK_PERIOD_MS,
  TRAVERSAL_AMBIENT_BLINK_BASE,
  TRAVERSAL_AMBIENT_BLINK_RANGE,
  TRAVERSAL_OUTLINE_COLOR,
  BRAIN_MODEL_URL,
  CAMERA_MOVE_DURATION_MS,
  AUTO_CENTER_PADDING,
  IDLE_ROTATE_DELAY_MS,
  IDLE_ROTATE_INTERVAL_MS,
  BUTTON_ZOOM_IN_FACTOR,
  BUTTON_ZOOM_OUT_FACTOR,
  WHEEL_ZOOM_IN_FACTOR,
  WHEEL_ZOOM_OUT_FACTOR,
  DOUBLE_CLICK_THRESHOLD_MS,
  BRAIN_HOME_VIEW_DISTANCE_MULTIPLIER,
  MIN_BRAIN_HOME_VIEW_DISTANCE,
  POINTER_ROTATION_SPEED,
  IDLE_ROTATION_SPEED,
  MAX_SCENE_TILT,
  BRAIN_MODEL_TARGET_DIAGONAL,
  DEFAULT_BRAIN_MESH_HEX,
  BRAIN_MESH_BASE_OPACITY,
  BRAIN_MESH_TOGGLE_FADE_DURATION_MS,
  EXPANDED_DOC_RADIUS,
  EXPANDED_VIEW_DISTANCE,
  DISCOVERY_OUTLINE_COLOR,
  DIVE_ZOOM_IN_DURATION_MS,
  DEFAULT_BACKGROUND_HEX,
  type ForceGraphHandle,
  type TooltipPosition,
  type BrainHomeView,
  type TraversalPulseWindow,
} from '../lib/graphConstants';

import {
  seedNodePosition,
  getTraversalBlinkPhase,
  formatStatLabel,
  applyNodeMaterialState,
  getBrainMeshMaterials,
  buildNodeThreeObject,
  resolveNodeColor,
} from '../lib/graphNodes';

import {
  getLinkColor as computeLinkColor,
  getLinkWidth as computeLinkWidth,
  getLinkLineDash,
  type LinkContext,
} from '../lib/graphLinks';

interface SelectedRelationshipEdge {
  sourceId: string;
  targetId: string;
  reason: string;
}

interface Graph3DProps {
  data: GraphData;
  source: GraphSource;
  query: string;
  chatFocus?: {
    sourceConcepts: string[];
    discoveryConcepts: string[];
  } | null;
  activeTraversal?: ActiveTraversal | null;
  hoveredNode?: GraphNode | null;
  onHoverNode?: (node: GraphNode | null) => void;
  onOpenDocument?: (docId: string, name: string, content: string) => void;
  onConceptFocused?: (conceptName: string | null) => void;
}

export function Graph3D({
  data,
  source: graphSource,
  query,
  chatFocus = null,
  activeTraversal = null,
  hoveredNode: hoveredNodeProp,
  onHoverNode: onHoverNodeProp,
  onOpenDocument,
  onConceptFocused,
}: Graph3DProps) {
  const [internalHoveredNode, setInternalHoveredNode] = useState<GraphNode | null>(null);
  const hoveredNode = hoveredNodeProp ?? internalHoveredNode;
  const onHoverNode = onHoverNodeProp ?? setInternalHoveredNode;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<ForceGraphHandle | null>(null);
  const brainContainmentRef = useRef<BrainContainment | null>(null);
  const brainGroupRef = useRef<THREE.Group | null>(null);
  const brainHomeViewRef = useRef<BrainHomeView | null>(null);
  const idleTimeoutRef = useRef<number | null>(null);
  const idleRotationIntervalRef = useRef<number | null>(null);
  const lastNodeClickRef = useRef<{ nodeId: string; timestamp: number } | null>(null);
  const activeRotationNodeIdRef = useRef<string | null>(null);
  const suppressBackgroundDoubleClickUntilRef = useRef(0);
  const lookAtTargetRef = useRef({ x: 0, y: 0, z: 0 });
  const sceneFocusPointRef = useRef({ x: 0, y: 0, z: 0 });
  const isDragRotatingRef = useRef(false);
  const lastDragPositionRef = useRef({ x: 0, y: 0 });
  const containerSizeRef = useRef({ width: 0, height: 0 });
  const cameraAnimationRef = useRef<number | null>(null);
  const cameraAnimationTargetRef = useRef<{
    pos: { x: number; y: number; z: number };
    lookAt: { x: number; y: number; z: number };
    focusPoint?: { x: number; y: number; z: number };
    onComplete?: () => void;
  } | null>(null);
  const brainMeshAnimationRef = useRef<number | null>(null);
  const simulationSettledRef = useRef(false);
  const pinnedPositionsRef = useRef<Map<string, { x: number; y: number; z: number }>>(new Map());
  const traversalPulseWindowsRef = useRef<Map<string, TraversalPulseWindow[]>>(new Map());
  const traversalRevealTimesRef = useRef<Map<string, number>>(new Map());
  const traversalRevealBrightnessRef = useRef<Map<string, number>>(new Map());
  const traversalRunStartedAtRef = useRef<number>(0);
  const traversalIsActiveRef = useRef(false);
  const lastSearchTargetIdRef = useRef<string | null>(null);
  const preSearchCameraRef = useRef<{
    pos: { x: number; y: number; z: number };
    lookAt: { x: number; y: number; z: number };
  } | null>(null);

  const [tooltipPosition, setTooltipPosition] = useState<TooltipPosition | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [selectedEdge, setSelectedEdge] = useState<SelectedRelationshipEdge | null>(null);
  const [relationshipDetails, setRelationshipDetails] = useState<RelationshipDetails | null>(null);
  const [relationshipError, setRelationshipError] = useState<string | null>(null);
  const [isRelationshipLoading, setIsRelationshipLoading] = useState(false);
  const [hasFocusedRotationPivot, setHasFocusedRotationPivot] = useState(false);
  const [focusedEdgeNodeId, setFocusedEdgeNodeId] = useState<string | null>(null);
  const discoveryModeEnabled = true;
  const [latentLinks, setLatentLinks] = useState<GraphLink[]>([]);
  const [expandedConcept, setExpandedConcept] = useState<{
    node: GraphNode;
    docs: RelationshipDocument[];
  } | null>(null);
  const diveStartTimeRef = useRef<number | null>(null);
  const [isDiving, setIsDiving] = useState(false);
  const [emptyConceptName, setEmptyConceptName] = useState<string | null>(null);
  const [showBrainMesh, setShowBrainMesh] = useState(true);
  const [graphStats, setGraphStats] = useState<GraphStatsResponse | null>(null);
  const showBrainMeshRef = useRef(showBrainMesh);

  useEffect(() => {
    showBrainMeshRef.current = showBrainMesh;
  }, [showBrainMesh]);

  useEffect(() => {
    if (!emptyConceptName) return;
    const id = setTimeout(() => setEmptyConceptName(null), 3000);
    return () => clearTimeout(id);
  }, [emptyConceptName]);

  useEffect(() => {
    if (graphSource !== 'api') {
      setGraphStats(null);
      return;
    }

    const controller = new AbortController();

    async function loadGraphStats() {
      try {
        const response = await fetch('/api/stats', {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`Stats request failed: ${response.status}`);
        }

        const nextStats = (await response.json()) as GraphStatsResponse;
        setGraphStats(nextStats);
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        console.warn('Failed to load graph stats footer data', error);
        setGraphStats(null);
      }
    }

    void loadGraphStats();

    return () => {
      controller.abort();
    };
  }, [graphSource]);

  // No node injection — documents are shown in a 2D overlay on concept click.
  const displayData = useMemo<GraphData>(() => {
    const existingNodeIds = new Set(data.nodes.map((node) => node.id));
    const nodes = [...data.nodes];
    const links = [...data.links];

    if (discoveryModeEnabled && latentLinks.length > 0) {
      const ghostNodes: GraphNode[] = [];

      for (const link of latentLinks) {
        const targetId = typeof link.target === 'string' ? link.target : link.target.id;
        if (existingNodeIds.has(targetId)) {
          continue;
        }

        existingNodeIds.add(targetId);
        const targetName = targetId.startsWith('doc:') ? targetId.slice('doc:'.length) : targetId;
        ghostNodes.push({
          id: targetId,
          type: 'Document',
          name: targetName,
        });
      }

      nodes.push(...ghostNodes);
      links.push(...latentLinks);
    }
    // Seed initial positions so the simulation starts spread out
    nodes.forEach((node) => {
      if (node.x === undefined || node.y === undefined || node.z === undefined) {
        const pos = seedNodePosition(node.id);
        node.x = pos.x;
        node.y = pos.y;
        node.z = pos.z;
      }
    });

    // Re-apply pinned positions so graphData changes never lose fx/fy/fz.
    // Without this, react-force-graph-3d reheats and nodes escape the brain.
    const pins = pinnedPositionsRef.current;
    nodes.forEach((node) => {
      const pin = pins.get(node.id);
      if (pin) {
        node.x = pin.x;
        node.y = pin.y;
        node.z = pin.z;
        node.fx = pin.x;
        node.fy = pin.y;
        node.fz = pin.z;
      }
    });

    // Inject document sub-nodes when a concept is expanded (dive-in view)
    if (expandedConcept) {
      const conceptInGraph = nodes.find((n) => n.id === expandedConcept.node.id);
      if (conceptInGraph) {
        const cx = conceptInGraph.x ?? 0;
        const cy = conceptInGraph.y ?? 0;
        const cz = conceptInGraph.z ?? 0;

        // Add doc sub-nodes in a ring around the concept position
        const docIds: string[] = [];
        expandedConcept.docs.forEach((doc, i) => {
          const angle = (i / expandedConcept.docs.length) * Math.PI * 2;
          const docNodeId = `doc-expand:${doc.doc_id}`;
          docIds.push(docNodeId);
          if (!existingNodeIds.has(docNodeId)) {
            existingNodeIds.add(docNodeId);
            const dx = cx + EXPANDED_DOC_RADIUS * Math.cos(angle);
            const dy = cy;
            const dz = cz + EXPANDED_DOC_RADIUS * Math.sin(angle);
            nodes.push({
              id: docNodeId,
              type: 'Document',
              name: doc.name,
              x: dx, y: dy, z: dz,
              fx: dx, fy: dy, fz: dz,
            });
          }
        });

        // Fully-connected edges between all doc pairs (no concept→doc edges)
        for (let a = 0; a < docIds.length; a++) {
          for (let b = a + 1; b < docIds.length; b++) {
            links.push({
              source: docIds[a],
              target: docIds[b],
              type: 'DOC_SIBLING',
              weight: 1,
            });
          }
        }
      }
    }

    return {
      nodes,
      links,
    };
  }, [data, discoveryModeEnabled, latentLinks, expandedConcept]);

  const expandedNodeIds = useMemo<Set<string> | null>(() => {
    if (!expandedConcept) return null;
    const ids = new Set<string>();
    expandedConcept.docs.forEach((doc) => ids.add(`doc-expand:${doc.doc_id}`));
    return ids;
  }, [expandedConcept]);

  const displayDataRef = useRef(displayData);
  displayDataRef.current = displayData;

  const graphStatsSummary = useMemo(() => {
    const visibleDocumentCount = displayData.nodes.filter((node) => node.type === 'Document').length;
    const documentCount = graphStats?.total_documents ?? visibleDocumentCount;

    return [
      formatStatLabel(displayData.nodes.length, 'node', 'nodes'),
      formatStatLabel(displayData.links.length, 'edge', 'edges'),
      formatStatLabel(documentCount, 'document', 'documents'),
    ].join(' • ');
  }, [displayData, graphStats]);

  useEffect(() => {
    traversalPulseWindowsRef.current = new Map();
    traversalRevealTimesRef.current = new Map();
    traversalRevealBrightnessRef.current = new Map();
    traversalRunStartedAtRef.current = 0;
    traversalIsActiveRef.current = activeTraversal !== null;

    if (!activeTraversal) {
      return;
    }

    const availableNodeIds = new Set(displayData.nodes.map((node) => node.id));
    const windows = new Map<string, TraversalPulseWindow[]>();
    const revealTimes = new Map<string, number>();
    const revealBrightness = new Map<string, number>();
    const startTime = performance.now();
    traversalRunStartedAtRef.current = startTime;

    activeTraversal.plan.steps.forEach((step) => {
      if (!availableNodeIds.has(step.nodeId)) {
        return;
      }

      if (!revealTimes.has(step.nodeId)) {
        revealTimes.set(step.nodeId, startTime + step.delayMs);
      }
      revealBrightness.set(
        step.nodeId,
        Math.max(revealBrightness.get(step.nodeId) ?? 0, step.brightness),
      );

      const nodeWindows = windows.get(step.nodeId) ?? [];
      nodeWindows.push({
        startMs: startTime + step.delayMs,
        endMs: startTime + step.delayMs + activeTraversal.plan.pulseDurationMs,
        brightness: step.brightness,
      });
      windows.set(step.nodeId, nodeWindows);
    });

    traversalPulseWindowsRef.current = windows;
    traversalRevealTimesRef.current = revealTimes;
    traversalRevealBrightnessRef.current = revealBrightness;

    const now = performance.now();
    displayData.nodes.forEach((node) => {
      const obj = (node as GraphNode & { __threeObj?: THREE.Object3D }).__threeObj;
      if (!obj) {
        return;
      }

      const revealTime = revealTimes.get(node.id);
      const isRevealed = revealTime !== undefined && now >= revealTime;
      obj.userData.traversalRevealed = isRevealed;

      if (!isRevealed) {
        applyNodeMaterialState(
          obj,
          TRAVERSAL_INACTIVE_COLOR,
          TRAVERSAL_INACTIVE_COLOR.clone().multiplyScalar(0.05),
          Number(obj.userData.currentOpacity ?? 0.9),
        );
      }
    });
  }, [activeTraversal, displayData.nodes]);

  const adjacency = buildAdjacencyMap(displayData);
  const matchedNodeIds = findMatchingNodeIds(displayData.nodes, query);
  const chatFocusNodeIds = useMemo(() => {
    if (!chatFocus) {
      return {
        sourceNodeIds: new Set<string>(),
        discoveryNodeIds: new Set<string>(),
        highlightedNodeIds: new Set<string>(),
      };
    }

    const sourceNames = new Set(chatFocus.sourceConcepts);
    const discoveryNames = new Set(chatFocus.discoveryConcepts);
    const sourceNodeIds = new Set<string>();
    const discoveryNodeIds = new Set<string>();

    displayData.nodes.forEach((node) => {
      if (node.type !== 'Concept') {
        return;
      }

      if (sourceNames.has(node.name)) {
        sourceNodeIds.add(node.id);
      }
      if (discoveryNames.has(node.name) && !sourceNames.has(node.name)) {
        discoveryNodeIds.add(node.id);
      }
    });

    return {
      sourceNodeIds,
      discoveryNodeIds,
      highlightedNodeIds: new Set([...sourceNodeIds, ...discoveryNodeIds]),
    };
  }, [chatFocus, displayData.nodes]);
  const focusedNodeIds = createFocusSet(hoveredNode, adjacency);
  const hoveredNodeId = hoveredNode?.id ?? null;
  const selectedNodeIds = selectedEdge
    ? new Set([selectedEdge.sourceId, selectedEdge.targetId])
    : new Set<string>();
  const hasChatFocus = chatFocusNodeIds.highlightedNodeIds.size > 0;

  function getConceptName(nodeId: string): string | null {
    if (!nodeId.startsWith('concept:')) {
      return null;
    }

    return nodeId.slice('concept:'.length);
  }

  function getNodeName(nodeId: string): string {
    const node = displayData.nodes.find((candidate) => candidate.id === nodeId);
    return node?.name ?? nodeId;
  }

  function clearSelectedEdge() {
    setSelectedEdge(null);
    setRelationshipDetails(null);
    setRelationshipError(null);
    setIsRelationshipLoading(false);
  }

  const getNodeThreeObject = useCallback((node: GraphNode): THREE.Object3D => {
    const nodeColor = resolveNodeColor(node);
    const group = buildNodeThreeObject(node, nodeColor);

    const initialRevealTime = traversalRevealTimesRef.current.get(node.id);
    const initialTraversalRevealed =
      traversalIsActiveRef.current &&
      initialRevealTime !== undefined &&
      performance.now() >= initialRevealTime;
    group.userData.traversalRevealed = initialTraversalRevealed;
    applyNodeMaterialState(
      group,
      initialTraversalRevealed || !traversalIsActiveRef.current
        ? nodeColor
        : TRAVERSAL_INACTIVE_COLOR,
      initialTraversalRevealed || !traversalIsActiveRef.current
        ? nodeColor.clone().multiplyScalar(0.15)
        : TRAVERSAL_INACTIVE_COLOR.clone().multiplyScalar(0.05),
      0.9,
    );
    group.userData.update = (time: number) => {
      const windows = traversalPulseWindowsRef.current.get(node.id) ?? [];
      const revealTime = traversalRevealTimesRef.current.get(node.id);
      const revealStrength = traversalRevealBrightnessRef.current.get(node.id) ?? 1;
      let pulse = 0;

      windows.forEach((window) => {
        if (time < window.startMs || time > window.endMs) {
          return;
        }

        const progress = (time - window.startMs) / Math.max(window.endMs - window.startMs, 1);
        const triangle = progress <= 0.5 ? progress * 2 : (1 - progress) * 2;
        pulse = Math.max(pulse, triangle * window.brightness);
      });

      const traversalRevealed =
        traversalIsActiveRef.current &&
        revealTime !== undefined &&
        time >= revealTime;
      if (traversalRevealed) {
        const traversalElapsedMs = Math.max(0, time - traversalRunStartedAtRef.current);
        const oscillation =
          (Math.sin(
            ((traversalElapsedMs / TRAVERSAL_AMBIENT_BLINK_PERIOD_MS) * Math.PI * 2) +
            getTraversalBlinkPhase(node.id),
          ) + 1) / 2;
        const ambientPulse =
          (TRAVERSAL_AMBIENT_BLINK_BASE + (oscillation * TRAVERSAL_AMBIENT_BLINK_RANGE)) *
          revealStrength;
        pulse = Math.max(pulse, ambientPulse);
      }

      group.userData.traversalPulse = pulse;
      group.userData.traversalRevealed = traversalRevealed;
    };
    (node as GraphNode & { __threeObj?: THREE.Object3D }).__threeObj = group;

    return group;
  }, []);

  function clampNodesWithinBrain(refresh = false) {
    const containment = brainContainmentRef.current;

    if (!containment) {
      return;
    }

    const changed = clampNodesToContainment(displayData.nodes, containment);

    if (changed && refresh) {
      graphRef.current?.refresh();
    }
  }

  function getGraphCenter() {
    const bounds = graphRef.current?.getGraphBbox();

    if (!bounds) {
      return { x: 0, y: 0, z: 0 };
    }

    return {
      x: (bounds.x[0] + bounds.x[1]) / 2,
      y: (bounds.y[0] + bounds.y[1]) / 2,
      z: (bounds.z[0] + bounds.z[1]) / 2,
    };
  }

  function getRotationRoot() {
    return graphRef.current?.scene() ?? null;
  }

  function resetSceneTransform() {
    const rotationRoot = getRotationRoot();

    if (!rotationRoot) {
      return;
    }

    rotationRoot.rotation.set(0, 0, 0);
    rotationRoot.position.set(0, 0, 0);
    rotationRoot.updateMatrixWorld(true);
  }

  function setRotationPivotNode(nodeId: string | null) {
    activeRotationNodeIdRef.current = nodeId;
    setHasFocusedRotationPivot(nodeId !== null);
    setFocusedEdgeNodeId(nodeId);

    if (onConceptFocused) {
      if (nodeId !== null && nodeId.startsWith('concept:')) {
        onConceptFocused(nodeId.slice('concept:'.length));
      } else {
        onConceptFocused(null);
      }
    }
  }

  function toWorldPoint(point: { x: number; y: number; z: number }) {
    const worldPoint = new THREE.Vector3(point.x, point.y, point.z);
    const rotationRoot = getRotationRoot();

    if (!rotationRoot) {
      return worldPoint;
    }

    rotationRoot.updateMatrixWorld(true);
    return rotationRoot.localToWorld(worldPoint);
  }

  function applySceneFocusPoint() {
    const rotationRoot = getRotationRoot();

    if (!rotationRoot) {
      return;
    }

    const focusPt = new THREE.Vector3(
      sceneFocusPointRef.current.x,
      sceneFocusPointRef.current.y,
      sceneFocusPointRef.current.z,
    );

    keepLocalPointAtWorldOrigin(rotationRoot, focusPt);
    sceneFocusPointRef.current = {
      x: focusPt.x,
      y: focusPt.y,
      z: focusPt.z,
    };
    rotationRoot.updateMatrixWorld(true);
    lookAtTargetRef.current = { x: 0, y: 0, z: 0 };
  }

  function focusPoint(point: { x: number; y: number; z: number }, distance: number) {
    animateCamera(
      {
        x: 0,
        y: distance * 0.08,
        z: distance,
      },
      { x: 0, y: 0, z: 0 },
      CAMERA_MOVE_DURATION_MS,
      undefined,
      point,
    );
  }

  function stopIdleRotation() {
    if (idleRotationIntervalRef.current !== null) {
      window.clearInterval(idleRotationIntervalRef.current);
      idleRotationIntervalRef.current = null;
    }
  }

  function startIdleRotation() {
    stopIdleRotation();
    idleRotationIntervalRef.current = window.setInterval(() => {
      const rotationRoot = getRotationRoot();

      if (!rotationRoot) {
        return;
      }

      rotationRoot.rotation.order = 'YXZ';
      rotationRoot.rotation.y += IDLE_ROTATION_SPEED;
      applySceneFocusPoint();
    }, IDLE_ROTATE_INTERVAL_MS);
  }

  function scheduleIdleRotation(delayMs: number = IDLE_ROTATE_DELAY_MS) {
    if (idleTimeoutRef.current !== null) {
      window.clearTimeout(idleTimeoutRef.current);
    }

    idleTimeoutRef.current = window.setTimeout(() => {
      startIdleRotation();
    }, delayMs);
  }

  function handleInteraction() {
    if (idleTimeoutRef.current !== null) {
      window.clearTimeout(idleTimeoutRef.current);
      idleTimeoutRef.current = null;
    }
    stopIdleRotation();
  }

  function handleReset() {
    setRotationPivotNode(null);
    setLatentLinks([]);
    setExpandedConcept(null);
    setIsDiving(false);
    diveStartTimeRef.current = null;

    const brainHomeView = brainHomeViewRef.current;

    if (brainHomeView) {
      resetSceneTransform();
      sceneFocusPointRef.current = brainHomeView.focusPoint;
      applySceneFocusPoint();
      const target = lookAtTargetRef.current;
      animateCamera(
        {
          x: target.x,
          y: target.y + brainHomeView.distance * 0.08,
          z: target.z + brainHomeView.distance,
        },
        target,
      );
      scheduleIdleRotation(CAMERA_MOVE_DURATION_MS);
      return;
    }

    resetSceneTransform();
    sceneFocusPointRef.current = { x: 0, y: 0, z: 0 };
    lookAtTargetRef.current = getGraphCenter();
    graphRef.current?.zoomToFit(CAMERA_MOVE_DURATION_MS, AUTO_CENTER_PADDING);
    scheduleIdleRotation(CAMERA_MOVE_DURATION_MS);
    scheduleIdleRotation();
  }

  const suppressNextForceGraphClickRef = useRef(false);

  /** Find the closest visible node to a screen position using 2D projection. */
  function findNodeAtScreenPos(clientX: number, clientY: number): GraphNode | null {
    const fg = graphRef.current;
    const container = containerRef.current;
    if (!fg || !container) return null;

    const rect = container.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;

    let closest: GraphNode | null = null;
    let closestDist = Infinity;
    const threshold = 25; // pixels

    for (const node of displayDataRef.current.nodes) {
      const worldPos = toWorldPoint({ x: node.x ?? 0, y: node.y ?? 0, z: node.z ?? 0 });
      const screenCoords = fg.graph2ScreenCoords(worldPos.x, worldPos.y, worldPos.z);
      const dx = screenCoords.x - localX;
      const dy = screenCoords.y - localY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < threshold && dist < closestDist) {
        closest = node;
        closestDist = dist;
      }
    }

    return closest;
  }

  function snapCameraAnimationToEnd() {
    if (cameraAnimationRef.current !== null) {
      cancelAnimationFrame(cameraAnimationRef.current);
      cameraAnimationRef.current = null;
    }
    const target = cameraAnimationTargetRef.current;
    if (target) {
      if (target.focusPoint) {
        sceneFocusPointRef.current = target.focusPoint;
        applySceneFocusPoint();
      }
      graphRef.current?.cameraPosition(target.pos, target.lookAt);
      lookAtTargetRef.current = target.lookAt;
      const cb = target.onComplete;
      cameraAnimationTargetRef.current = null;
      cb?.();
    }
  }

  function handleMouseDown(event: React.MouseEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }

    if (event.target instanceof HTMLElement && event.target.closest('button')) {
      return;
    }

    // If camera is mid-animation, identify the node under the cursor
    // at the current intermediate camera position and handle the click
    // ourselves — ForceGraph3D's raycast would miss because the camera
    // is moving.
    if (cameraAnimationRef.current !== null) {
      const node = findNodeAtScreenPos(event.clientX, event.clientY);
      if (node) {
        // Cancel the in-flight animation (don't snap — we'll start a
        // new animation toward the clicked node).
        cancelAnimationFrame(cameraAnimationRef.current);
        cameraAnimationRef.current = null;
        cameraAnimationTargetRef.current = null;

        // Suppress ForceGraph3D's click for this interaction.
        suppressNextForceGraphClickRef.current = true;
        setTimeout(() => { suppressNextForceGraphClickRef.current = false; }, 300);

        handleNodeClick(node);
        return;
      }
      // No node under cursor — snap to end so next interaction works.
      snapCameraAnimationToEnd();
    }

    isDragRotatingRef.current = true;
    lastDragPositionRef.current = {
      x: event.clientX,
      y: event.clientY,
    };
    handleInteraction();
  }

  function handleMouseMove(event: React.MouseEvent<HTMLDivElement>) {
    if (!isDragRotatingRef.current) {
      return;
    }

    if ((event.buttons & 1) !== 1) {
      isDragRotatingRef.current = false;
      return;
    }

    const deltaX = event.clientX - lastDragPositionRef.current.x;
    const deltaY = event.clientY - lastDragPositionRef.current.y;
    lastDragPositionRef.current = {
      x: event.clientX,
      y: event.clientY,
    };

    const rotationRoot = getRotationRoot();

    if (!rotationRoot) {
      return;
    }

    rotateObjectFromPointerDelta(
      rotationRoot,
      deltaX,
      deltaY,
      POINTER_ROTATION_SPEED,
      MAX_SCENE_TILT,
    );
    applySceneFocusPoint();
  }

  function handleMouseEnd() {
    isDragRotatingRef.current = false;
  }

  function handleZoom(scale: number) {
    const currentPosition = graphRef.current?.cameraPosition();

    if (!currentPosition) {
      return;
    }

    const lookAt = lookAtTargetRef.current;

    animateCamera(
      {
        x: lookAt.x + (currentPosition.x - lookAt.x) * scale,
        y: lookAt.y + (currentPosition.y - lookAt.y) * scale,
        z: lookAt.z + (currentPosition.z - lookAt.z) * scale,
      },
      lookAt,
      400,
    );
  }

  function handleZoomIn() {
    handleZoom(BUTTON_ZOOM_IN_FACTOR);
  }

  function handleZoomOut() {
    handleZoom(BUTTON_ZOOM_OUT_FACTOR);
  }

  function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
    if (event.deltaY === 0) {
      return;
    }

    handleInteraction();
    event.preventDefault();
    handleZoom(event.deltaY < 0 ? WHEEL_ZOOM_IN_FACTOR : WHEEL_ZOOM_OUT_FACTOR);
  }

  async function fetchConceptDocs(conceptName: string): Promise<RelationshipDocument[]> {
    let docs: RelationshipDocument[] = [];
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      const response = await fetch(`/api/concepts/${encodeURIComponent(conceptName)}/documents`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (response.ok) {
        docs = await response.json();
      }
    } catch { }
    return docs;
  }

  async function handleConceptExpansion(node: GraphNode) {
    const docs = await fetchConceptDocs(node.name);

    if (docs.length === 0) {
      setEmptyConceptName(node.name);
      return;
    }

    const nodePoint = { x: node.x ?? 0, y: node.y ?? 0, z: node.z ?? 0 };

    // Start dive animation: push the camera inward while the rest of the brain fades away.
    setIsDiving(true);
    diveStartTimeRef.current = performance.now();

    // Phase 1: zoom into the concept node
    sceneFocusPointRef.current = nodePoint;
    applySceneFocusPoint();
    const target = lookAtTargetRef.current;
    animateCamera(
      {
        x: target.x,
        y: target.y + EXPANDED_VIEW_DISTANCE * 0.08,
        z: target.z + EXPANDED_VIEW_DISTANCE,
      },
      target,
      DIVE_ZOOM_IN_DURATION_MS,
      () => {
        setExpandedConcept({ node, docs });
        setIsDiving(false);
        diveStartTimeRef.current = null;
      },
    );
  }

  async function loadLatentDiscovery(node: GraphNode): Promise<void> {
    if (!discoveryModeEnabled || graphSource !== 'api' || node.type !== 'Concept') {
      setLatentLinks([]);
      return;
    }

    try {
      const response = await fetch('/api/discovery/latent/' + encodeURIComponent(node.name));
      if (!response.ok) {
        throw new Error('Request failed with status ' + response.status);
      }

      const payload = (await response.json()) as DiscoveryResponse;
      const sourceId = node.id;
      const nextLatentLinks: GraphLink[] = payload.results.map((result) => ({
        source: sourceId,
        target: 'doc:' + result.doc_name,
        type: 'LATENT_DISCOVERY',
        reason: 'latent_tether',
        weight: Math.max(result.similarity_score, 0.01),
        isGhost: true,
      }));
      setLatentLinks(nextLatentLinks);
    } catch {
      setLatentLinks([]);
    }
  }

  function animateCamera(
    targetPos: { x: number; y: number; z: number },
    targetLookAt: { x: number; y: number; z: number },
    durationMs: number = CAMERA_MOVE_DURATION_MS,
    onComplete?: () => void,
    targetFocusPoint?: { x: number; y: number; z: number },
  ) {
    // Cancel any in-flight camera animation so consecutive moves don't conflict.
    if (cameraAnimationRef.current !== null) {
      cancelAnimationFrame(cameraAnimationRef.current);
      cameraAnimationRef.current = null;
    }

    // Store the final destination so we can snap to it on click.
    cameraAnimationTargetRef.current = {
      pos: targetPos,
      lookAt: targetLookAt,
      focusPoint: targetFocusPoint,
      onComplete,
    };

    const cam = graphRef.current?.cameraPosition();
    if (!cam) return;

    const startCam = { x: cam.x, y: cam.y, z: cam.z };
    const startLookAt = { ...lookAtTargetRef.current };
    const startFocusPoint = { ...sceneFocusPointRef.current };
    const startTime = performance.now();

    function animate() {
      const elapsed = performance.now() - startTime;
      const t = Math.min(elapsed / durationMs, 1);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic

      if (targetFocusPoint) {
        sceneFocusPointRef.current = {
          x: startFocusPoint.x + (targetFocusPoint.x - startFocusPoint.x) * eased,
          y: startFocusPoint.y + (targetFocusPoint.y - startFocusPoint.y) * eased,
          z: startFocusPoint.z + (targetFocusPoint.z - startFocusPoint.z) * eased,
        };
        applySceneFocusPoint();
      }

      const pos = {
        x: startCam.x + (targetPos.x - startCam.x) * eased,
        y: startCam.y + (targetPos.y - startCam.y) * eased,
        z: startCam.z + (targetPos.z - startCam.z) * eased,
      };
      const look = {
        x: startLookAt.x + (targetLookAt.x - startLookAt.x) * eased,
        y: startLookAt.y + (targetLookAt.y - startLookAt.y) * eased,
        z: startLookAt.z + (targetLookAt.z - startLookAt.z) * eased,
      };

      graphRef.current?.cameraPosition(pos, look);
      lookAtTargetRef.current = look;

      if (t < 1) {
        cameraAnimationRef.current = requestAnimationFrame(animate);
      } else {
        cameraAnimationRef.current = null;
        cameraAnimationTargetRef.current = null;
        onComplete?.();
      }
    }

    cameraAnimationRef.current = requestAnimationFrame(animate);
  }

  function smoothFlyToNode(nodePoint: { x: number; y: number; z: number }, distance: number) {
    const worldPos = toWorldPoint(nodePoint);
    const cam = graphRef.current?.cameraPosition();
    if (!cam) return;

    // Use direction from current lookAt to camera (the viewing direction).
    // This stays stable during rapid successive clicks, unlike cam-to-node
    // which degenerates when the camera passes close to a node mid-flight.
    const lookAt = lookAtTargetRef.current;
    const dx = cam.x - lookAt.x;
    const dy = cam.y - lookAt.y;
    const dz = cam.z - lookAt.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;

    animateCamera(
      {
        x: worldPos.x + (dx / len) * distance,
        y: worldPos.y + (dy / len) * distance,
        z: worldPos.z + (dz / len) * distance,
      },
      { x: worldPos.x, y: worldPos.y, z: worldPos.z },
    );
  }

  function handleNodeClick(node: GraphNode) {
    handleInteraction();
    const now = Date.now();
    const nodePoint = {
      x: node.x ?? 0,
      y: node.y ?? 0,
      z: node.z ?? 0,
    };

    // Handle doc-expand nodes (shown inside expanded concept view)
    if (node.id.startsWith('doc-expand:') && expandedConcept) {
      suppressBackgroundDoubleClickUntilRef.current = now + DOUBLE_CLICK_THRESHOLD_MS;

      if (
        lastNodeClickRef.current &&
        lastNodeClickRef.current.nodeId === node.id &&
        now - lastNodeClickRef.current.timestamp <= DOUBLE_CLICK_THRESHOLD_MS
      ) {
        // Double-click doc node: open it in the editor
        const docId = node.id.slice('doc-expand:'.length);
        const doc = expandedConcept.docs.find((d) => d.doc_id === docId);
        if (doc && onOpenDocument) {
          onOpenDocument(doc.doc_id, doc.name, doc.full_text);
        }
        lastNodeClickRef.current = null;
        return;
      }

      // Single-click doc node: record the click without zoom so the second click stays reliable.
      lastNodeClickRef.current = { nodeId: node.id, timestamp: now };
      clearSelectedEdge();
      return;
    }

    // Collapse expanded view when clicking a different concept
    if (expandedConcept && node.id !== expandedConcept.node.id) {
      setExpandedConcept(null);
    }

    clearSelectedEdge();
    setRotationPivotNode(node.id);
    suppressBackgroundDoubleClickUntilRef.current = now + DOUBLE_CLICK_THRESHOLD_MS;

    if (node.type !== 'Concept') {
      lastNodeClickRef.current = null;
      setLatentLinks([]);
      // Reposition scene so node is at origin, then fly camera to face it
      focusPoint(nodePoint, 140);
      return;
    }

    if (
      lastNodeClickRef.current &&
      lastNodeClickRef.current.nodeId === node.id &&
      now - lastNodeClickRef.current.timestamp <= DOUBLE_CLICK_THRESHOLD_MS
    ) {
      // Double click: dive into concept — animated zoom in, then reveal doc sub-graph
      handleConceptExpansion(node);
      lastNodeClickRef.current = null;
      return;
    }

    // Single click: reposition scene so node is centered, then fly camera
    lastNodeClickRef.current = { nodeId: node.id, timestamp: now };
    focusPoint(nodePoint, 140);
    void loadLatentDiscovery(node);
  }

  async function handleLinkClick(link: GraphLink) {
    handleInteraction();
    if (link.isGhost === true || link.type === 'LATENT_DISCOVERY') {
      return;
    }
    setRotationPivotNode(null);
    setLatentLinks([]);
    const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
    const targetId = typeof link.target === 'string' ? link.target : link.target.id;
    const sourceConcept = getConceptName(sourceId);
    const targetConcept = getConceptName(targetId);
    const sourceName = getNodeName(sourceId);
    const targetName = getNodeName(targetId);

    setSelectedEdge({
      sourceId,
      targetId,
      reason: link.reason ?? '',
    });
    setRelationshipDetails({
      source: sourceName,
      target: targetName,
      type: link.type,
      reason: link.reason ?? `${link.type} connection`,
      source_documents: [],
      target_documents: [],
      shared_document_ids: [],
    });
    setRelationshipError(null);
    setIsRelationshipLoading(link.type === 'RELATED_TO');

    if (link.type !== 'RELATED_TO') {
      return;
    }

    if (!sourceConcept || !targetConcept) {
      setRelationshipError('Relationship details are only available for concept-to-concept links.');
      setIsRelationshipLoading(false);
      return;
    }

    try {
      const params = new URLSearchParams({
        source: sourceConcept,
        target: targetConcept,
      });
      const response = await fetch(`/api/relationships/details?${params.toString()}`, {
        method: 'GET',
      });

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      const payload = (await response.json()) as RelationshipDetails;
      setRelationshipDetails(payload);
    } catch (error) {
      setRelationshipError(
        error instanceof Error ? error.message : 'Failed to load relationship details',
      );
    } finally {
      setIsRelationshipLoading(false);
    }
  }


  useEffect(() => {
    startIdleRotation();

    return () => {
      if (idleTimeoutRef.current !== null) {
        window.clearTimeout(idleTimeoutRef.current);
        idleTimeoutRef.current = null;
      }

      stopIdleRotation();
    };
  }, []);

  // Configure forces: repulsion, collision, weighted links, and centering
  useEffect(() => {
    const fg = graphRef.current as any;
    if (!fg?.d3Force) return;
    fg.d3Force('charge')?.strength(-150).distanceMax(200);
    fg.d3Force('center')?.strength(0.15);
    // Collision force prevents nodes from overlapping (minimum distance between centers)
    fg.d3Force('collision', forceCollide(18).strength(1).iterations(3));
    fg.d3Force('link')
      ?.distance((link: any) => {
        const w = typeof link.weight === 'number' && link.weight > 0 ? link.weight : 1;
        return 50 / w;
      })
      .strength((link: any) => {
        const w = typeof link.weight === 'number' && link.weight > 0 ? link.weight : 1;
        return 0.5 * Math.min(w / 3, 1);
      });
  }, []);

  useEffect(() => {
    const scene = graphRef.current?.scene();

    if (!scene) {
      return;
    }

    const loader = new GLTFLoader();
    let cancelled = false;
    let brainGroup: THREE.Group | null = null;

    loader.load(BRAIN_MODEL_URL, (gltf) => {
      if (cancelled) {
        return;
      }

      const centeredBrain = centerObject3DAtOrigin(gltf.scene, BRAIN_MODEL_TARGET_DIAGONAL);
      brainGroup = centeredBrain.pivot;

      brainGroup.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          const material = new THREE.MeshBasicMaterial({
            color: DEFAULT_BRAIN_MESH_HEX,
            wireframe: true,
            transparent: true,
            opacity: BRAIN_MESH_BASE_OPACITY,
            side: THREE.DoubleSide,
          });
          material.userData.baseOpacity = BRAIN_MESH_BASE_OPACITY;
          node.material = material;
        }
      });

      brainContainmentRef.current = createBrainContainment(brainGroup);
      brainHomeViewRef.current = {
        distance: Math.max(
          centeredBrain.sphere.radius * BRAIN_HOME_VIEW_DISTANCE_MULTIPLIER,
          MIN_BRAIN_HOME_VIEW_DISTANCE,
        ),
        focusPoint: {
          x: centeredBrain.orbitTarget.x,
          y: centeredBrain.orbitTarget.y,
          z: centeredBrain.orbitTarget.z,
        },
      };
      // Clamp existing nodes into the brain volume using the ref
      // (the closure's displayData may be stale since this effect has [] deps).
      const currentNodes = displayDataRef.current.nodes;
      clampNodesToContainment(currentNodes, brainContainmentRef.current);
      graphRef.current?.refresh();

      // Clear fx/fy/fz so the reheated simulation can actually spread
      // nodes out. Without this, pinned nodes stay clustered near the origin.
      pinnedPositionsRef.current.clear();
      currentNodes.forEach((n) => {
        delete n.fx;
        delete n.fy;
        delete n.fz;
      });

      brainGroupRef.current = brainGroup;
      const meshVisible = showBrainMeshRef.current;
      brainGroup.visible = meshVisible;
      getBrainMeshMaterials(brainGroup).forEach((material) => {
        material.opacity = meshVisible ? (material.userData.baseOpacity ?? BRAIN_MESH_BASE_OPACITY) : 0;
      });
      scene.add(brainGroup);
      // Reset settled flag so the reheated simulation runs clamping in onEngineTick
      simulationSettledRef.current = false;
      (graphRef.current as any)?.d3ReheatSimulation?.();
      handleReset();
    });

    return () => {
      cancelled = true;
      brainContainmentRef.current = null;
      brainGroupRef.current = null;
      brainHomeViewRef.current = null;

      if (brainGroup) {
        scene.remove(brainGroup);
      }
    };
  }, []);

  useEffect(() => {
    clampNodesWithinBrain(true);
    // Sync pin map with clamped positions
    if (brainContainmentRef.current) {
      const pins = pinnedPositionsRef.current;
      displayData.nodes.forEach((n) => {
        pins.set(n.id, { x: n.x ?? 0, y: n.y ?? 0, z: n.z ?? 0 });
        n.fx = n.x;
        n.fy = n.y;
        n.fz = n.z;
      });
    }
  }, [displayData.nodes]);

  // Fade + hide brain wireframe during dive and when in expanded concept view
  useEffect(() => {
    const brain = brainGroupRef.current;
    if (!brain) {
      return;
    }

    const brainMaterials = getBrainMeshMaterials(brain);
    if (brainMaterials.length === 0) {
      return;
    }

    const stopBrainMeshAnimation = () => {
      if (brainMeshAnimationRef.current !== null) {
        cancelAnimationFrame(brainMeshAnimationRef.current);
        brainMeshAnimationRef.current = null;
      }
    };

    const setBrainOpacity = (opacity: number) => {
      brainMaterials.forEach((material) => {
        material.opacity = opacity;
      });
    };

    if (expandedConcept !== null && !isDiving) {
      stopBrainMeshAnimation();
      setBrainOpacity(0);
      brain.visible = false;
      return stopBrainMeshAnimation;
    }

    if (isDiving) {
      stopBrainMeshAnimation();
      const start = diveStartTimeRef.current ?? performance.now();
      const materialStates = brainMaterials.map((material) => ({
        material,
        baseOpacity: showBrainMesh
          ? Number(material.userData.baseOpacity ?? BRAIN_MESH_BASE_OPACITY)
          : 0,
      }));

      brain.visible = showBrainMesh;

      const animateBrainFade = () => {
        const now = performance.now();
        const progress = Math.min((now - start) / DIVE_ZOOM_IN_DURATION_MS, 1);

        materialStates.forEach(({ material, baseOpacity }) => {
          material.opacity = baseOpacity * (1 - progress);
        });
        brain.visible = materialStates.some(({ material }) => material.opacity > 0.001);

        if (progress < 1) {
          brainMeshAnimationRef.current = requestAnimationFrame(animateBrainFade);
        } else {
          brainMeshAnimationRef.current = null;
        }
      };

      brainMeshAnimationRef.current = requestAnimationFrame(animateBrainFade);
      return stopBrainMeshAnimation;
    }

    const materialStates = brainMaterials.map((material) => ({
      material,
      startOpacity: material.opacity,
      targetOpacity: showBrainMesh
        ? Number(material.userData.baseOpacity ?? BRAIN_MESH_BASE_OPACITY)
        : 0,
    }));
    const hasOpacityChange = materialStates.some(
      ({ startOpacity, targetOpacity }) => Math.abs(startOpacity - targetOpacity) > 0.001,
    );

    stopBrainMeshAnimation();

    if (showBrainMesh) {
      brain.visible = true;
    }

    if (!hasOpacityChange) {
      materialStates.forEach(({ material, targetOpacity }) => {
        material.opacity = targetOpacity;
      });
      brain.visible = showBrainMesh;
      return stopBrainMeshAnimation;
    }

    const startTime = performance.now();

    const animateBrainToggle = () => {
      const now = performance.now();
      const progress = Math.min((now - startTime) / BRAIN_MESH_TOGGLE_FADE_DURATION_MS, 1);

      materialStates.forEach(({ material, startOpacity, targetOpacity }) => {
        material.opacity = startOpacity + (targetOpacity - startOpacity) * progress;
      });
      brain.visible = showBrainMesh || materialStates.some(({ material }) => material.opacity > 0.001);

      if (progress < 1) {
        brainMeshAnimationRef.current = requestAnimationFrame(animateBrainToggle);
      } else {
        brain.visible = showBrainMesh;
        brainMeshAnimationRef.current = null;
      }
    };

    brainMeshAnimationRef.current = requestAnimationFrame(animateBrainToggle);
    return stopBrainMeshAnimation;
  }, [expandedConcept, isDiving, showBrainMesh]);

  useEffect(() => {
    if (!data.nodes.length) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      if (!activeRotationNodeIdRef.current) {
        handleReset();
      }
    }, 150);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [data.nodes.length]);

  useEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    if (typeof ResizeObserver === 'undefined') {
      const nextSize = {
        width: container.clientWidth,
        height: container.clientHeight,
      };
      const previousSize = containerSizeRef.current;

      if (
        nextSize.width > 0 &&
        nextSize.height > 0 &&
        (nextSize.width !== previousSize.width || nextSize.height !== previousSize.height)
      ) {
        containerSizeRef.current = nextSize;
        setViewportSize(nextSize);
        if (!activeRotationNodeIdRef.current) {
          handleReset();
        }
      }

      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      const nextSize = {
        width: entry?.contentRect.width ?? container.clientWidth,
        height: entry?.contentRect.height ?? container.clientHeight,
      };
      const previousSize = containerSizeRef.current;

      if (
        nextSize.width <= 0 ||
        nextSize.height <= 0 ||
        (nextSize.width === previousSize.width && nextSize.height === previousSize.height)
      ) {
        return;
      }

      containerSizeRef.current = nextSize;
      setViewportSize(nextSize);
      if (!activeRotationNodeIdRef.current) {
        handleReset();
      }
    });

    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      // Query cleared — fly back to where the camera was before search started
      if (preSearchCameraRef.current && lastSearchTargetIdRef.current) {
        const { pos, lookAt } = preSearchCameraRef.current;
        animateCamera(pos, lookAt);
      }
      lastSearchTargetIdRef.current = null;
      preSearchCameraRef.current = null;
      return;
    }

    const firstMatchId = findMatchingNodeIds(displayData.nodes, query).values().next().value;
    const firstMatch = displayData.nodes.find((node) => node.id === firstMatchId);

    if (!firstMatch) {
      lastSearchTargetIdRef.current = null;
      return;
    }

    // Skip if already flying to this same node (e.g. "c" → "ca" → "cal" all match "Calculus")
    if (firstMatch.id === lastSearchTargetIdRef.current) {
      return;
    }

    // Save camera position before the first search fly-to
    if (!preSearchCameraRef.current) {
      const cam = graphRef.current?.cameraPosition();
      if (cam) {
        preSearchCameraRef.current = {
          pos: { x: cam.x, y: cam.y, z: cam.z },
          lookAt: { ...lookAtTargetRef.current },
        };
      }
    }

    lastSearchTargetIdRef.current = firstMatch.id;
    smoothFlyToNode(
      {
        x: firstMatch.x ?? 0,
        y: firstMatch.y ?? 0,
        z: firstMatch.z ?? 0,
      },
      140,
    );
  }, [displayData.nodes, query]);

  useEffect(() => {
    let frameId: number;
    let lastTime = performance.now();
    const hasQuery = query.trim().length > 0;
    const animate = () => {
      const time = performance.now();
      const dt = time - lastTime;
      lastTime = time;

      const lerpFactor = 1 - Math.exp(-dt * 0.008);

      // Compute dive fade progress (0 = normal, 1 = fully faded out)
      let diveFade = 0;
      if (diveStartTimeRef.current !== null) {
        const elapsed = time - diveStartTimeRef.current;
        diveFade = Math.min(elapsed / DIVE_ZOOM_IN_DURATION_MS, 1);
      }

      displayData.nodes.forEach((node) => {
        const obj = (node as any).__threeObj as THREE.Object3D | undefined;
        if (!obj) return;

        if (typeof obj.userData.update === 'function') {
          obj.userData.update(time);
        }

        // Dim non-matching nodes during search or assistant-response focus.
        const isSearchDimmed = hasQuery && !matchedNodeIds.has(node.id);
        const isChatSource = chatFocusNodeIds.sourceNodeIds.has(node.id);
        const isChatDiscovery = chatFocusNodeIds.discoveryNodeIds.has(node.id);
        const isChatDimmed = hasChatFocus && !isChatSource && !isChatDiscovery;
        const isExpandHidden = expandedNodeIds !== null && !expandedNodeIds.has(node.id);
        const isHoveredTooltipNode = expandedConcept === null && hoveredNodeId === node.id;
        const isDocExpand = node.id.startsWith('doc-expand:');
        const dimOpacity = isExpandHidden ? 0 : 0.08;
        const isDimmed = isSearchDimmed || isChatDimmed || isExpandHidden;

        const baseColor =
          ((obj.userData.baseColor as THREE.Color | undefined) ?? new THREE.Color(getBaseNodeColor(node)))
            .clone();
        const traversalPulse = Number(obj.userData.traversalPulse ?? 0);
        const traversalRevealed = obj.userData.traversalRevealed === true;
        const traversalIsActive = traversalIsActiveRef.current;

        const normalTargetColor =
          isChatDiscovery || isChatDimmed ? new THREE.Color(DIMMED_SEARCH_COLOR) : baseColor;
        const targetColor =
          traversalIsActive && !traversalRevealed
            ? TRAVERSAL_INACTIVE_COLOR.clone()
            : traversalIsActive && traversalRevealed
              ? TRAVERSAL_INACTIVE_COLOR.clone().lerp(
                normalTargetColor,
                Math.max(0, Math.min(1, traversalPulse)),
              )
              : normalTargetColor;
        const targetEmissive =
          traversalIsActive && !traversalRevealed
            ? new THREE.Color(0x000000)
            : isChatSource
              ? baseColor.clone().multiplyScalar(0.05)
              : new THREE.Color(0x000000);
        targetEmissive.add(baseColor.clone().multiplyScalar(0.95 * traversalPulse));
        targetEmissive.add(TRAVERSAL_OUTLINE_COLOR.clone().multiplyScalar(0.25 * traversalPulse));
        const targetOpacity = Math.min(1, (isDimmed ? dimOpacity : 0.9) + traversalPulse * 0.28);
        const traversalOutlineOpacity =
          traversalIsActive && traversalRevealed && !isExpandHidden
            ? 0.08 + (0.84 * traversalPulse)
            : 0;
        const targetOutlineOpacity = isChatDiscovery && !isExpandHidden
          ? Math.max(0.95, traversalOutlineOpacity)
          : traversalOutlineOpacity;
        const targetSpriteOpacity =
          isExpandHidden || isSearchDimmed || isChatDimmed || isHoveredTooltipNode ? 0 : 1;

        if (obj.userData.currentOpacity === undefined) {
          obj.userData.currentColor = baseColor.clone();
          obj.userData.currentEmissive = baseColor.clone().multiplyScalar(0.15);
          obj.userData.currentOpacity = 0.9;
          obj.userData.currentOutlineOpacity = 0;
          obj.userData.currentSpriteOpacity = 1;
        }

        obj.userData.currentColor.lerp(targetColor, lerpFactor);
        obj.userData.currentEmissive.lerp(targetEmissive, lerpFactor);
        obj.userData.currentOpacity += (targetOpacity - obj.userData.currentOpacity) * lerpFactor;
        obj.userData.currentOutlineOpacity += (targetOutlineOpacity - obj.userData.currentOutlineOpacity) * lerpFactor;
        obj.userData.currentSpriteOpacity += (targetSpriteOpacity - obj.userData.currentSpriteOpacity) * lerpFactor;

        obj.traverse((child) => {
          if (child instanceof THREE.Mesh && child.material) {
            if (child.name === 'node-shape') {
              const mat = child.material as THREE.MeshStandardMaterial;
              const interpolatedOpacity = obj.userData.currentOpacity;
              const finalMeshOpacity =
                diveFade > 0 && !isDocExpand ? interpolatedOpacity * (1 - diveFade) : interpolatedOpacity;

              mat.color.copy(obj.userData.currentColor);
              mat.emissive.copy(obj.userData.currentEmissive);
              mat.opacity = finalMeshOpacity;
              mat.transparent = true;
            }

            if (child.name === 'node-outline') {
              const outlineMat = child.material as THREE.MeshBasicMaterial;
              child.visible = obj.userData.currentOutlineOpacity > 0.01 || targetOutlineOpacity > 0;
              outlineMat.color.copy(
                traversalIsActive && traversalRevealed
                  ? TRAVERSAL_OUTLINE_COLOR.clone().lerp(baseColor, Math.min(traversalPulse, 0.65))
                  : new THREE.Color(DISCOVERY_OUTLINE_COLOR),
              );
              outlineMat.opacity = obj.userData.currentOutlineOpacity;
            }
          }
          if (child instanceof THREE.Sprite && child.material) {
            const interpolatedSpriteOpacity = obj.userData.currentSpriteOpacity;
            const finalSpriteOpacity =
              diveFade > 0 && !isDocExpand ? interpolatedSpriteOpacity * (1 - diveFade) : interpolatedSpriteOpacity;
            child.material.opacity = finalSpriteOpacity;
          }
        });
      });
      frameId = requestAnimationFrame(animate);
    };
    frameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameId);
  }, [chatFocusNodeIds, displayData.nodes, expandedConcept, expandedNodeIds, hasChatFocus, hoveredNodeId, matchedNodeIds, query]);


  useEffect(() => {
    if (!selectedEdge && !hasFocusedRotationPivot && !expandedConcept) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        clearSelectedEdge();
        if (expandedConcept || activeRotationNodeIdRef.current) {
          handleReset();
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [hasFocusedRotationPivot, selectedEdge, expandedConcept]);

  useEffect(() => {
    if (!hoveredNode) {
      setTooltipPosition(null);
      return;
    }

    let frameId = 0;

    const updatePosition = () => {
      const worldPoint = toWorldPoint({
        x: hoveredNode.x ?? 0,
        y: hoveredNode.y ?? 0,
        z: hoveredNode.z ?? 0,
      });
      const coords = graphRef.current?.graph2ScreenCoords(worldPoint.x, worldPoint.y, worldPoint.z);

      if (coords) {
        setTooltipPosition(coords);
      }

      frameId = window.requestAnimationFrame(updatePosition);
    };

    updatePosition();

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [hoveredNode]);

  function getBaseNodeColor(node: GraphNode): string {
    if (node.type === 'Concept') {
      if (node.community_id != null) {
        return communityColor(node.community_id);
      }
      return conceptColorFromScore(node.colorScore);
    }
    return NODE_TYPE_COLORS[node.type];
  }

  function getNodeColor(node: GraphNode): string {
    if (selectedEdge) {
      return selectedNodeIds.has(node.id) ? NODE_TYPE_COLORS[node.type] : DIMMED_NODE_COLOR;
    }

    if (hasChatFocus) {
      return chatFocusNodeIds.sourceNodeIds.has(node.id) ? getBaseNodeColor(node) : DIMMED_SEARCH_COLOR;
    }

    if (hoveredNode) {
      return focusedNodeIds.has(node.id) ? getBaseNodeColor(node) : DIMMED_NODE_COLOR;
    }

    if (query.trim()) {
      return matchedNodeIds.has(node.id) ? getBaseNodeColor(node) : DIMMED_SEARCH_COLOR;
    }

    return getBaseNodeColor(node);
  }

  // Build link context once for all link callbacks
  const linkCtx: LinkContext = {
    hoveredNode,
    selectedEdge,
    focusedEdgeNodeId,
    expandedNodeIds,
    hasChatFocus,
    chatFocusHighlightedNodeIds: chatFocusNodeIds.highlightedNodeIds,
  };

  function getLinkColor(link: GraphLink): string {
    return computeLinkColor(link, linkCtx);
  }

  function getLinkWidth(link: GraphLink): number {
    return computeLinkWidth(link, expandedNodeIds);
  }

  // Stable callback refs so ForceGraph3D doesn't see new function identity on every render
  const handleNodeClickRef = useRef(handleNodeClick);
  handleNodeClickRef.current = handleNodeClick;
  const handleLinkClickRef = useRef(handleLinkClick);
  handleLinkClickRef.current = handleLinkClick;
  const onHoverNodeRef = useRef(onHoverNode);
  onHoverNodeRef.current = onHoverNode;
  const clampNodesWithinBrainRef = useRef(clampNodesWithinBrain);
  clampNodesWithinBrainRef.current = clampNodesWithinBrain;

  const onNodeClick = useCallback((node: object) => {
    if (suppressNextForceGraphClickRef.current) {
      suppressNextForceGraphClickRef.current = false;
      return;
    }
    handleNodeClickRef.current(node as GraphNode);
  }, []);
  const onLinkClick = useCallback((link: object) => void handleLinkClickRef.current(link as GraphLink), []);

  const onNodeHover = useCallback((node: object | null) => onHoverNodeRef.current((node as GraphNode | null) ?? null), []);
  const onEngineTick = useCallback(() => {
    // If simulation already settled, immediately re-pin nodes to prevent jiggle on reheat
    if (simulationSettledRef.current) {
      const pins = pinnedPositionsRef.current;
      displayDataRef.current.nodes.forEach((node) => {
        const pin = pins.get(node.id);
        if (pin) {
          node.x = pin.x;
          node.y = pin.y;
          node.z = pin.z;
          node.fx = pin.x;
          node.fy = pin.y;
          node.fz = pin.z;
        }
      });
      return;
    }
    clampNodesWithinBrainRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const onEngineStop = useCallback(() => {
    // Pin all nodes so the simulation never moves them again
    const pins = pinnedPositionsRef.current;
    displayDataRef.current.nodes.forEach((node) => {
      node.fx = node.x;
      node.fy = node.y;
      node.fz = node.z;
      pins.set(node.id, { x: node.x ?? 0, y: node.y ?? 0, z: node.z ?? 0 });
    });
    simulationSettledRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const dashedLinkProps = {
    linkLineDash: getLinkLineDash,
  } as any;

  return (
    <div
      ref={containerRef}
      data-testid="graph-shell"
      data-background-hex={DEFAULT_BACKGROUND_HEX}
      data-brain-mesh-hex={DEFAULT_BRAIN_MESH_HEX}
      className="relative h-full min-h-[26rem] overflow-hidden rounded-[2rem] border border-white/10 lg:min-h-0"
      style={{ backgroundColor: DEFAULT_BACKGROUND_HEX }}
      onContextMenu={(event) => event.preventDefault()}
      onDoubleClick={(event) => {
        if (
          event.target instanceof HTMLElement &&
          event.target.closest('button')
        ) {
          return;
        }

        if (Date.now() <= suppressBackgroundDoubleClickUntilRef.current) {
          return;
        }

        if (activeRotationNodeIdRef.current) {
          handleReset();
        }
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          clearSelectedEdge();
          setRotationPivotNode(null);
          setLatentLinks([]);
          setExpandedConcept(null);
        }
      }}
      onMouseMove={handleMouseMove}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseEnd}
      onMouseLeave={handleMouseEnd}
      onWheel={handleWheel}
      onTouchStart={handleInteraction}
    >
      <ForceGraph3D
        ref={graphRef as never}
        {...dashedLinkProps}
        graphData={displayData}
        width={viewportSize.width || undefined}
        height={viewportSize.height || undefined}
        backgroundColor="rgba(0,0,0,0)"
        nodeColor={getNodeColor}
        nodeLabel={() => null}
        nodeVal={() => 4}
        nodeThreeObject={getNodeThreeObject as (node: object) => THREE.Object3D}
        nodeThreeObjectExtend={false}
        linkColor={getLinkColor}
        linkLineDash={getLinkLineDash}
        linkWidth={getLinkWidth}
        linkHoverPrecision={10}
        linkOpacity={0.55}
        nodeRelSize={5}
        linkDirectionalParticles={0}
        warmupTicks={0}
        cooldownTicks={200}
        d3AlphaDecay={0.06}
        d3VelocityDecay={0.4}
        onEngineTick={onEngineTick}
        onEngineStop={onEngineStop}
        onLinkClick={onLinkClick}
        onNodeClick={onNodeClick}
        onNodeHover={onNodeHover}
        onBackgroundClick={() => {
          if (suppressNextForceGraphClickRef.current) {
            suppressNextForceGraphClickRef.current = false;
            return;
          }
          if (Date.now() <= suppressBackgroundDoubleClickUntilRef.current) return;
          clearSelectedEdge();
          setRotationPivotNode(null);
          setLatentLinks([]);
          setExpandedConcept(null);
        }}
        enableNodeDrag={false}
        enableNavigationControls={false}
        controlType="orbit"
      />
      {expandedConcept ? (
        <div className="absolute left-6 top-6 z-10 max-w-[14rem] rounded-xl border border-white/[0.08] bg-neutral-900 px-4 py-3 text-left transition-all duration-300 animate-in fade-in slide-in-from-left-4">
          <div className="mb-1.5 border-b border-white/[0.06] pb-1">
            <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-neutral-500">
              Document View
            </p>
          </div>
          <h2 className="text-base font-semibold tracking-tight text-white mb-1">
            {expandedConcept.node.name}
          </h2>
          <p className="text-[10px] leading-relaxed text-neutral-400">
            Double click a document node to open it.
          </p>
          <div className="mt-3 flex items-center justify-between border-t border-white/[0.06] pt-2.5">
            <span className="text-[8px] font-medium text-neutral-500 uppercase tracking-widest">Documents</span>
            <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[9px] font-bold text-neutral-300">
              {expandedConcept.docs.length}
            </span>
          </div>
        </div>
      ) : null}

      {emptyConceptName ? (
        <div className="absolute left-1/2 top-8 z-20 -translate-x-1/2 border border-white/[0.08] bg-neutral-900 px-5 py-3 text-center">
          <p className="text-sm font-medium text-neutral-200">
            No documents for <span className="text-pink-400">{emptyConceptName}</span>
          </p>
          <p className="mt-1 text-[11px] text-neutral-500">
            Ingest notes that mention this concept to populate it.
          </p>
        </div>
      ) : null}

      <div className="absolute right-4 top-4 z-10 flex flex-col items-end gap-2">
        <button
          type="button"
          onClick={handleZoomIn}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-800/80 text-xl font-semibold text-slate-100 transition hover:bg-slate-700/90"
        >
          +
        </button>
        <button
          type="button"
          onClick={handleZoomOut}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-800/80 text-xl font-semibold text-slate-100 transition hover:bg-slate-700/90"
        >
          −
        </button>
        <button
          type="button"
          onClick={handleReset}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-800/80 text-xl font-semibold text-slate-100 transition hover:bg-slate-700/90"
        >
          ⟳
        </button>
        <button
          type="button"
          aria-label={showBrainMesh ? 'Hide brain mesh' : 'Show brain mesh'}
          onClick={() => setShowBrainMesh((current) => !current)}
          className={`flex h-11 w-11 items-center justify-center rounded-full text-[0.65rem] font-semibold uppercase tracking-[0.18em] transition ${showBrainMesh
            ? 'bg-slate-800/80 text-slate-100 hover:bg-slate-700/90'
            : 'bg-slate-900/60 text-slate-400 hover:bg-slate-800/80 hover:text-slate-200'
            }`}
        >
          BM
        </button>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center bg-[linear-gradient(180deg,rgba(14,15,16,0)_0%,rgba(14,15,16,0.92)_30%,rgba(14,15,16,1)_100%)] px-6 pb-4 pt-8">
        <div
          data-testid="graph-stats-footer"
          className="max-w-full truncate text-center text-[10px] font-medium uppercase tracking-widest text-neutral-500"
        >
          {graphStatsSummary}
        </div>
      </div>
      {hoveredNode && tooltipPosition && !expandedConcept ? (
        <NodeTooltip
          node={hoveredNode}
          connectionCount={getConnectionCount(hoveredNode.id, adjacency)}
          x={tooltipPosition.x}
          y={tooltipPosition.y}
        />
      ) : null}

      {selectedEdge ? (
        <EdgeDetailPanel
          relationship={relationshipDetails}
          isLoading={isRelationshipLoading}
          error={relationshipError}
          onClose={clearSelectedEdge}
        />
      ) : null}
    </div>
  );
}
