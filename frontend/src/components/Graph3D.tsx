import { useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph3D from 'react-force-graph-3d';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import {
  ACTIVE_LINK_COLOR,
  DIMMED_LINK_COLOR,
  DIMMED_NODE_COLOR,
  DIMMED_SEARCH_COLOR,
  NODE_TYPE_COLORS,
  buildAdjacencyMap,
  centerCameraOnTarget,
  createFocusSet,
  findMatchingNodeIds,
  getConnectionCount,
  isDirectHoverLink,
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
import {
  getMockDocumentsForConcept,
  mockRelationshipDetailsByEdge,
} from '../mock/mockGraph';
import type {
  GraphData,
  GraphLink,
  GraphNode,
  GraphSource,
  RelationshipDetails,
} from '../types/graph';
import { EdgeDetailPanel } from './EdgeDetailPanel';
import { NodeTooltip } from './NodeTooltip';

interface OrbitControlsLike {
  autoRotate: boolean;
  autoRotateSpeed: number;
  addEventListener: (event: string, callback: () => void) => void;
  removeEventListener: (event: string, callback: () => void) => void;
  target: {
    set: (x: number, y: number, z: number) => void;
  };
  update: () => void;
}

interface ForceGraphHandle {
  controls: () => OrbitControlsLike;
  cameraPosition(): { x: number; y: number; z: number };
  cameraPosition(
    position: { x: number; y: number; z: number },
    lookAt?: { x: number; y: number; z: number },
    durationMs?: number,
  ): void;
  graph2ScreenCoords: (
    x: number,
    y: number,
    z: number,
  ) => { x: number; y: number };
  scene: () => THREE.Scene;
  zoomToFit: (durationMs?: number, padding?: number) => void;
  getGraphBbox: () => {
    x: [number, number];
    y: [number, number];
    z: [number, number];
  };
  refresh: () => void;
}

interface TooltipPosition {
  x: number;
  y: number;
}

interface BrainHomeView {
  distance: number;
  focusPoint: {
    x: number;
    y: number;
    z: number;
  };
}

interface Graph3DProps {
  data: GraphData;
  source: GraphSource;
  query: string;
  hoveredNode: GraphNode | null;
  onHoverNode: (node: GraphNode | null) => void;
}

interface SelectedRelationshipEdge {
  sourceId: string;
  targetId: string;
  reason: string;
}

const BRAIN_MODEL_URL = '/assets/human-brain.glb';
const CAMERA_MOVE_DURATION_MS = 1200;
const AUTO_CENTER_PADDING = 120;
const IDLE_ROTATE_DELAY_MS = 5000;
const IDLE_ROTATE_INTERVAL_MS = 16;
const BUTTON_ZOOM_IN_FACTOR = 0.84;
const BUTTON_ZOOM_OUT_FACTOR = 1.2;
const DOUBLE_CLICK_THRESHOLD_MS = 300;
const BRAIN_HOME_VIEW_DISTANCE_MULTIPLIER = 2.6;
const MIN_BRAIN_HOME_VIEW_DISTANCE = 240;
const POINTER_ROTATION_SPEED = 0.005;
const IDLE_ROTATION_SPEED = 0.002;
const MAX_SCENE_TILT = Math.PI / 3;
const CONTAINER_SPHERE_RADIUS = 22;
const DOC_ORBIT_RADIUS = 15;

export function Graph3D({
  data,
  source: graphSource,
  query,
  hoveredNode,
  onHoverNode,
}: Graph3DProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<ForceGraphHandle | null>(null);
  const brainContainmentRef = useRef<BrainContainment | null>(null);
  const brainHomeViewRef = useRef<BrainHomeView | null>(null);
  const idleTimeoutRef = useRef<number | null>(null);
  const idleRotationIntervalRef = useRef<number | null>(null);
  const lastNodeClickRef = useRef<{ nodeId: string; timestamp: number } | null>(null);
  const lookAtTargetRef = useRef({ x: 0, y: 0, z: 0 });
  const sceneFocusPointRef = useRef({ x: 0, y: 0, z: 0 });
  const isRightDragRotatingRef = useRef(false);
  const lastDragPositionRef = useRef({ x: 0, y: 0 });
  const containerSizeRef = useRef({ width: 0, height: 0 });
  const expandedConceptIdRef = useRef<string | null>(null);

  const [expandedConceptId, setExpandedConceptId] = useState<string | null>(null);
  const [injectedNodes, setInjectedNodes] = useState<GraphNode[]>([]);
  const [injectedLinks, setInjectedLinks] = useState<GraphLink[]>([]);
  const [tooltipPosition, setTooltipPosition] = useState<TooltipPosition | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [selectedEdge, setSelectedEdge] = useState<SelectedRelationshipEdge | null>(null);
  const [relationshipDetails, setRelationshipDetails] = useState<RelationshipDetails | null>(null);
  const [relationshipError, setRelationshipError] = useState<string | null>(null);
  const [isRelationshipLoading, setIsRelationshipLoading] = useState(false);

  const displayData = useMemo(
    () =>
      injectedNodes.length === 0
        ? data
        : {
            nodes: [...data.nodes, ...injectedNodes],
            links: [...data.links, ...injectedLinks],
          },
    [data, injectedLinks, injectedNodes],
  );

  const adjacency = buildAdjacencyMap(displayData);
  const matchedNodeIds = findMatchingNodeIds(displayData.nodes, query);
  const focusedNodeIds = createFocusSet(hoveredNode, adjacency);
  const selectedNodeIds = selectedEdge
    ? new Set([selectedEdge.sourceId, selectedEdge.targetId])
    : new Set<string>();

  function getConceptName(nodeId: string): string | null {
    if (!nodeId.startsWith('concept:')) {
      return null;
    }

    return nodeId.slice('concept:'.length);
  }

  function isSelectedLink(link: GraphLink): boolean {
    if (!selectedEdge) {
      return false;
    }

    const source = typeof link.source === 'string' ? link.source : link.source.id;
    const target = typeof link.target === 'string' ? link.target : link.target.id;

    return source === selectedEdge.sourceId && target === selectedEdge.targetId;
  }

  function clearSelectedEdge() {
    setSelectedEdge(null);
    setRelationshipDetails(null);
    setRelationshipError(null);
    setIsRelationshipLoading(false);
  }

  function getNodeThreeObject(node: GraphNode): THREE.Object3D | null {
    if (node.id !== expandedConceptId) {
      return null;
    }

    const color = new THREE.Color(NODE_TYPE_COLORS[node.type]);
    const group = new THREE.Group();

    group.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(CONTAINER_SPHERE_RADIUS, 20, 20),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.06,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      ),
    );

    group.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(CONTAINER_SPHERE_RADIUS, 10, 10),
        new THREE.MeshBasicMaterial({
          color,
          wireframe: true,
          transparent: true,
          opacity: 0.28,
        }),
      ),
    );

    return group;
  }

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

    keepLocalPointAtWorldOrigin(rotationRoot, sceneFocusPointRef.current);
    rotationRoot.updateMatrixWorld(true);
    lookAtTargetRef.current = { x: 0, y: 0, z: 0 };
  }

  function focusPoint(point: { x: number; y: number; z: number }, distance: number) {
    sceneFocusPointRef.current = point;
    applySceneFocusPoint();
    centerCameraOnTarget(
      graphRef,
      lookAtTargetRef.current,
      distance,
      CAMERA_MOVE_DURATION_MS,
    );
  }

  function stopIdleRotation() {
    if (idleRotationIntervalRef.current !== null) {
      window.clearInterval(idleRotationIntervalRef.current);
      idleRotationIntervalRef.current = null;
    }
  }

  function scheduleIdleRotation() {
    if (idleTimeoutRef.current !== null) {
      window.clearTimeout(idleTimeoutRef.current);
    }

    idleTimeoutRef.current = window.setTimeout(() => {
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
    }, IDLE_ROTATE_DELAY_MS);
  }

  function handleInteraction() {
    stopIdleRotation();
    scheduleIdleRotation();
  }

  function handleReset() {
    const brainHomeView = brainHomeViewRef.current;

    if (brainHomeView) {
      resetSceneTransform();
      sceneFocusPointRef.current = brainHomeView.focusPoint;
      applySceneFocusPoint();
      centerCameraOnTarget(
        graphRef,
        lookAtTargetRef.current,
        brainHomeView.distance,
        CAMERA_MOVE_DURATION_MS,
      );
      return;
    }

    resetSceneTransform();
    sceneFocusPointRef.current = { x: 0, y: 0, z: 0 };
    lookAtTargetRef.current = getGraphCenter();
    graphRef.current?.zoomToFit(CAMERA_MOVE_DURATION_MS, AUTO_CENTER_PADDING);
  }

  function handleMouseDown(event: React.MouseEvent<HTMLDivElement>) {
    if (event.button !== 2) {
      return;
    }

    if (event.target instanceof HTMLElement && event.target.closest('button')) {
      return;
    }

    isRightDragRotatingRef.current = true;
    lastDragPositionRef.current = {
      x: event.clientX,
      y: event.clientY,
    };
    handleInteraction();
    event.preventDefault();
  }

  function handleMouseMove(event: React.MouseEvent<HTMLDivElement>) {
    handleInteraction();

    if (!isRightDragRotatingRef.current) {
      return;
    }

    if ((event.buttons & 2) !== 2) {
      isRightDragRotatingRef.current = false;
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
    isRightDragRotatingRef.current = false;
  }

  function handleZoom(scale: number) {
    const currentPosition = graphRef.current?.cameraPosition();

    if (!currentPosition) {
      return;
    }

    const lookAt = lookAtTargetRef.current;

    graphRef.current?.cameraPosition(
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

  async function handleConceptExpansion(node: GraphNode) {
    const conceptNodeId = node.id;
    const conceptPos = { x: node.x ?? 0, y: node.y ?? 0, z: node.z ?? 0 };

    if (expandedConceptIdRef.current === conceptNodeId) {
      expandedConceptIdRef.current = null;
      setExpandedConceptId(null);
      setInjectedNodes([]);
      setInjectedLinks([]);
      return;
    }

    expandedConceptIdRef.current = conceptNodeId;
    setExpandedConceptId(conceptNodeId);
    setInjectedNodes([]);
    setInjectedLinks([]);

    let docs: Array<{ doc_id: string; name: string; full_text: string }> = [];

    try {
      const response = await fetch(`/api/concepts/${encodeURIComponent(node.name)}/documents`);
      if (response.ok) {
        docs = (await response.json()) as typeof docs;
      }
    } catch {
      // Fall back to bundled mock data when the backend is unavailable.
    }

    if (docs.length === 0) {
      docs = getMockDocumentsForConcept(node.name);
    }

    if (expandedConceptIdRef.current !== conceptNodeId) {
      return;
    }

    const count = docs.length;
    setInjectedNodes(
      docs.map((doc, index) => {
        const theta = (2 * Math.PI * index) / count;
        const phi = Math.PI * (0.35 + 0.3 * (index % 2 === 0 ? 1 : -1));
        return {
          id: `doc:${doc.doc_id}`,
          type: 'Document' as const,
          name: doc.name,
          fx: conceptPos.x + DOC_ORBIT_RADIUS * Math.sin(phi) * Math.cos(theta),
          fy: conceptPos.y + DOC_ORBIT_RADIUS * Math.cos(phi),
          fz: conceptPos.z + DOC_ORBIT_RADIUS * Math.sin(phi) * Math.sin(theta),
        };
      }),
    );
    setInjectedLinks(
      docs.map((doc) => ({
        source: conceptNodeId,
        target: `doc:${doc.doc_id}`,
        type: 'MENTIONS',
      })),
    );
  }

  function handleNodeClick(node: GraphNode) {
    if (node.type === 'Document') {
      return;
    }

    const now = Date.now();

    if (
      lastNodeClickRef.current &&
      lastNodeClickRef.current.nodeId === node.id &&
      now - lastNodeClickRef.current.timestamp <= DOUBLE_CLICK_THRESHOLD_MS
    ) {
      focusPoint(
        {
          x: node.x ?? 0,
          y: node.y ?? 0,
          z: node.z ?? 0,
        },
        100,
      );
      lastNodeClickRef.current = null;
      return;
    }

    lastNodeClickRef.current = { nodeId: node.id, timestamp: now };
    focusPoint(
      {
        x: node.x ?? 0,
        y: node.y ?? 0,
        z: node.z ?? 0,
      },
      160,
    );
    void handleConceptExpansion(node);
  }

  async function handleLinkClick(link: GraphLink) {
    if (link.type !== 'RELATED_TO') {
      return;
    }

    const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
    const targetId = typeof link.target === 'string' ? link.target : link.target.id;
    const sourceConcept = getConceptName(sourceId);
    const targetConcept = getConceptName(targetId);

    if (!sourceConcept || !targetConcept) {
      return;
    }

    const mockDetailsKey = `${sourceId}->${targetId}`;
    const mockDetails = mockRelationshipDetailsByEdge[mockDetailsKey];

    setSelectedEdge({
      sourceId,
      targetId,
      reason: link.reason ?? '',
    });
    setRelationshipDetails({
      source: sourceConcept,
      target: targetConcept,
      type: 'RELATED_TO',
      reason: link.reason ?? 'Related concepts',
      source_documents: [],
      target_documents: [],
      shared_document_ids: [],
    });
    setRelationshipError(null);
    setIsRelationshipLoading(true);

    if (graphSource === 'mock') {
      setRelationshipDetails(
        mockDetails ?? {
          source: sourceConcept,
          target: targetConcept,
          type: 'RELATED_TO',
          reason: link.reason ?? 'Related concepts',
          source_documents: [],
          target_documents: [],
          shared_document_ids: [],
        },
      );
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
    scheduleIdleRotation();

    return () => {
      if (idleTimeoutRef.current !== null) {
        window.clearTimeout(idleTimeoutRef.current);
        idleTimeoutRef.current = null;
      }

      stopIdleRotation();
    };
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

      const centeredBrain = centerObject3DAtOrigin(gltf.scene, 260);
      brainGroup = centeredBrain.pivot;

      brainGroup.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          node.material = new THREE.MeshBasicMaterial({
            color: '#7dd3fc',
            wireframe: true,
            transparent: true,
            opacity: 0.12,
            side: THREE.DoubleSide,
          });
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
      clampNodesWithinBrain(true);
      scene.add(brainGroup);
      handleReset();
    });

    return () => {
      cancelled = true;
      brainContainmentRef.current = null;
      brainHomeViewRef.current = null;

      if (brainGroup) {
        scene.remove(brainGroup);
      }
    };
  }, []);

  useEffect(() => {
    clampNodesWithinBrain(true);
  }, [displayData.nodes]);

  useEffect(() => {
    if (!data.nodes.length) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      handleReset();
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
        handleReset();
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
      handleReset();
    });

    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      return;
    }

    const firstMatchId = findMatchingNodeIds(displayData.nodes, query).values().next().value;
    const firstMatch = displayData.nodes.find((node) => node.id === firstMatchId);

    if (!firstMatch) {
      return;
    }

    focusPoint(
      {
        x: firstMatch.x ?? 0,
        y: firstMatch.y ?? 0,
        z: firstMatch.z ?? 0,
      },
      140,
    );
  }, [displayData.nodes, query]);

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

  function getNodeColor(node: GraphNode): string {
    if (selectedEdge) {
      return selectedNodeIds.has(node.id) ? NODE_TYPE_COLORS[node.type] : DIMMED_NODE_COLOR;
    }

    if (hoveredNode) {
      return focusedNodeIds.has(node.id) ? NODE_TYPE_COLORS[node.type] : DIMMED_NODE_COLOR;
    }

    if (query.trim()) {
      return matchedNodeIds.has(node.id) ? NODE_TYPE_COLORS[node.type] : DIMMED_SEARCH_COLOR;
    }

    return NODE_TYPE_COLORS[node.type];
  }

  function getLinkColor(link: GraphLink): string {
    if (isSelectedLink(link)) {
      return ACTIVE_LINK_COLOR;
    }

    if (hoveredNode) {
      return isDirectHoverLink(link, hoveredNode) ? ACTIVE_LINK_COLOR : DIMMED_LINK_COLOR;
    }

    return 'rgba(56, 189, 248, 0.24)';
  }

  function getLinkWidth(link: GraphLink): number {
    if (isSelectedLink(link)) {
      return 3.2;
    }

    return isDirectHoverLink(link, hoveredNode) ? 2.8 : 0.7;
  }

  return (
    <div
      ref={containerRef}
      className="relative h-full min-h-[26rem] overflow-hidden rounded-[2rem] border border-white/10 bg-slate-950/70 shadow-[0_0_80px_rgba(8,47,73,0.45)] lg:min-h-0"
      onContextMenu={(event) => event.preventDefault()}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          clearSelectedEdge();
        }
      }}
      onMouseMove={handleMouseMove}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseEnd}
      onMouseLeave={handleMouseEnd}
      onWheel={handleInteraction}
      onTouchStart={handleInteraction}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.18),_transparent_38%),radial-gradient(circle_at_bottom_left,_rgba(168,85,247,0.14),_transparent_35%)]" />
      <ForceGraph3D
        ref={graphRef as never}
        graphData={displayData}
        width={viewportSize.width || undefined}
        height={viewportSize.height || undefined}
        backgroundColor="rgba(0,0,0,0)"
        nodeColor={getNodeColor}
        nodeVal={(node) => {
          const candidate = node as GraphNode;
          return candidate.fx !== undefined ? 0.5 : 1;
        }}
        nodeThreeObject={(node) => getNodeThreeObject(node as GraphNode) as THREE.Object3D}
        nodeThreeObjectExtend={false}
        linkColor={getLinkColor}
        linkWidth={getLinkWidth}
        linkHoverPrecision={10}
        linkOpacity={0.7}
        nodeRelSize={5}
        linkDirectionalParticles={hoveredNode ? 2 : 0}
        linkDirectionalParticleWidth={2}
        cooldownTicks={120}
        d3AlphaDecay={0.02}
        d3VelocityDecay={0.15}
        onEngineTick={() => clampNodesWithinBrain()}
        onLinkClick={(link) => void handleLinkClick(link as GraphLink)}
        onNodeClick={(node) => handleNodeClick(node as GraphNode)}
        onNodeHover={(node) => onHoverNode((node as GraphNode | null) ?? null)}
        enableNodeDrag={false}
        enableNavigationControls={false}
        controlType="orbit"
      />
      <div className="absolute right-4 top-4 flex flex-col gap-2">
        <button
          type="button"
          onClick={handleZoomIn}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-800/80 text-xl font-semibold text-slate-100 shadow-lg shadow-slate-950/30 transition hover:bg-slate-700/90"
        >
          +
        </button>
        <button
          type="button"
          onClick={handleZoomOut}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-800/80 text-xl font-semibold text-slate-100 shadow-lg shadow-slate-950/30 transition hover:bg-slate-700/90"
        >
          −
        </button>
        <button
          type="button"
          onClick={handleReset}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-800/80 text-xl font-semibold text-slate-100 shadow-lg shadow-slate-950/30 transition hover:bg-slate-700/90"
        >
          ⟳
        </button>
      </div>
      {hoveredNode && tooltipPosition ? (
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
