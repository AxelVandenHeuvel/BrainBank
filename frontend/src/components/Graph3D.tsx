import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph3D from 'react-force-graph-3d';
// @ts-expect-error - no types available
import { forceCollide } from 'd3-force-3d';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import {
  ACTIVE_LINK_COLOR,
  DIMMED_LINK_COLOR,
  DIMMED_NODE_COLOR,
  DIMMED_SEARCH_COLOR,
  NODE_TYPE_COLORS,
  buildAdjacencyMap,
  communityColor,
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
  chatFocus?: {
    sourceConcepts: string[];
    discoveryConcepts: string[];
  } | null;
  hoveredNode?: GraphNode | null;
  onHoverNode?: (node: GraphNode | null) => void;
  onOpenDocument?: (docId: string, name: string, content: string) => void;
  onConceptFocused?: (conceptName: string | null) => void;
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
const WHEEL_ZOOM_IN_FACTOR = 0.9;
const WHEEL_ZOOM_OUT_FACTOR = 1.2;
const DOUBLE_CLICK_THRESHOLD_MS = 300;
const BRAIN_HOME_VIEW_DISTANCE_MULTIPLIER = 2.6;
const MIN_BRAIN_HOME_VIEW_DISTANCE = 240;
const POINTER_ROTATION_SPEED = 0.005;
const IDLE_ROTATION_SPEED = 0.002;
const MAX_SCENE_TILT = Math.PI / 3;
const GHOST_EDGE_COLOR = 'rgba(168, 85, 247, 0.28)';
const BASE_LINK_COLOR = 'rgba(186, 224, 255, 0.34)';
const SEMANTIC_BRIDGE_COLOR = 'rgba(251, 191, 36, 0.6)';
const GHOST_EDGE_WIDTH = 0.55;
const SEMANTIC_BRIDGE_WIDTH = 0.7;
const ESTABLISHED_LINK_WIDTH_MULTIPLIER = 2.2;
const BRAIN_MODEL_TARGET_DIAGONAL = 500;
const PAGE_ACCENT_PINK = '#ec4899';
const BRAIN_MESH_COLOR = new THREE.Color(PAGE_ACCENT_PINK)
  .lerp(new THREE.Color('#ffffff'), 0.4)
  .getHex();
const BRAIN_MESH_BASE_OPACITY = 0.06;
const BRAIN_MESH_TOGGLE_FADE_DURATION_MS = 200;
const NEURON_MODEL_TARGET_DIAGONAL = 10;
const EXPANDED_DOC_RADIUS = 30;
const EXPANDED_VIEW_DISTANCE = 78;
const NODE_LABEL_Y_OFFSET = 16;
const DISCOVERY_OUTLINE_COLOR = '#fbbf24';
const DIVE_ZOOM_IN_DURATION_MS = 700;
/** Seed initial position from a deterministic hash so the force simulation starts
 *  with nodes spread out instead of all at the origin. */
function seedNodePosition(nodeId: string): { x: number; y: number; z: number } {
  let hash = 0;
  for (let i = 0; i < nodeId.length; i++) {
    hash = (hash * 31 + nodeId.charCodeAt(i)) | 0;
  }
  const phi = ((hash & 0xffff) / 0xffff) * Math.PI * 2;
  const cosTheta = ((((hash >> 16) & 0xffff) / 0xffff) * 2) - 1;
  const sinTheta = Math.sqrt(1 - cosTheta * cosTheta);
  const r = 15 + ((hash & 0xff) / 255) * 20;
  return {
    x: r * sinTheta * Math.cos(phi),
    y: r * cosTheta,
    z: r * sinTheta * Math.sin(phi),
  };
}

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


function createTextSprite(text: string, color: string = '#ffffff'): THREE.Sprite {
  const font = 'bold 52px "Inter", "Roboto", sans-serif';
  const padding = 80;
  const height = 128;

  // Measure text width to size canvas dynamically
  const measureCanvas = document.createElement('canvas');
  const measureCtx = measureCanvas.getContext('2d');
  let textWidth = 512; // fallback
  if (measureCtx) {
    measureCtx.font = font;
    textWidth = Math.ceil(measureCtx.measureText(text).width) + padding;
  }
  const width = Math.max(256, textWidth);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
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

    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  // Scale width proportionally so the sprite aspect ratio matches the canvas
  const spriteHeight = 4;
  const spriteWidth = spriteHeight * (width / height);
  sprite.scale.set(spriteWidth, spriteHeight, 1);
  sprite.renderOrder = 999;
  return sprite;
}

function createNodeMaterial(nodeColor: THREE.Color): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: nodeColor,
    emissive: nodeColor.clone().multiplyScalar(0.15),
    roughness: 0.6,
    metalness: 0.1,
    flatShading: true,
    transparent: true,
    opacity: 0.9,
  });
}

