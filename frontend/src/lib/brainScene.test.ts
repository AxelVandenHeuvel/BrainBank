import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import {
  applyObjectOrbitPosition,
  centerObject3DAtOrigin,
  keepLocalPointAtWorldOrigin,
  rotateObjectFromPointerDelta,
} from './brainScene';

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

  it('repositions a rotated object so a local focus point stays at world origin', () => {
    const target = new THREE.Group();
    const focusPoint = new THREE.Vector3(12, 0, -4);

    target.rotation.y = Math.PI / 3;
    target.rotation.x = -Math.PI / 8;
    target.updateMatrixWorld(true);

    keepLocalPointAtWorldOrigin(target, focusPoint);
    target.updateMatrixWorld(true);

    const centeredPoint = target.localToWorld(focusPoint.clone());

    expect(centeredPoint.x).toBeCloseTo(0, 4);
    expect(centeredPoint.y).toBeCloseTo(0, 4);
    expect(centeredPoint.z).toBeCloseTo(0, 4);
  });

  it('updates object position so rotation happens around an arbitrary pivot point', () => {
    const target = new THREE.Group();
    const pivot = new THREE.Vector3(10, 0, 0);

    target.rotation.order = 'YXZ';
    target.rotation.y = Math.PI / 2;
    applyObjectOrbitPosition(target, pivot);

    expect(target.position.x).toBeCloseTo(10, 4);
    expect(target.position.y).toBeCloseTo(0, 4);
    expect(target.position.z).toBeCloseTo(10, 4);

    target.updateMatrixWorld(true);
    const pivotWorld = target.localToWorld(pivot.clone());

    expect(pivotWorld.x).toBeCloseTo(10, 4);
    expect(pivotWorld.y).toBeCloseTo(0, 4);
    expect(pivotWorld.z).toBeCloseTo(0, 4);
  });
});
