import * as THREE from 'three';

export interface CenteredObject3D {
  pivot: THREE.Group;
  bounds: THREE.Box3;
  sphere: THREE.Sphere;
  orbitTarget: THREE.Vector3;
}

interface Point3D {
  x: number;
  y: number;
  z: number;
}

export function centerObject3DAtOrigin(
  model: THREE.Object3D,
  targetDiagonal = 260,
): CenteredObject3D {
  const pivot = new THREE.Group();
  pivot.position.set(0, 0, 0);
  pivot.add(model);
  pivot.updateMatrixWorld(true);

  const initialBounds = new THREE.Box3().setFromObject(pivot);
  const initialDiagonal =
    initialBounds.getSize(new THREE.Vector3()).length() || 1;
  const scaleFactor = targetDiagonal / initialDiagonal;

  model.scale.multiplyScalar(scaleFactor);
  pivot.updateMatrixWorld(true);

  const scaledBounds = new THREE.Box3().setFromObject(pivot);
  const scaledCenter = scaledBounds.getCenter(new THREE.Vector3());

  model.position.sub(scaledCenter);
  pivot.position.set(0, 0, 0);
  pivot.updateMatrixWorld(true);

  const bounds = new THREE.Box3().setFromObject(pivot);
  const orbitTarget = bounds.getCenter(new THREE.Vector3());
  const sphere = bounds.getBoundingSphere(new THREE.Sphere());

  return {
    pivot,
    bounds,
    sphere,
    orbitTarget,
  };
}

export function rotateObjectFromPointerDelta(
  target: THREE.Object3D,
  deltaX: number,
  deltaY: number,
  speed = 0.005,
  maxTilt = Math.PI / 2,
): void {
  target.rotation.order = 'YXZ';
  target.rotation.y += deltaX * speed;
  target.rotation.x = THREE.MathUtils.clamp(
    target.rotation.x + deltaY * speed,
    -maxTilt,
    maxTilt,
  );
}

export function keepLocalPointAtWorldOrigin(
  target: THREE.Object3D,
  point: Point3D,
): void {
  const rotatedPoint = new THREE.Vector3(point.x, point.y, point.z).applyQuaternion(
    target.quaternion,
  );

  target.position.copy(rotatedPoint.multiplyScalar(-1));
}

export function applyObjectOrbitPosition(
  target: THREE.Object3D,
  pivot: THREE.Vector3,
): void {
  const rotatedPivot = pivot.clone().applyEuler(target.rotation);
  target.position.copy(pivot).sub(rotatedPivot);
}
