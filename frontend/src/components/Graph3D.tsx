import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  conceptColorFromScore,
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
  DiscoveryResponse,
  RelationshipDocument,
  RelationshipDetails,
} from '../types/graph';
import { ConceptDocumentOverlay } from './ConceptDocumentOverlay';
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

interface FixedNodeAnchor {
  x: number;
  y: number;
  z: number;
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
  hoveredNode?: GraphNode | null;
  onHoverNode?: (node: GraphNode | null) => void;
}

interface SelectedRelationshipEdge {
  sourceId: string;
  targetId: string;
  reason: string;
}

const BRAIN_MODEL_URL = '/assets/human-brain.glb';
const NEURON_MODEL_URL = '/assets/neuron-spinous-stellate-cell.glb';
const CAMERA_MOVE_DURATION_MS = 1200;
const AUTO_CENTER_PADDING = 120;
const IDLE_ROTATE_DELAY_MS = 5000;
const IDLE_ROTATE_INTERVAL_MS = 16;
const BUTTON_ZOOM_IN_FACTOR = 0.84;
const BUTTON_ZOOM_OUT_FACTOR = 1.2;
const WHEEL_ZOOM_IN_FACTOR = 0.9;
const WHEEL_ZOOM_OUT_FACTOR = 1.2;
const DOUBLE_CLICK_THRESHOLD_MS = 300;
const BRAIN_HOME_VIEW_DISTANCE_MULTIPLIER = 2.6;
const MIN_BRAIN_HOME_VIEW_DISTANCE = 240;
const POINTER_ROTATION_SPEED = 0.005;
const IDLE_ROTATION_SPEED = 0.002;
const MAX_SCENE_TILT = Math.PI / 3;
const GHOST_EDGE_COLOR = 'rgba(168, 85, 247, 0.45)';
const BASE_LINK_COLOR = 'rgba(186, 224, 255, 0.52)';
const GHOST_EDGE_WIDTH = 0.8;
const ESTABLISHED_LINK_WIDTH_MULTIPLIER = 3.5;
const BRAIN_MODEL_TARGET_DIAGONAL = 325;
const NEURON_MODEL_TARGET_DIAGONAL = 26;
const NODE_LABEL_Y_OFFSET = 16;
const NODE_LAYOUT_ANCHORS: ReadonlyArray<FixedNodeAnchor> = [
  { x: 0, y: 30.9, z: 0 },
  { x: -39.9, y: 8.5, z: -31.6 },
  { x: 4.5, y: -20.5, z: 44.1 },
  { x: 27.4, y: 29.1, z: -30.9 },
  { x: -65.6, y: -2.4, z: 10 },
  { x: 33.5, y: -36.5, z: 18.4 },
  { x: -16.9, y: 19.2, z: -54.2 },
  { x: -31.7, y: -16.4, z: 52.8 },
  { x: 32.4, y: 43.1, z: -10.2 },
  { x: -70.5, y: 6.2, z: -25.2 },
  { x: 25.6, y: -32.3, z: 47.2 },
  { x: 19.2, y: 30.7, z: -52.9 },
  { x: -69.4, y: -8.8, z: 34.8 },
  { x: 29.4, y: -49.6, z: 5.6 },
  { x: -46, y: 16.5, z: -56.5 },
  { x: -9.7, y: -25.2, z: 64.8 },
  { x: 41.5, y: 43.2, z: -30.2 },
  { x: -87.3, y: 0.7, z: -3.1 },
  { x: 41.4, y: -42.8, z: 35.6 },
  { x: -3.6, y: 28, z: -67.5 },
  { x: -55.6, y: -16.2, z: 57.6 },
  { x: 26.1, y: 56.4, z: -3 },
  { x: -74.3, y: 11.5, z: -44.7 },
  { x: 16.8, y: -34.2, z: 64.6 },
  { x: 34.9, y: 40.3, z: -52.7 },
  { x: -90, y: -6, z: 24.8 },
  { x: 44, y: -53.2, z: 17.6 },
  { x: -34.6, y: 23.3, z: -71.4 },
  { x: -30.3, y: -24.5, z: 72.9 },
  { x: 46.3, y: 53.5, z: -21 },
  { x: -95.3, y: 5.2, z: -21.7 },
  { x: 39.4, y: -43.8, z: 53 },
  { x: 14.1, y: 35.8, z: -71.2 },
  { x: -78.1, y: -13.7, z: 52.3 },
  { x: 23.1, y: -63.8, z: 1.7 },
  { x: -67.1, y: 17.3, z: -62.7 },
  { x: 0.4, y: -33.3, z: 77.1 },
  { x: 47.3, y: 49.1, z: -45.1 },
  { x: -103.9, y: -2, z: 8.3 },
  { x: 50.9, y: -53.7, z: 33.4 },
  { x: -17, y: 30.1, z: -80.6 },
  { x: -53.6, y: -22, z: 73.6 },
  { x: 41.6, y: 63, z: -9.9 },
  { x: -94.5, y: 10.4, z: -41.9 },
  { x: 29.7, y: -42.7, z: 69.2 },
  { x: 32, y: 43.6, z: -68 },
  { x: -97.7, y: -9.9, z: 40 },
  { x: 44.7, y: -64, z: 11.9 },
  { x: -52.6, y: 23.5, z: -77.6 },
  { x: -21, y: -30.9, z: 84.4 },
  { x: 54.1, y: 57.6, z: -33.2 },
  { x: -111, y: 2.8, z: -12 },
  { x: 50.2, y: -52.5, z: 51 },
  { x: 3.5, y: 37.2, z: -83.8 },
  { x: -77.1, y: -18.4, z: 67.6 },
  { x: 20.4, y: 72.2, z: -0.9 },
  { x: -86.1, y: 16.2, z: -61.5 },
  { x: 13.3, y: -40.3, z: 82.6 },
  { x: 47.3, y: 51.4, z: -59.3 },
  { x: -112.7, y: -5.4, z: 22.4 },
  { x: 55.6, y: -62.7, z: 27.2 },
  { x: -33, y: 30.1, z: -88 },
  { x: -45.3, y: -27.5, z: 85.9 },
  { x: 53, y: 66.2, z: -19.4 },
];

