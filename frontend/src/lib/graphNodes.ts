import * as THREE from 'three';

import { communityColor } from './graphView';
import {
  BRAIN_MESH_BASE_OPACITY,
  DISCOVERY_OUTLINE_COLOR,
  NEURON_MODEL_TARGET_DIAGONAL,
  NODE_LABEL_Y_OFFSET,
} from './graphConstants';
import type { GraphNode } from '../types/graph';

/** Seed initial position from a deterministic hash so the force simulation starts
 *  with nodes spread out instead of all at the origin. */
export function seedNodePosition(nodeId: string): { x: number; y: number; z: number } {
  let hash = 0;
  for (let i = 0; i < nodeId.length; i++) {
    hash = (hash * 31 + nodeId.charCodeAt(i)) | 0;
  }
  const phi = ((hash & 0xffff) / 0xffff) * Math.PI * 2;
  const cosTheta = ((((hash >> 16) & 0xffff) / 0xffff) * 2) - 1;
  const sinTheta = Math.sqrt(1 - cosTheta * cosTheta);
  const r = 60 + ((hash & 0xff) / 255) * 80;
  return {
    x: r * sinTheta * Math.cos(phi),
    y: r * cosTheta,
    z: r * sinTheta * Math.sin(phi),
  };
}

export function getDeterministicNodeColorScore(node: GraphNode): number {
  if (node.colorScore !== undefined) {
    return node.colorScore;
  }

  return (
    String(node.id).split('').reduce((acc, char) => {
      return (acc * 31 + char.charCodeAt(0)) % 10000;
    }, 0) / 10000
  );
}

export function getVisualNodeColor(node: GraphNode): THREE.Color {
  return new THREE.Color(0x22d3ee).lerp(
    new THREE.Color(0x6366f1),
    getDeterministicNodeColorScore(node),
  );
}

export function getTraversalBlinkPhase(nodeId: string): number {
  let hash = 0;
  for (let i = 0; i < nodeId.length; i++) {
    hash = (hash * 33 + nodeId.charCodeAt(i)) | 0;
  }

  return (((hash >>> 0) % 360) / 360) * Math.PI * 2;
}

export function formatStatLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function createTextSprite(text: string, color: string = '#ffffff'): THREE.Sprite {
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

export function createNodeMaterial(nodeColor: THREE.Color): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: nodeColor,
    emissive: new THREE.Color(0x000000),
    roughness: 0.8,
    metalness: 0,
    flatShading: true,
    transparent: true,
    opacity: 0.9,
  });
}

export function applyNodeMaterialState(
  obj: THREE.Object3D,
  color: THREE.Color,
  emissive: THREE.Color,
  opacity: number,
) {
  obj.userData.currentColor = color.clone();
  obj.userData.currentEmissive = emissive.clone();
  obj.userData.currentOpacity = opacity;
  obj.userData.currentOutlineOpacity = Number(obj.userData.currentOutlineOpacity ?? 0);
  obj.userData.currentSpriteOpacity = Number(obj.userData.currentSpriteOpacity ?? 1);

  obj.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || !child.material) {
      return;
    }

    if (child.name !== 'node-shape') {
      return;
    }

    const material = child.material as THREE.MeshStandardMaterial;
    material.color.copy(color);
    material.emissive.copy(emissive);
    material.opacity = opacity;
    material.transparent = true;
  });
}

export function getBrainMeshMaterials(brain: THREE.Object3D): THREE.MeshBasicMaterial[] {
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

/** Build the THREE.Object3D for a single graph node (dodecahedron + outline + label). */
export function buildNodeThreeObject(
  node: GraphNode,
  nodeColor: THREE.Color,
): THREE.Group {
  const group = new THREE.Group();
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
  group.userData.traversalPulse = 0;

  return group;
}

/** Compute the node color, respecting community coloring. */
export function resolveNodeColor(node: GraphNode): THREE.Color {
  return node.type === 'Concept' && node.community_id != null
    ? new THREE.Color(communityColor(node.community_id))
    : getVisualNodeColor(node);
}
