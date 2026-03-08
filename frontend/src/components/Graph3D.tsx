import { useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph3D from 'react-force-graph-3d';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import {
  ACTIVE_LINK_COLOR,
  autoRotateCamera,
  NODE_TYPE_COLORS,
  buildAdjacencyMap,
  centerCameraOnTarget,
  createFocusSet,
  DIMMED_LINK_COLOR,
  DIMMED_NODE_COLOR,
  DIMMED_SEARCH_COLOR,
  findMatchingNodeIds,
  getConnectionCount,
  isDirectHoverLink,
  zoomToNode,
} from '../lib/graphView';
import {
  clampNodesToContainment,
  createBrainContainment,
  type BrainContainment,
} from '../lib/brainModel';
import { getMockDocumentsForConcept } from '../mock/mockGraph';
import type { GraphData, GraphLink, GraphNode } from '../types/graph';
import { NodeTooltip } from './NodeTooltip';

interface OrbitControlsLike {
  autoRotate: boolean;
  autoRotateSpeed: number;
  addEventListener: (event: string, callback: () => void) => void;
  removeEventListener: (event: string, callback: () => void) => void;
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
  target: {
    x: number;
    y: number;
    z: number;
  };
}

interface Graph3DProps {
  data: GraphData;
  query: string;
  hoveredNode: GraphNode | null;
  onHoverNode: (node: GraphNode | null) => void;
}

const BRAIN_MODEL_URL = '/assets/human-brain.glb';
const CAMERA_MOVE_DURATION_MS = 1200;
const AUTO_CENTER_PADDING = 120;
const IDLE_ROTATE_DELAY_MS = 5000;
const IDLE_ROTATE_INTERVAL_MS = 16;
const BUTTON_ZOOM_IN_FACTOR = 0.84;
const BUTTON_ZOOM_OUT_FACTOR = 1.2;
const DOUBLE_CLICK_THRESHOLD_MS = 300;
// Radius of the transparent container sphere in graph units
const CONTAINER_SPHERE_RADIUS = 22;
// Distance from concept center at which doc nodes are pinned
const DOC_ORBIT_RADIUS = 15;
// Brain home view camera positioning
const BRAIN_HOME_VIEW_DISTANCE_MULTIPLIER = 2.8;
const MIN_BRAIN_HOME_VIEW_DISTANCE = 300;
const BRAIN_HOME_VIEW_VERTICAL_BIAS = 0.15;

export function Graph3D({
  data,
  query,
  hoveredNode,
  onHoverNode,
}: Graph3DProps) {
  const graphRef = useRef<ForceGraphHandle | null>(null);
  const brainContainmentRef = useRef<BrainContainment | null>(null);
  const brainHomeViewRef = useRef<BrainHomeView | null>(null);
  const idleTimeoutRef = useRef<number | null>(null);
  const idleRotationIntervalRef = useRef<number | null>(null);
  const lastNodeClickRef = useRef<{ nodeId: string; timestamp: number } | null>(
    null,
  );
  const lookAtTargetRef = useRef({ x: 0, y: 0, z: 0 });

  // Ref used inside the async fetch callback to detect stale expansions.
  const expandedConceptIdRef = useRef<string | null>(null);
  // State copy so nodeThreeObject re-renders when expansion changes.
  const [expandedConceptId, setExpandedConceptId] = useState<string | null>(null);
  const [injectedNodes, setInjectedNodes] = useState<GraphNode[]>([]);
  const [injectedLinks, setInjectedLinks] = useState<GraphLink[]>([]);

  const [tooltipPosition, setTooltipPosition] = useState<TooltipPosition | null>(
    null,
  );

  // Merge base graph with injected document leaf nodes.
  // useMemo prevents ForceGraph3D from treating a new object reference as a
  // full data reset (restarting the physics simulation) on every render.
  const displayData = useMemo(
    () =>
      injectedNodes.length === 0
        ? data
        : {
            nodes: [...data.nodes, ...injectedNodes],
            links: [...data.links, ...injectedLinks],
          },
    [data, injectedNodes, injectedLinks],
  );

  const adjacency = buildAdjacencyMap(displayData);
  const matchedNodeIds = findMatchingNodeIds(displayData.nodes, query);
  const focusedNodeIds = createFocusSet(hoveredNode, adjacency);

  // Build the transparent container sphere rendered in place of the expanded concept.
  function getNodeThreeObject(node: GraphNode): THREE.Object3D | null {
    if (node.id !== expandedConceptId) return null;

    const color = new THREE.Color(NODE_TYPE_COLORS[node.type]);
    const group = new THREE.Group();

    // Semi-transparent solid fill
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

    // Wireframe shell so the boundary is visible
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
        autoRotateCamera(graphRef);
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
      lookAtTargetRef.current = brainHomeView.target;
      centerCameraOnTarget(
        graphRef,
        brainHomeView.target,
        brainHomeView.distance,
        CAMERA_MOVE_DURATION_MS,
      );
      return;
    }

    lookAtTargetRef.current = getGraphCenter();
    graphRef.current?.zoomToFit(CAMERA_MOVE_DURATION_MS, AUTO_CENTER_PADDING);
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

    // Same concept clicked again — collapse
    if (expandedConceptIdRef.current === conceptNodeId) {
      expandedConceptIdRef.current = null;
      setExpandedConceptId(null);
      setInjectedNodes([]);
      setInjectedLinks([]);
      return;
    }

    // New concept — clear previous expansion immediately
    expandedConceptIdRef.current = conceptNodeId;
    setExpandedConceptId(conceptNodeId);
    setInjectedNodes([]);
    setInjectedLinks([]);

    // Try the real API first; fall back to mock data so the UI is testable
    // even when the backend is not running.
    let docs: Array<{ doc_id: string; name: string; full_text: string }> = [];

    try {
      const response = await fetch(
        `/api/concepts/${encodeURIComponent(node.name)}/documents`,
      );
      if (response.ok) {
        docs = (await response.json()) as typeof docs;
      }
    } catch {
      // Backend unavailable — fall through to mock
    }

    if (docs.length === 0) {
      docs = getMockDocumentsForConcept(node.name);
    }

    // Guard: user may have clicked a different concept while fetch was in flight
    if (expandedConceptIdRef.current !== conceptNodeId) return;

    // Pin doc nodes at evenly-spaced positions on a sphere inside the container
    const count = docs.length;
    setInjectedNodes(
      docs.map((doc, i) => {
        const theta = (2 * Math.PI * i) / count;
        const phi = Math.PI * (0.35 + 0.3 * (i % 2 === 0 ? 1 : -1));
        return {
          id: `doc:${doc.doc_id}`,
          type: 'Document' as const,
          name: doc.name,
          // fx/fy/fz pins the node so the simulation can't push it away
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
    // Injected document leaf nodes are intentionally non-interactive
    if (node.type === 'Document') return;

    const now = Date.now();

    // Double-click: zoom in close
    if (
      lastNodeClickRef.current &&
      lastNodeClickRef.current.nodeId === node.id &&
      now - lastNodeClickRef.current.timestamp <= DOUBLE_CLICK_THRESHOLD_MS
    ) {
      zoomToNode(graphRef, node, 100);
      lookAtTargetRef.current = {
        x: node.x ?? 0,
        y: node.y ?? 0,
        z: node.z ?? 0,
      };
      lastNodeClickRef.current = null;
      return;
    }

    lastNodeClickRef.current = { nodeId: node.id, timestamp: now };

    // Single click: gentle zoom toward the node + expand/collapse its documents
    zoomToNode(graphRef, node, 160);
    lookAtTargetRef.current = {
      x: node.x ?? 0,
      y: node.y ?? 0,
      z: node.z ?? 0,
    };

    void handleConceptExpansion(node);
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
    let brainGroup: THREE.Object3D | null = null;

    loader.load(BRAIN_MODEL_URL, (gltf) => {
      if (cancelled) {
        return;
      }

      const loadedScene = gltf.scene;

      if (loadedScene instanceof THREE.Object3D) {
        brainGroup = loadedScene;

        const bounds = new THREE.Box3().setFromObject(brainGroup);
        const center = bounds.getCenter(new THREE.Vector3());
        const size = bounds.getSize(new THREE.Vector3()).length() || 1;
        const scale = 260 / size;

        brainGroup.position.sub(center);
        brainGroup.scale.setScalar(scale);

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

        brainGroup.updateMatrixWorld(true);
        const framedBounds = new THREE.Box3().setFromObject(brainGroup);
        const framedSize = framedBounds.getSize(new THREE.Vector3());
        const framedSphere = framedBounds.getBoundingSphere(new THREE.Sphere());
        brainContainmentRef.current = createBrainContainment(brainGroup);
        brainHomeViewRef.current = {
          distance: Math.max(
            framedSphere.radius * BRAIN_HOME_VIEW_DISTANCE_MULTIPLIER,
            MIN_BRAIN_HOME_VIEW_DISTANCE,
          ),
          target: {
            x: framedSphere.center.x,
            y: framedSphere.center.y + framedSize.y * BRAIN_HOME_VIEW_VERTICAL_BIAS,
            z: framedSphere.center.z,
          },
        };
        clampNodesWithinBrain(true);
        scene.add(brainGroup);
        handleReset();
        return;
      }

      scene.add(loadedScene as unknown as THREE.Object3D);
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
    if (!query.trim()) {
      return;
    }

    const firstMatchId = findMatchingNodeIds(displayData.nodes, query).values().next().value;
    const firstMatch = displayData.nodes.find((node) => node.id === firstMatchId);

    if (!firstMatch) {
      return;
    }

    lookAtTargetRef.current = {
      x: firstMatch.x ?? 0,
      y: firstMatch.y ?? 0,
      z: firstMatch.z ?? 0,
    };
    zoomToNode(graphRef, firstMatch, 140);
  }, [displayData.nodes, query]);

  useEffect(() => {
    if (!hoveredNode) {
      setTooltipPosition(null);
      return;
    }

    let frameId = 0;

    const updatePosition = () => {
      const coords = graphRef.current?.graph2ScreenCoords(
        hoveredNode.x ?? 0,
        hoveredNode.y ?? 0,
        hoveredNode.z ?? 0,
      );

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
    if (hoveredNode) {
      return focusedNodeIds.has(node.id)
        ? NODE_TYPE_COLORS[node.type]
        : DIMMED_NODE_COLOR;
    }

    if (query.trim()) {
      return matchedNodeIds.has(node.id)
        ? NODE_TYPE_COLORS[node.type]
        : DIMMED_SEARCH_COLOR;
    }

    return NODE_TYPE_COLORS[node.type];
  }

  function getLinkColor(link: GraphLink): string {
    if (hoveredNode) {
      return isDirectHoverLink(link, hoveredNode)
        ? ACTIVE_LINK_COLOR
        : DIMMED_LINK_COLOR;
    }

    return 'rgba(56, 189, 248, 0.24)';
  }

  function getLinkWidth(link: GraphLink): number {
    return isDirectHoverLink(link, hoveredNode) ? 2.8 : 0.7;
  }

  return (
    <div
      className="relative h-full min-h-[26rem] overflow-hidden rounded-[2rem] border border-white/10 bg-slate-950/70 shadow-[0_0_80px_rgba(8,47,73,0.45)]"
      onMouseMove={handleInteraction}
      onMouseDown={handleInteraction}
      onWheel={handleInteraction}
      onTouchStart={handleInteraction}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.18),_transparent_38%),radial-gradient(circle_at_bottom_left,_rgba(168,85,247,0.14),_transparent_35%)]" />
      <ForceGraph3D
        ref={graphRef as never}
        graphData={displayData}
        backgroundColor="rgba(0,0,0,0)"
        nodeColor={getNodeColor}
        nodeVal={(node) => {
          const n = node as GraphNode;
          // Injected doc nodes are half the size of concept nodes
          return n.fx !== undefined ? 0.5 : 1;
        }}
        nodeThreeObject={(node) =>
          getNodeThreeObject(node as GraphNode) as THREE.Object3D
        }
        nodeThreeObjectExtend={false}
        linkColor={getLinkColor}
        linkWidth={getLinkWidth}
        linkOpacity={0.7}
        nodeRelSize={5}
        linkDirectionalParticles={hoveredNode ? 2 : 0}
        linkDirectionalParticleWidth={2}
        cooldownTicks={120}
        d3AlphaDecay={0.02}
        d3VelocityDecay={0.15}
        onEngineTick={() => clampNodesWithinBrain()}
        onNodeClick={(node) => handleNodeClick(node as GraphNode)}
        onNodeHover={(node) => onHoverNode((node as GraphNode | null) ?? null)}
        enableNodeDrag={false}
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
    </div>
  );
}