function getDeterministicNodeColorScore(node: GraphNode): number {
  if (node.colorScore !== undefined) {
    return node.colorScore;
  }

  return (
    String(node.id).split('').reduce((acc, char) => {
      return (acc * 31 + char.charCodeAt(0)) % 10000;
    }, 0) / 10000
  );
}

function getVisualNodeColor(node: GraphNode): THREE.Color {
  return new THREE.Color(0xff4444).lerp(
    new THREE.Color(0x4444ff),
    getDeterministicNodeColorScore(node),
  );
}

function createOverflowAnchor(index: number): FixedNodeAnchor {
  const angle = index * 2.399963229728653;
  const radius = 88 + (index % 9) * 4;
  const height = ((index % 7) - 3) * 12;

  return {
    x: Math.cos(angle) * radius,
    y: height,
    z: Math.sin(angle) * radius * 0.82,
  };
}

function createTextSprite(text: string, color: string = '#ffffff'): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  let ctx: CanvasRenderingContext2D | null = null;

  try {
    ctx = canvas.getContext('2d');
  } catch {
    ctx = null;
  }

  if (ctx) {
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = 'rgba(15, 23, 42, 0.6)';
    ctx.beginPath();
    ctx.roundRect(0, 0, canvas.width, canvas.height, 64);
    ctx.fill();

    ctx.font = 'bold 52px "Inter", "Roboto", sans-serif';
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(16, 4, 1);
  sprite.renderOrder = 999;
  return sprite;
}

function createColoredNeuronMaterial(nodeColor: THREE.Color): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: nodeColor,
    emissive: nodeColor.clone().multiplyScalar(0.08),
    roughness: 0.38,
    metalness: 0.08,
    clearcoat: 0.22,
    transmission: 0.12,
    transparent: true,
    opacity: 0.92,
    side: THREE.DoubleSide,
  });
}