function getBrainMeshMaterials(brain: THREE.Object3D): THREE.MeshBasicMaterial[] {
  const materials: THREE.MeshBasicMaterial[] = [];

  brain.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) {
      return;
    }

    const childMaterials = Array.isArray(node.material) ? node.material : [node.material];
    childMaterials.forEach((material) => {
      if (material instanceof THREE.MeshBasicMaterial) {
        materials.push(material);
      }
    });
  });

  return materials;
}

export function Graph3D({
  data,
  source: graphSource,
  query,
  chatFocus = null,
  hoveredNode: hoveredNodeProp,
  onHoverNode: onHoverNodeProp,
  onOpenDocument,
  onConceptFocused,
}: Graph3DProps) {
  const [internalHoveredNode, setInternalHoveredNode] = useState<GraphNode | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
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
  const brainMeshAnimationRef = useRef<number | null>(null);
  const simulationSettledRef = useRef(false);
  const pinnedPositionsRef = useRef<Map<string, { x: number; y: number; z: number }>>(new Map());
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
  const [showBrainMesh, setShowBrainMesh] = useState(true);
  const showBrainMeshRef = useRef(showBrainMesh);

  useEffect(() => {
    showBrainMeshRef.current = showBrainMesh;
  }, [showBrainMesh]);

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
    const ids = new Set<string>([expandedConcept.node.id]);
    expandedConcept.docs.forEach((doc) => ids.add(`doc-expand:${doc.doc_id}`));
    return ids;
  }, [expandedConcept]);

  const displayDataRef = useRef(displayData);
  displayDataRef.current = displayData;

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
  const activeCardNode = selectedNode ?? hoveredNode;
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

  function isSemanticBridgeLink(link: GraphLink): boolean {
    return link.type === 'SEMANTIC_BRIDGE';
  }

  function clearSelectedEdge() {
    setSelectedEdge(null);
    setRelationshipDetails(null);
    setRelationshipError(null);
    setIsRelationshipLoading(false);
  }

  const getNodeThreeObject = useCallback((node: GraphNode): THREE.Object3D => {
    const group = new THREE.Group();

    const nodeColor =
      node.type === 'Concept' && node.community_id != null
        ? new THREE.Color(communityColor(node.community_id))
        : getVisualNodeColor(node);
    const hexColor = `#${nodeColor.getHexString()}`;
    const material = createNodeMaterial(nodeColor);

    const radius = NEURON_MODEL_TARGET_DIAGONAL / 2;
    const geo = new THREE.DodecahedronGeometry(radius, 0);
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = 'node-shape';
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    group.add(mesh);

    const outline = new THREE.Mesh(
      new THREE.DodecahedronGeometry(radius * 1.18, 0),
      new THREE.MeshBasicMaterial({
        color: DISCOVERY_OUTLINE_COLOR,
        wireframe: true,
        transparent: true,
        opacity: 0,
      }),
    );
    outline.name = 'node-outline';
    outline.visible = false;
    group.add(outline);

    const labelSprite = createTextSprite(node.name || 'Concept', hexColor);
    labelSprite.position.set(0, NODE_LABEL_Y_OFFSET, 0);
    group.add(labelSprite);
    group.userData.baseColor = nodeColor.clone();
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

    const focusPoint = new THREE.Vector3(
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
    setSelectedNode(null);
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

  function handleMouseDown(event: React.MouseEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }

    if (event.target instanceof HTMLElement && event.target.closest('button')) {
      return;
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
    if (docs.length === 0) docs = getMockDocumentsForConcept(conceptName);
    return docs;
  }

  function handleConceptExpansion(node: GraphNode) {
    const nodePoint = { x: node.x ?? 0, y: node.y ?? 0, z: node.z ?? 0 };

    // Start dive animation: push the camera inward while the rest of the brain fades away.
    setIsDiving(true);
    diveStartTimeRef.current = performance.now();

    // Prefetch docs while camera zooms in
    const docsPromise = fetchConceptDocs(node.name);

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
        // Once the inward dive finishes, reveal the doc sub-graph in place.
        docsPromise.then((docs) => {
          if (docs.length > 0) {
            setExpandedConcept({ node, docs });
          }
          setIsDiving(false);
          diveStartTimeRef.current = null;
        });
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

      // Single-click doc node: select it (no zoom to keep second click reliable)
      lastNodeClickRef.current = { nodeId: node.id, timestamp: now };
      clearSelectedEdge();
      setSelectedNode(node);
      return;
    }

    // Collapse expanded view when clicking a different concept
    if (expandedConcept && node.id !== expandedConcept.node.id) {
      setExpandedConcept(null);
    }

    clearSelectedEdge();
    setSelectedNode(node);
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
            color: BRAIN_MESH_COLOR,
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
      clampNodesWithinBrain(true);

      // Update pin map with clamped positions so the reheat doesn't undo the clamping
      const clampPins = pinnedPositionsRef.current;
      displayDataRef.current.nodes.forEach((n) => {
        clampPins.set(n.id, { x: n.x ?? 0, y: n.y ?? 0, z: n.z ?? 0 });
        n.fx = n.x;
        n.fy = n.y;
        n.fz = n.z;
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
        const isDocExpand = node.id.startsWith('doc-expand:');
        const dimOpacity = isExpandHidden ? 0 : 0.08;
        const isDimmed = isSearchDimmed || isChatDimmed || isExpandHidden;

        const baseColor =
          ((obj.userData.baseColor as THREE.Color | undefined) ?? new THREE.Color(getBaseNodeColor(node)))
            .clone();

        const targetColor =
          isChatDiscovery || isChatDimmed ? new THREE.Color(DIMMED_SEARCH_COLOR) : baseColor;
        const targetEmissive =
          isChatSource
            ? baseColor.clone().multiplyScalar(0.2)
            : targetColor.clone().multiplyScalar(0.08);
        const targetOpacity = isDimmed ? dimOpacity : 0.9;
        const targetOutlineOpacity = isChatDiscovery && !isExpandHidden ? 0.95 : 0;
        const targetSpriteOpacity = isExpandHidden || isSearchDimmed || isChatDimmed ? 0 : 1;

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
  }, [chatFocusNodeIds, displayData.nodes, expandedNodeIds, hasChatFocus, matchedNodeIds, query]);


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

  function getLinkColor(link: GraphLink): string {
    // When a concept is expanded, only show doc↔doc links; hide everything else
    if (expandedNodeIds) {
      const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
      const targetId = typeof link.target === 'string' ? link.target : link.target.id;
      if (expandedNodeIds.has(sourceId) && expandedNodeIds.has(targetId)) {
        return ACTIVE_LINK_COLOR;
      }
      return 'rgba(0,0,0,0)';
    }

    if (isGhostLink(link)) {
      return GHOST_EDGE_COLOR;
    }

    if (isSemanticBridgeLink(link)) {
      if (isSelectedLink(link) || isFocusedNodeLink(link) || isDirectHoverLink(link, hoveredNode)) {
        return ACTIVE_LINK_COLOR;
      }
      if (focusedEdgeNodeId || hoveredNode) {
        return DIMMED_LINK_COLOR;
      }
      return SEMANTIC_BRIDGE_COLOR;
    }

    if (isSelectedLink(link)) {
      return ACTIVE_LINK_COLOR;
    }

    if (hasChatFocus) {
      const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
      const targetId = typeof link.target === 'string' ? link.target : link.target.id;

      return chatFocusNodeIds.highlightedNodeIds.has(sourceId) &&
        chatFocusNodeIds.highlightedNodeIds.has(targetId)
        ? ACTIVE_LINK_COLOR
        : DIMMED_LINK_COLOR;
    }

    if (focusedEdgeNodeId) {
      return isFocusedNodeLink(link) ? ACTIVE_LINK_COLOR : DIMMED_LINK_COLOR;
    }

    if (hoveredNode) {
      return isDirectHoverLink(link, hoveredNode) ? ACTIVE_LINK_COLOR : DIMMED_LINK_COLOR;
    }

    return BASE_LINK_COLOR;
  }

  function getLinkWidth(link: GraphLink): number {
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
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.18),_transparent_38%),radial-gradient(circle_at_bottom_left,_rgba(168,85,247,0.14),_transparent_35%)]" />
      <ForceGraph3D
        ref={graphRef as never}
        {...dashedLinkProps}
        graphData={displayData}
        width={viewportSize.width || undefined}
        height={viewportSize.height || undefined}
        backgroundColor="rgba(0,0,0,0)"
        nodeColor={getNodeColor}
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
          if (Date.now() <= suppressBackgroundDoubleClickUntilRef.current) return;
          clearSelectedEdge();
          setSelectedNode(null);
          setRotationPivotNode(null);
          setLatentLinks([]);
          setExpandedConcept(null);
        }}
        enableNodeDrag={false}
        enableNavigationControls={false}
        controlType="orbit"
      />
      <div className="absolute right-4 top-4 flex flex-col gap-2 z-10">
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
        <button
          type="button"
          aria-label={showBrainMesh ? 'Hide brain mesh' : 'Show brain mesh'}
          onClick={() => setShowBrainMesh((current) => !current)}
          className={`flex h-11 w-11 items-center justify-center rounded-full text-[0.65rem] font-semibold uppercase tracking-[0.18em] shadow-lg shadow-slate-950/30 transition ${
            showBrainMesh
              ? 'bg-slate-800/80 text-slate-100 hover:bg-slate-700/90'
              : 'bg-slate-900/60 text-slate-400 hover:bg-slate-800/80 hover:text-slate-200'
          }`}
        >
          BM
        </button>
      </div>
      {activeCardNode && tooltipPosition && !expandedConcept ? (
        <NodeTooltip
          node={activeCardNode}
          connectionCount={getConnectionCount(activeCardNode.id, adjacency)}
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
