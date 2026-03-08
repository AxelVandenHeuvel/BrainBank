import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { centerObject3DAtOrigin, rotateObjectFromPointerDelta } from './brainScene';

describe('brainScene helpers', () => {
  it('centers a model around the origin and resets the pivot position', () => {
    const model = new THREE.Group();
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(4, 6, 8),
      new THREE.MeshBasicMaterial(),
    );

    mesh.position.set(12, -6, 4);
    model.add(mesh);

    const centered = centerObject3DAtOrigin(model, 100);
    const boundsCenter = centered.bounds.getCenter(new THREE.Vector3());

    expect(boundsCenter.x).toBeCloseTo(0, 4);
    expect(boundsCenter.y).toBeCloseTo(0, 4);
    expect(boundsCenter.z).toBeCloseTo(0, 4);
    expect(centered.pivot.position.x).toBe(0);
    expect(centered.pivot.position.y).toBe(0);
    expect(centered.pivot.position.z).toBe(0);
    expect(centered.orbitTarget.x).toBe(0);
    expect(centered.orbitTarget.y).toBe(0);
    expect(centered.orbitTarget.z).toBe(0);
    expect(centered.bounds.getSize(new THREE.Vector3()).length()).toBeCloseTo(100, 4);
  });

  it('maps pointer deltas to in-place object rotation', () => {
    const target = new THREE.Group();

    rotateObjectFromPointerDelta(target, 20, -10, 0.01, Math.PI / 4);

    expect(target.rotation.x).toBeCloseTo(-0.1, 4);
    expect(target.rotation.y).toBeCloseTo(0.2, 4);
    expect(target.rotation.z).toBe(0);
  });
});