export function Graph3D({
  data,
  source: graphSource,
  query,
  hoveredNode: hoveredNodeProp,
  onHoverNode: onHoverNodeProp,
}: Graph3DProps) {
  const [internalHoveredNode, setInternalHoveredNode] = useState<GraphNode | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const hoveredNode = hoveredNodeProp ?? internalHoveredNode;
  const onHoverNode = onHoverNodeProp ?? setInternalHoveredNode;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<ForceGraphHandle | null>(null);
  const brainContainmentRef = useRef<BrainContainment | null>(null);
  const brainHomeViewRef = useRef<BrainHomeView | null>(null);
  const idleTimeoutRef = useRef<number | null>(null);
  const idleRotationIntervalRef = useRef<number | null>(null);
  const lastNodeClickRef = useRef<{ nodeId: string; timestamp: number } | null>(null);
  const activeRotationNodeIdRef = useRef<string | null>(null);
  const suppressBackgroundDoubleClickUntilRef = useRef(0);
  const lookAtTargetRef = useRef({ x: 0, y: 0, z: 0 });
  const sceneFocusPointRef = useRef({ x: 0, y: 0, z: 0 });
  const isRightDragRotatingRef = useRef(false);
  const lastDragPositionRef = useRef({ x: 0, y: 0 });
  const containerSizeRef = useRef({ width: 0, height: 0 });
  const expandedConceptIdRef = useRef<string | null>(null);
  const cameraAnimationRef = useRef<number | null>(null);
  const lastSearchTargetIdRef = useRef<string | null>(null);
  const fixedNodeAnchorsRef = useRef<Map<string, FixedNodeAnchor>>(new Map());

  const [expandedConcept, setExpandedConcept] = useState<GraphNode | null>(null);
  const [expandedDocs, setExpandedDocs] = useState<RelationshipDocument[] | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState<TooltipPosition | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [selectedEdge, setSelectedEdge] = useState<SelectedRelationshipEdge | null>(null);
  const [relationshipDetails, setRelationshipDetails] = useState<RelationshipDetails | null>(null);
  const [relationshipError, setRelationshipError] = useState<string | null>(null);
  const [isRelationshipLoading, setIsRelationshipLoading] = useState(false);
  const [hasFocusedRotationPivot, setHasFocusedRotationPivot] = useState(false);
  const [focusedEdgeNodeId, setFocusedEdgeNodeId] = useState<string | null>(null);
  const [discoveryModeEnabled, setDiscoveryModeEnabled] = useState(true);
  const [latentLinks, setLatentLinks] = useState<GraphLink[]>([]);
  const [neuronTemplate, setNeuronTemplate] = useState<THREE.Object3D | null>(null);

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
    const missingNodes = nodes
      .filter((node) => !fixedNodeAnchorsRef.current.has(node.id))
      .sort((left, right) => left.id.localeCompare(right.id));

    missingNodes.forEach((node) => {
      const anchorIndex = fixedNodeAnchorsRef.current.size;
      const anchor =
        NODE_LAYOUT_ANCHORS[anchorIndex] ?? createOverflowAnchor(anchorIndex - NODE_LAYOUT_ANCHORS.length);
      fixedNodeAnchorsRef.current.set(node.id, anchor);
    });

    nodes.forEach((node) => {
      const anchor = fixedNodeAnchorsRef.current.get(node.id);

      if (!anchor) {
        return;
      }

      node.x = anchor.x;
      node.y = anchor.y;
      node.z = anchor.z;
      node.fx = anchor.x;
      node.fy = anchor.y;
      node.fz = anchor.z;
      node.vx = 0;
      node.vy = 0;
      node.vz = 0;
    });

    return {
      nodes,
      links,
    };
  }, [data, discoveryModeEnabled, latentLinks]);

  const adjacency = buildAdjacencyMap(displayData);
  const matchedNodeIds = findMatchingNodeIds(displayData.nodes, query);
  const focusedNodeIds = createFocusSet(hoveredNode, adjacency);
  const activeCardNode = expandedConcept ? null : selectedNode ?? hoveredNode;
  const selectedNodeIds = selectedEdge
    ? new Set([selectedEdge.sourceId, selectedEdge.targetId])
    : new Set<string>();

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

  function isSelectedLink(link: GraphLink): boolean {
    if (!selectedEdge) {
      return false;
    }

    const source = typeof link.source === 'string' ? link.source : link.source.id;
    const target = typeof link.target === 'string' ? link.target : link.target.id;

    return source === selectedEdge.sourceId && target === selectedEdge.targetId;
  }

  function isFocusedNodeLink(link: GraphLink): boolean {
    if (!focusedEdgeNodeId) {
      return false;
    }

    const source = typeof link.source === 'string' ? link.source : link.source.id;
    const target = typeof link.target === 'string' ? link.target : link.target.id;

    return source === focusedEdgeNodeId || target === focusedEdgeNodeId;
  }

  function isGhostLink(link: GraphLink): boolean {
    return link.isGhost === true || link.type === 'LATENT_DISCOVERY';
  }

  function clearSelectedEdge() {
    setSelectedEdge(null);
    setRelationshipDetails(null);
    setRelationshipError(null);
    setIsRelationshipLoading(false);
  }

  const getNodeThreeObject = useCallback((node: GraphNode): THREE.Object3D | null => {
    if (!neuronTemplate) {
      return null;
    }

    const group = new THREE.Group();
    const nodeColor = getVisualNodeColor(node);
    const hexColor = `#${nodeColor.getHexString()}`;

    const modelGroup = neuronTemplate.clone(true);
    modelGroup.name = 'neuron-model';
    modelGroup.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) {
        return;
      }

      child.material = createColoredNeuronMaterial(nodeColor);
      child.castShadow = false;
      child.receiveShadow = false;
    });
    group.add(modelGroup);

    const labelSprite = createTextSprite(node.name || 'Concept', hexColor);
    labelSprite.position.set(0, NODE_LABEL_Y_OFFSET, 0);
    group.add(labelSprite);

    return group;
  }, [neuronTemplate]);

  function clampNodesWithinBrain(refresh = false) {
    const containment = brainContainmentRef.current;

    if (!containment) {
      return;
    }

    const changed = clampNodesToContainment(displayData.nodes, containment);

    displayData.nodes.forEach((node) => {
      fixedNodeAnchorsRef.current.set(node.id, {
        x: node.x ?? 0,
        y: node.y ?? 0,
        z: node.z ?? 0,
      });
    });

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

  function getActiveRotationPivot() {
    const activeNodeId = activeRotationNodeIdRef.current;

    if (!activeNodeId) {
      return null;
    }

    const activeNode = displayData.nodes.find((node) => node.id === activeNodeId);

    if (!activeNode) {
      return null;
    }

    return new THREE.Vector3(
      activeNode.x ?? 0,
      activeNode.y ?? 0,
      activeNode.z ?? 0,
    );
  }

  function setRotationPivotNode(nodeId: string | null) {
    activeRotationNodeIdRef.current = nodeId;
    setHasFocusedRotationPivot(nodeId !== null);
    setFocusedEdgeNodeId(nodeId);
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

    const activePivot = getActiveRotationPivot();
    const focusPoint = activePivot ?? new THREE.Vector3(
      sceneFocusPointRef.current.x,
      sceneFocusPointRef.current.y,
      sceneFocusPointRef.current.z,
    );

    keepLocalPointAtWorldOrigin(rotationRoot, focusPoint);
    sceneFocusPointRef.current = {
      x: focusPoint.x,
      y: focusPoint.y,
      z: focusPoint.z,
    };
    rotationRoot.updateMatrixWorld(true);
    lookAtTargetRef.current = { x: 0, y: 0, z: 0 };
  }

  function focusPoint(point: { x: number; y: number; z: number }, distance: number) {
    sceneFocusPointRef.current = point;
    applySceneFocusPoint();
    const target = lookAtTargetRef.current;
    animateCamera(
      {
        x: target.x,
        y: target.y + distance * 0.08,
        z: target.z + distance,
      },
      target,
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
    setRotationPivotNode(null);
    setSelectedNode(null);
    setLatentLinks([]);

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
    if (expandedConcept || event.deltaY === 0) {
      return;
    }

    handleInteraction();
    event.preventDefault();
    handleZoom(event.deltaY < 0 ? WHEEL_ZOOM_IN_FACTOR : WHEEL_ZOOM_OUT_FACTOR);
  }

  async function handleConceptExpansion(node: GraphNode) {
    if (expandedConceptIdRef.current) return;

    expandedConceptIdRef.current = node.id;
    setExpandedConcept(node);
    setExpandedDocs(null);

    const controls = graphRef.current?.controls();
    if (controls) {
       (controls as any).enableRotate = false;
       (controls as any).enablePan = false;
    }

    let docs: RelationshipDocument[] = [];
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      const response = await fetch(`/api/concepts/${encodeURIComponent(node.name)}/documents`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (response.ok) {
        docs = await response.json();
      }
    } catch { }

    if (docs.length === 0) docs = getMockDocumentsForConcept(node.name);

    if (expandedConceptIdRef.current !== node.id) return;
    setExpandedDocs(docs);
  }

  function handleCollapse() {
    expandedConceptIdRef.current = null;
    setExpandedConcept(null);
    setExpandedDocs(null);

    const controls = graphRef.current?.controls();
    if (controls) {
      (controls as any).enableRotate = true;
      (controls as any).enablePan = true;
    }
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
  ) {
    // Cancel any in-flight camera animation so consecutive moves don't conflict.
    if (cameraAnimationRef.current !== null) {
      cancelAnimationFrame(cameraAnimationRef.current);
      cameraAnimationRef.current = null;
    }

    const cam = graphRef.current?.cameraPosition();
    if (!cam) return;

    const startCam = { x: cam.x, y: cam.y, z: cam.z };
    const startLookAt = { ...lookAtTargetRef.current };
    const startTime = performance.now();

    function animate() {
      const elapsed = performance.now() - startTime;
      const t = Math.min(elapsed / durationMs, 1);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic

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
      }
    }

    cameraAnimationRef.current = requestAnimationFrame(animate);
  }

  function smoothFlyToNode(nodePoint: { x: number; y: number; z: number }, distance: number) {
    const worldPos = toWorldPoint(nodePoint);
    const cam = graphRef.current?.cameraPosition();
    if (!cam) return;

    const dx = cam.x - worldPos.x;
    const dy = cam.y - worldPos.y;
    const dz = cam.z - worldPos.z;
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
    const now = Date.now();
    const nodePoint = {
      x: node.x ?? 0,
      y: node.y ?? 0,
      z: node.z ?? 0,
    };

    clearSelectedEdge();
    setSelectedNode(node);
    setRotationPivotNode(node.id);
    suppressBackgroundDoubleClickUntilRef.current = now + DOUBLE_CLICK_THRESHOLD_MS;

    if (node.type !== 'Concept') {
      lastNodeClickRef.current = null;
      setLatentLinks([]);
      smoothFlyToNode(nodePoint, 160);
      return;
    }

    if (
      lastNodeClickRef.current &&
      lastNodeClickRef.current.nodeId === node.id &&
      now - lastNodeClickRef.current.timestamp <= DOUBLE_CLICK_THRESHOLD_MS
    ) {
      // Double click: zoom closer and open documents
      smoothFlyToNode(nodePoint, 100);
      void handleConceptExpansion(node);
      lastNodeClickRef.current = null;
      return;
    }

    // Single click: fly to node only
    lastNodeClickRef.current = { nodeId: node.id, timestamp: now };
    smoothFlyToNode(nodePoint, 160);
    void loadLatentDiscovery(node);
  }

  async function handleLinkClick(link: GraphLink) {
    if (isGhostLink(link)) {
      return;
    }
    setSelectedNode(null);
    setRotationPivotNode(null);
    setLatentLinks([]);
    const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
    const targetId = typeof link.target === 'string' ? link.target : link.target.id;
    const sourceConcept = getConceptName(sourceId);
    const targetConcept = getConceptName(targetId);
    const sourceName = getNodeName(sourceId);
    const targetName = getNodeName(targetId);

    const mockDetailsKey = `${sourceId}->${targetId}`;
    const mockDetails = mockRelationshipDetailsByEdge[mockDetailsKey];

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

    if (graphSource === 'mock') {
      setRelationshipDetails(
        mockDetails ?? {
          source: sourceName,
          target: targetName,
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
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && expandedConceptIdRef.current) {
        handleCollapse();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

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

  // Increase charge repulsion so nodes spread out within the brain volume
  useEffect(() => {
    const fg = graphRef.current as any;
    if (!fg?.d3Force) return;
    fg.d3Force('charge')?.strength(-120);
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
    const loader = new GLTFLoader();
    let cancelled = false;

    loader.load(NEURON_MODEL_URL, (gltf) => {
      if (cancelled) {
        return;
      }

      const centeredNeuron = centerObject3DAtOrigin(gltf.scene, NEURON_MODEL_TARGET_DIAGONAL);
      setNeuronTemplate(centeredNeuron.pivot);
    });

    return () => {
      cancelled = true;
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
      lastSearchTargetIdRef.current = null;
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
    const hasQuery = query.trim().length > 0;
    const animate = () => {
      const time = performance.now();

      displayData.nodes.forEach((node) => {
        const obj = (node as any).__threeObj as THREE.Object3D | undefined;
        if (!obj) return;

        if (typeof obj.userData.update === 'function') {
          obj.userData.update(time);
        }

        // Dim non-matching nodes during search
        const isDimmed = hasQuery && !matchedNodeIds.has(node.id);
        obj.traverse((child) => {
          if (child instanceof THREE.Mesh && child.material) {
            const mat = child.material as THREE.MeshBasicMaterial | THREE.MeshPhysicalMaterial;
            if (child.parent?.name === 'halo') {
              mat.color.set(isDimmed ? 0x334155 : 0xffffff);
              mat.opacity = isDimmed ? 0.15 : 1;
              mat.transparent = true;
            } else if ('transmission' in mat) {
              // Main sphere
              (mat as any).opacity = isDimmed ? 0.06 : 0.4;
            }
          }
          if (child instanceof THREE.Sprite && child.material) {
            child.material.opacity = isDimmed ? 0.1 : 1;
          }
        });
      });
      frameId = requestAnimationFrame(animate);
    };
    frameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameId);
  }, [displayData.nodes, query, matchedNodeIds]);

  useEffect(() => {
    if (expandedConcept) stopIdleRotation();
    else scheduleIdleRotation();
  }, [expandedConcept]);

  useEffect(() => {
    if (!selectedEdge && !hasFocusedRotationPivot) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        clearSelectedEdge();
        if (activeRotationNodeIdRef.current) {
          handleReset();
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [hasFocusedRotationPivot, selectedEdge]);

  useEffect(() => {
    if (!activeCardNode) {
      setTooltipPosition(null);
      return;
    }

    let frameId = 0;

    const updatePosition = () => {
      const worldPoint = toWorldPoint({
        x: activeCardNode.x ?? 0,
        y: activeCardNode.y ?? 0,
        z: activeCardNode.z ?? 0,
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
  }, [activeCardNode]);

  function getBaseNodeColor(node: GraphNode): string {
    if (node.type === 'Concept') {
      return conceptColorFromScore(node.colorScore);
    }
    return NODE_TYPE_COLORS[node.type];
  }

  function getNodeColor(node: GraphNode): string {
    if (selectedEdge) {
      return selectedNodeIds.has(node.id) ? NODE_TYPE_COLORS[node.type] : DIMMED_NODE_COLOR;
    }

    if (hoveredNode) {
      return focusedNodeIds.has(node.id) ? getBaseNodeColor(node) : DIMMED_NODE_COLOR;
    }

    if (query.trim()) {
      return matchedNodeIds.has(node.id) ? getBaseNodeColor(node) : DIMMED_SEARCH_COLOR;
    }

    return getBaseNodeColor(node);
  }

  function getLinkColor(link: GraphLink): string {
    if (isGhostLink(link)) {
      return GHOST_EDGE_COLOR;
    }

    if (isSelectedLink(link)) {
      return ACTIVE_LINK_COLOR;
    }

    if (focusedEdgeNodeId) {
      return isFocusedNodeLink(link) ? ACTIVE_LINK_COLOR : DIMMED_LINK_COLOR;
    }

    if (hoveredNode) {
      return isDirectHoverLink(link, hoveredNode) ? ACTIVE_LINK_COLOR : DIMMED_LINK_COLOR;
    }

    return BASE_LINK_COLOR;
  }

  function getLinkLineDash(link: GraphLink): number[] | null {
    return isGhostLink(link) ? [2, 1] : null;
  }

  function getLinkWidth(link: GraphLink): number {
    if (isGhostLink(link)) {
      return GHOST_EDGE_WIDTH;
    }

    const weight =
      typeof link.weight === 'number' && Number.isFinite(link.weight) && link.weight > 0
        ? link.weight
        : 1;

    return Math.log(weight + 1) * ESTABLISHED_LINK_WIDTH_MULTIPLIER;
  }

  function getLinkLineDash(link: GraphLink): [number, number] | undefined {
    if (isGhostLink(link)) {
      return [2, 1];
    }

    return undefined;
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

  const onNodeClick = useCallback((node: object) => handleNodeClickRef.current(node as GraphNode), []);
  const onLinkClick = useCallback((link: object) => void handleLinkClickRef.current(link as GraphLink), []);
  const onNodeHover = useCallback((node: object | null) => onHoverNodeRef.current((node as GraphNode | null) ?? null), []);
  const onEngineTick = useCallback(() => {
    clampNodesWithinBrainRef.current();
    if (activeRotationNodeIdRef.current) {
      applySceneFocusPoint();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const dashedLinkProps = {
    linkLineDash: getLinkLineDash,
  } as any;

  return (
    <div
      ref={containerRef}
      className="relative h-full min-h-[26rem] overflow-hidden rounded-[2rem] border border-white/10 bg-slate-950/70 shadow-[0_0_80px_rgba(8,47,73,0.45)] lg:min-h-0"
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
          setSelectedNode(null);
          setRotationPivotNode(null);
          setLatentLinks([]);
        }
      }}
      onMouseMove={handleMouseMove}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseEnd}
      onMouseLeave={handleMouseEnd}
      onWheel={handleWheel}
      onTouchStart={handleInteraction}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.18),_transparent_38%),radial-gradient(circle_at_bottom_left,_rgba(168,85,247,0.14),_transparent_35%)]" />
      <div className="absolute left-4 top-4 z-10 rounded-full border border-violet-300/30 bg-slate-900/80 px-3 py-2 text-xs text-violet-100">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={discoveryModeEnabled}
            onChange={(event) => {
              setDiscoveryModeEnabled(event.target.checked);
            }}
            aria-label="Discovery mode"
          />
          <span>Discovery Mode</span>
        </label>
      </div>
      <ForceGraph3D
        ref={graphRef as never}
        {...dashedLinkProps}
        graphData={displayData}
        width={viewportSize.width || undefined}
        height={viewportSize.height || undefined}
        backgroundColor="rgba(0,0,0,0)"
        nodeColor={getNodeColor}
        nodeVal={(node) => {
          const candidate = node as GraphNode;
          return candidate.fx !== undefined ? 0.5 : 1;
        }}
        nodeThreeObject={getNodeThreeObject as (node: object) => THREE.Object3D}
        nodeThreeObjectExtend={false}
        linkColor={getLinkColor}
        linkLineDash={getLinkLineDash}
        linkWidth={getLinkWidth}
        linkHoverPrecision={10}
        linkOpacity={0.82}
        nodeRelSize={5}
        linkDirectionalParticles={0}
        cooldownTicks={120}
        d3AlphaDecay={0.02}
        d3VelocityDecay={0.15}
        onEngineTick={onEngineTick}
        onLinkClick={onLinkClick}
        onNodeClick={onNodeClick}
        onNodeHover={onNodeHover}
        enableNodeDrag={false}
        enableNavigationControls={false}
        controlType="orbit"
      />
      <div className="absolute right-4 top-4 flex flex-col gap-2 z-10">
        {!expandedConcept && (
          <>
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
          </>
        )}
      </div>
      {activeCardNode && tooltipPosition ? (
        <NodeTooltip
          node={activeCardNode}
          connectionCount={getConnectionCount(activeCardNode.id, adjacency)}
          x={tooltipPosition.x}
          y={tooltipPosition.y}
          actionLabel={selectedNode?.type === 'Concept' ? 'Open docs' : undefined}
          onAction={
            selectedNode?.type === 'Concept'
              ? () => {
                  void handleConceptExpansion(selectedNode);
                }
              : undefined
          }
        />
      ) : null}

      {expandedConcept && (
        <ConceptDocumentOverlay
          conceptName={expandedConcept.name}
          documents={expandedDocs}
          onClose={handleCollapse}
        />
      )}

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
