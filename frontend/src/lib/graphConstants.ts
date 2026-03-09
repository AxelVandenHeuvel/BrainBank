import * as THREE from 'three';

/* ── Interfaces ────────────────────────────────────────────────── */

export interface OrbitControlsLike {
  autoRotate: boolean;
  autoRotateSpeed: number;
  addEventListener: (event: string, callback: () => void) => void;
  removeEventListener: (event: string, callback: () => void) => void;
  target: {
    set: (x: number, y: number, z: number) => void;
  };
  update: () => void;
}

export interface ForceGraphHandle {
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

export interface TooltipPosition {
  x: number;
  y: number;
}

export interface BrainHomeView {
  distance: number;
  focusPoint: {
    x: number;
    y: number;
    z: number;
  };
}

export interface SelectedRelationshipEdge {
  sourceId: string;
  targetId: string;
  reason: string;
}

export interface TraversalPulseWindow {
  startMs: number;
  endMs: number;
  brightness: number;
}

/* ── Constants ─────────────────────────────────────────────────── */

export const TRAVERSAL_INACTIVE_COLOR = new THREE.Color('#64748b');
export const TRAVERSAL_AMBIENT_BLINK_PERIOD_MS = 900;
export const TRAVERSAL_AMBIENT_BLINK_BASE = 0.18;
export const TRAVERSAL_AMBIENT_BLINK_RANGE = 0.55;
export const TRAVERSAL_OUTLINE_COLOR = new THREE.Color('#f8fafc');

export const BRAIN_MODEL_URL = '/assets/human-brain.glb';
export const CAMERA_MOVE_DURATION_MS = 1200;
export const AUTO_CENTER_PADDING = 120;
export const IDLE_ROTATE_DELAY_MS = 5000;
export const IDLE_ROTATE_INTERVAL_MS = 16;
export const BUTTON_ZOOM_IN_FACTOR = 0.84;
export const BUTTON_ZOOM_OUT_FACTOR = 1.2;
export const WHEEL_ZOOM_IN_FACTOR = 0.9;
export const WHEEL_ZOOM_OUT_FACTOR = 1.2;
export const DOUBLE_CLICK_THRESHOLD_MS = 300;
export const BRAIN_HOME_VIEW_DISTANCE_MULTIPLIER = 2.6;
export const MIN_BRAIN_HOME_VIEW_DISTANCE = 240;
export const POINTER_ROTATION_SPEED = 0.005;
export const IDLE_ROTATION_SPEED = 0.002;
export const MAX_SCENE_TILT = Math.PI / 3;
export const GHOST_EDGE_COLOR = 'rgba(168, 85, 247, 0.28)';
export const BASE_LINK_COLOR = 'rgba(186, 224, 255, 0.34)';
export const SEMANTIC_BRIDGE_COLOR = 'rgba(251, 191, 36, 0.6)';
export const GHOST_EDGE_WIDTH = 0.55;
export const SEMANTIC_BRIDGE_WIDTH = 0.7;
export const ESTABLISHED_LINK_WIDTH_MULTIPLIER = 2.2;
export const BRAIN_MODEL_TARGET_DIAGONAL = 500;
export const DEFAULT_BRAIN_MESH_HEX = '#FFFFFF';
export const BRAIN_MESH_BASE_OPACITY = 0.06;
export const BRAIN_MESH_TOGGLE_FADE_DURATION_MS = 200;
export const NEURON_MODEL_TARGET_DIAGONAL = 10;
export const EXPANDED_DOC_RADIUS = 30;
export const EXPANDED_VIEW_DISTANCE = 78;
export const NODE_LABEL_Y_OFFSET = 16;
export const DISCOVERY_OUTLINE_COLOR = '#fbbf24';
export const DIVE_ZOOM_IN_DURATION_MS = 700;
export const DEFAULT_BACKGROUND_HEX = '#0E0F10';
