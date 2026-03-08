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

function createTextSprite(text: string, color: string = '#ffffff'): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
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

  const [expandedConcept, setExpandedConcept] = useState<GraphNode | null>(null);
  const [expandedDocs, setExpandedDocs] = useState<Array<{ doc_id: string; name: string; full_text: string }> | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState<TooltipPosition | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [selectedEdge, setSelectedEdge] = useState<SelectedRelationshipEdge | null>(null);
  const [relationshipDetails, setRelationshipDetails] = useState<RelationshipDetails | null>(null);
  const [relationshipError, setRelationshipError] = useState<string | null>(null);
  const [isRelationshipLoading, setIsRelationshipLoading] = useState(false);

  // No node injection — documents are shown in a 2D overlay on concept click.
  const displayData = data;
  const haloDataMapRef = useRef<Record<string, any[]>>({});

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
    const group = new THREE.Group();

    const hash = String(node.id).split('').reduce((acc, char) => {
        return (acc * 31 + char.charCodeAt(0)) % 10000;
    }, 0) / 10000;

    const colorScore = node.colorScore !== undefined ? node.colorScore : hash;

    const deepRed = new THREE.Color(0xFF4444);
    const electricBlue = new THREE.Color(0x4444FF);
    const nodeColor = deepRed.clone().lerp(electricBlue, colorScore);
    const hexColor = `#${nodeColor.getHexString()}`;

    const sphereMaterial = new THREE.MeshPhysicalMaterial({
        color: nodeColor,
        roughness: 0.1,
        metalness: 0.1,
        transmission: 0.8,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        side: THREE.DoubleSide,
    });

    const sphereMesh = new THREE.Mesh(
      new THREE.SphereGeometry(6.5, 32, 32),
      sphereMaterial
    );
    group.add(sphereMesh);

    const haloGroup = new THREE.Group();
    haloGroup.name = 'halo';

    const haloMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const haloGeom = new THREE.SphereGeometry(0.4, 8, 8);

    if (!haloDataMapRef.current[node.id]) {
      haloDataMapRef.current[node.id] = Array.from({ length: 15 }).map(() => ({
          radius: 1.5 + Math.random() * 4.0,
          theta: Math.random() * 2 * Math.PI,
          phi: Math.acos(2 * Math.random() - 1),
          speed: 0.0015,
          offset: Math.random() * Math.PI * 2
      }));
    }
    const hData = haloDataMapRef.current[node.id];

    const spawnTime = performance.now();
    haloGroup.rotation.y = spawnTime * 0.0003;
    haloGroup.rotation.x = spawnTime * 0.0001;

    for (let i = 0; i < 15; i++) {
        const mesh = new THREE.Mesh(haloGeom, haloMaterial);
        const d = hData[i];

        const r = d.radius + Math.sin(spawnTime * d.speed + d.offset) * 0.4;
        mesh.position.setFromSphericalCoords(r, d.phi, d.theta);

        mesh.userData = d;
        haloGroup.add(mesh);
    }
    group.add(haloGroup);

    const labelSprite = createTextSprite(node.name || 'Concept', hexColor);
    labelSprite.position.set(0, 10.5, 0);
    group.add(labelSprite);

    group.userData.update = (time: number) => {
        haloGroup.rotation.y = time * 0.0003;
        haloGroup.rotation.x = time * 0.0001;

        haloGroup.children.forEach(child => {
            const d = child.userData;
            const r = d.radius + Math.sin(time * d.speed + d.offset) * 0.4;
            child.position.setFromSphericalCoords(r, d.phi, d.theta);
        });
    };

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
    if (expandedConceptIdRef.current) return;

    expandedConceptIdRef.current = node.id;
    setExpandedConcept(node);
    setExpandedDocs(null);

    const controls = graphRef.current?.controls();
    if (controls) {
       (controls as any).enableRotate = false;
       (controls as any).enablePan = false;
    }

    let docs: Array<{ doc_id: string; name: string; full_text: string }> = [];
    try {
      const response = await fetch(`/api/concepts/${encodeURIComponent(node.name)}/documents`);
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
        { x: node.x ?? 0, y: node.y ?? 0, z: node.z ?? 0 },
        100,
      );
      lastNodeClickRef.current = null;
      return;
    }

    lastNodeClickRef.current = { nodeId: node.id, timestamp: now };
    focusPoint(
      { x: node.x ?? 0, y: node.y ?? 0, z: node.z ?? 0 },
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
    let frameId: number;
    const animate = () => {
      const time = performance.now();

      displayData.nodes.forEach((node) => {
        const obj = (node as any).__threeObj as THREE.Object3D | undefined;
        if (obj && typeof obj.userData.update === 'function') {
          obj.userData.update(time);
        }
      });
      frameId = requestAnimationFrame(animate);
    };
    frameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameId);
  }, [displayData.nodes]);

  useEffect(() => {
    if (expandedConcept) stopIdleRotation();
    else scheduleIdleRotation();
  }, [expandedConcept]);
    if (!selectedEdge) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        clearSelectedEdge();
      }
    }

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedEdge]);

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
      {hoveredNode && tooltipPosition && !expandedConcept ? (
        <NodeTooltip
          node={hoveredNode}
          connectionCount={getConnectionCount(hoveredNode.id, adjacency)}
          x={tooltipPosition.x}
          y={tooltipPosition.y}
        />
      ) : null}

      {/* 2D Overlay with Frosted Glass Effect */}
      {expandedConcept && (
        <div className="absolute inset-0 z-30 bg-slate-950/80 backdrop-blur-md flex flex-col items-center overflow-y-auto animate-in fade-in duration-300">
          <div className="sticky top-0 z-40 w-full bg-slate-950/40 backdrop-blur-lg border-b border-white/10 px-8 py-6 flex justify-between items-center mb-8">
            <h2 className="text-3xl font-bold text-slate-100">{expandedConcept.name}</h2>
            <button onClick={handleCollapse} className="px-6 py-2.5 rounded-full bg-indigo-600/90 hover:bg-indigo-500 text-sm font-semibold text-slate-100 shadow-lg shadow-indigo-950/30 transition float-right">
              ← Back to Web (Esc)
            </button>
          </div>
          <div className="w-full max-w-7xl px-8 pb-20">
            {!expandedDocs ? (
              <div className="text-slate-400 mt-20 text-xl animate-pulse text-center">Loading documents...</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {expandedDocs.map((doc, idx) => (
                  <div
                    key={doc.doc_id}
                    className="bg-slate-800/60 border border-slate-700/50 p-6 rounded-2xl shadow-xl transition hover:-translate-y-1 hover:shadow-2xl hover:bg-slate-800/80 cursor-pointer flex flex-col"
                    style={{ animation: `float ${4 + (idx % 3)}s ease-in-out infinite alternate` }}
                  >
                    <h3 className="text-xl font-semibold text-yellow-300 mb-3 leading-tight">{doc.name}</h3>
                    <p className="text-slate-400 leading-relaxed overflow-hidden text-ellipsis line-clamp-[8]">{doc.full_text}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`
        @keyframes float {
          0% { transform: translateY(0px) rotate(0deg); }
          50% { transform: translateY(-6px) rotate(0.5deg); }
          100% { transform: translateY(0px) rotate(0deg); }
        }
      `}</style>

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
