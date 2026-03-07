import { useEffect, useRef, useState } from 'react';
import ForceGraph3D from 'react-force-graph-3d';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import {
  ACTIVE_LINK_COLOR,
  NODE_TYPE_COLORS,
  buildAdjacencyMap,
  createFocusSet,
  DIMMED_LINK_COLOR,
  DIMMED_NODE_COLOR,
  DIMMED_SEARCH_COLOR,
  findMatchingNodeIds,
  getConnectionCount,
  getNodeId,
  isDirectHoverLink,
} from '../lib/graphView';
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
  cameraPosition: (
    position: { x: number; y: number; z: number },
    lookAt: { x: number; y: number; z: number },
    durationMs: number,
  ) => void;
  graph2ScreenCoords: (
    x: number,
    y: number,
    z: number,
  ) => { x: number; y: number };
  scene: () => THREE.Scene;
}

interface TooltipPosition {
  x: number;
  y: number;
}

interface Graph3DProps {
  data: GraphData;
  query: string;
  hoveredNode: GraphNode | null;
  onHoverNode: (node: GraphNode | null) => void;
}

const BRAIN_MODEL_URL = '/assets/human-brain.glb';
const CAMERA_MOVE_DURATION_MS = 1200;
const AUTO_ROTATE_SPEED = 0.22;
const AUTO_ROTATE_RESUME_DELAY_MS = 1200;

export function Graph3D({
  data,
  query,
  hoveredNode,
  onHoverNode,
}: Graph3DProps) {
  const graphRef = useRef<ForceGraphHandle | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState<TooltipPosition | null>(
    null,
  );
  const adjacency = buildAdjacencyMap(data);
  const matchedNodeIds = findMatchingNodeIds(data.nodes, query);
  const focusedNodeIds = createFocusSet(hoveredNode, adjacency);

  useEffect(() => {
    const controls = graphRef.current?.controls();

    if (!controls) {
      return;
    }

    let timeoutId: number | undefined;

    const pauseAutoRotate = () => {
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }

      controls.autoRotate = false;
    };

    const resumeAutoRotate = () => {
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }

      timeoutId = window.setTimeout(() => {
        controls.autoRotate = true;
      }, AUTO_ROTATE_RESUME_DELAY_MS);
    };

    controls.autoRotate = true;
    controls.autoRotateSpeed = AUTO_ROTATE_SPEED;
    controls.addEventListener('start', pauseAutoRotate);
    controls.addEventListener('end', resumeAutoRotate);

    return () => {
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }

      controls.removeEventListener('start', pauseAutoRotate);
      controls.removeEventListener('end', resumeAutoRotate);
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
            });
          }
        });

        scene.add(brainGroup);
        return;
      }

      scene.add(loadedScene as unknown as THREE.Object3D);
    });

    return () => {
      cancelled = true;

      if (brainGroup) {
        scene.remove(brainGroup);
      }
    };
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      return;
    }

    const firstMatchId = findMatchingNodeIds(data.nodes, query).values().next().value;
    const firstMatch = data.nodes.find((node) => node.id === firstMatchId);

    if (!firstMatch) {
      return;
    }

    const lookAt = {
      x: firstMatch.x ?? 0,
      y: firstMatch.y ?? 0,
      z: firstMatch.z ?? 0,
    };
    const cameraPosition = {
      x: lookAt.x + 140,
      y: lookAt.y + 30,
      z: lookAt.z + 120,
    };

    graphRef.current?.cameraPosition(
      cameraPosition,
      lookAt,
      CAMERA_MOVE_DURATION_MS,
    );
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
    <div className="relative h-full min-h-[26rem] overflow-hidden rounded-[2rem] border border-white/10 bg-slate-950/70 shadow-[0_0_80px_rgba(8,47,73,0.45)]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.18),_transparent_38%),radial-gradient(circle_at_bottom_left,_rgba(168,85,247,0.14),_transparent_35%)]" />
      <ForceGraph3D
        ref={graphRef as never}
        graphData={data}
        backgroundColor="rgba(0,0,0,0)"
        nodeColor={getNodeColor}
        linkColor={getLinkColor}
        linkWidth={getLinkWidth}
        linkOpacity={0.7}
        nodeRelSize={5}
        linkDirectionalParticles={hoveredNode ? 2 : 0}
        linkDirectionalParticleWidth={2}
        cooldownTicks={120}
        d3AlphaDecay={0.02}
        d3VelocityDecay={0.15}
        onNodeHover={(node) => onHoverNode((node as GraphNode | null) ?? null)}
        enableNodeDrag={false}
        controlType="orbit"
      />
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
