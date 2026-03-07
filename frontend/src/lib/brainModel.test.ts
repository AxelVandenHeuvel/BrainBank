import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import {
  clampNodeToContainment,
  createBrainContainment,
  isNodeInsideContainment,
} from './brainModel';
import type { GraphNode } from '../types/graph';

describe('brainModel helpers', () => {
  function createBrainMesh() {
    return new THREE.Mesh(
      new THREE.CapsuleGeometry(28, 110, 8, 16),
      new THREE.MeshBasicMaterial(),
    );
  }

  it('derives a mesh-backed containment volume from the brain object', () => {
    const containment = createBrainContainment(createBrainMesh());

    expect(containment.meshes).toHaveLength(1);
    expect(containment.center.x).toBeCloseTo(0, 1);
    expect(containment.center.y).toBeCloseTo(0, 1);
    expect(containment.center.z).toBeCloseTo(0, 1);
  });

  it('keeps nodes that are already inside the containment unchanged', () => {
    const node: GraphNode = {
      id: 'concept:inside',
      type: 'Concept',
      name: 'Inside',
      x: 10,
      y: 8,
      z: 6,
    };
    const containment = createBrainContainment(createBrainMesh());

    expect(clampNodeToContainment(node, containment)).toBe(false);
    expect(node).toMatchObject({ x: 10, y: 8, z: 6 });
    expect(isNodeInsideContainment(node, containment)).toBe(true);
  });

  it('treats points inside the bounding box but outside the mesh as outside', () => {
    const containment = createBrainContainment(createBrainMesh());

    expect(
      isNodeInsideContainment(
        {
          x: 24,
          y: 0,
          z: 24,
        },
        containment,
      ),
    ).toBe(false);
  });

  it('clamps out-of-bounds nodes back inside the containment volume', () => {
    const node: GraphNode = {
      id: 'concept:outside',
      type: 'Concept',
      name: 'Outside',
      x: 70,
      y: 0,
      z: 55,
    };
    const containment = createBrainContainment(createBrainMesh());

    expect(clampNodeToContainment(node, containment)).toBe(true);
    expect(isNodeInsideContainment(node, containment)).toBe(true);
  });
});

