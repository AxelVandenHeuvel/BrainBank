import { useEffect, useRef, useState } from 'react';
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
import { mockRelationshipDetailsByEdge } from '../mock/mockGraph';
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
const BRAIN_HOME_VIEW_VERTICAL_BIAS = 0.08;
const MIN_BRAIN_HOME_VIEW_DISTANCE = 240;

export function Graph3D({
  data,
  source: graphSource,
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
  const [tooltipPosition, setTooltipPosition] = useState<TooltipPosition | null>(
    null,
  );
  const [selectedEdge, setSelectedEdge] = useState<SelectedRelationshipEdge | null>(
    null,
  );
  const [relationshipDetails, setRelationshipDetails] =
    useState<RelationshipDetails | null>(null);
  const [relationshipError, setRelationshipError] = useState<string | null>(null);
  const [isRelationshipLoading, setIsRelationshipLoading] = useState(false);
  const adjacency = buildAdjacencyMap(data);
  const matchedNodeIds = findMatchingNodeIds(data.nodes, query);
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

  function clampNodesWithinBrain(refresh = false) {
    const containment = brainContainmentRef.current;

    if (!containment) {
      return;
    }

    const changed = clampNodesToContainment(data.nodes, containment);

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

  function handleNodeClick(node: GraphNode) {
    const now = Date.now();

    if (
      lastNodeClickRef.current &&
      lastNodeClickRef.current.nodeId === node.id &&
      now - lastNodeClickRef.current.timestamp <= DOUBLE_CLICK_THRESHOLD_MS
    ) {
      zoomToNode(graphRef, node);
      lookAtTargetRef.current = {
        x: node.x ?? 0,
        y: node.y ?? 0,
        z: node.z ?? 0,
      };
      lastNodeClickRef.current = null;
      return;
    }

    lastNodeClickRef.current = {
      nodeId: node.id,
      timestamp: now,
    };
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
  }, [data.nodes]);

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

    const firstMatchId = findMatchingNodeIds(data.nodes, query).values().next().value;
    const firstMatch = data.nodes.find((node) => node.id === firstMatchId);

    if (!firstMatch) {
      return;
    }

    lookAtTargetRef.current = {
      x: firstMatch.x ?? 0,
      y: firstMatch.y ?? 0,
      z: firstMatch.z ?? 0,
    };
    zoomToNode(graphRef, firstMatch, 140);
  }, [data.nodes, query]);

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
    if (selectedEdge) {
      return selectedNodeIds.has(node.id)
        ? NODE_TYPE_COLORS[node.type]
        : DIMMED_NODE_COLOR;
    }

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
    if (isSelectedLink(link)) {
      return ACTIVE_LINK_COLOR;
    }

    if (hoveredNode) {
      return isDirectHoverLink(link, hoveredNode)
        ? ACTIVE_LINK_COLOR
        : DIMMED_LINK_COLOR;
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
      className="relative h-full min-h-[26rem] overflow-hidden rounded-[2rem] border border-white/10 bg-slate-950/70 shadow-[0_0_80px_rgba(8,47,73,0.45)]"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          clearSelectedEdge();
        }
      }}
      onMouseMove={handleInteraction}
      onMouseDown={handleInteraction}
      onWheel={handleInteraction}
      onTouchStart={handleInteraction}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.18),_transparent_38%),radial-gradient(circle_at_bottom_left,_rgba(168,85,247,0.14),_transparent_35%)]" />
      <ForceGraph3D
        ref={graphRef as never}
        graphData={data}
        backgroundColor="rgba(0,0,0,0)"
        nodeColor={getNodeColor}
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
