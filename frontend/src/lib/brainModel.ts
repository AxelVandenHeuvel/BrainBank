import * as THREE from 'three';

import type { GraphNode } from '../types/graph';

export interface BrainContainment {
  center: THREE.Vector3;
  meshes: THREE.Mesh[];
}

const VELOCITY_DAMPING = 0.18;
const INTERSECTION_EPSILON = 1e-3;
const INSIDE_TEST_DIRECTION = new THREE.Vector3(0.932, 0.271, 0.239).normalize();
const SURFACE_INSET_DISTANCE = 12;
const SURFACE_INSET_RATIO = 0.9;

function getNodePoint(node: Pick<GraphNode, 'x' | 'y' | 'z'>): THREE.Vector3 {
  return new THREE.Vector3(node.x ?? 0, node.y ?? 0, node.z ?? 0);
}

function createRaycastMesh(sourceMesh: THREE.Mesh): THREE.Mesh {
  const geometry = sourceMesh.geometry.clone();
  geometry.applyMatrix4(sourceMesh.matrixWorld);

  return new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  );
}

function getUniqueIntersectionDistances(
  meshes: THREE.Mesh[],
  origin: THREE.Vector3,
  direction: THREE.Vector3,
): number[] {
  const raycaster = new THREE.Raycaster(
    origin,
    direction.clone().normalize(),
    0,
    Infinity,
  );
  const hits = raycaster.intersectObjects(meshes, false);
  const distances: number[] = [];

  hits.forEach((hit) => {
    if (hit.distance <= INTERSECTION_EPSILON) {
      return;
    }

    const lastDistance = distances.at(-1);

    if (
      lastDistance === undefined ||
      Math.abs(hit.distance - lastDistance) > INTERSECTION_EPSILON
    ) {
      distances.push(hit.distance);
    }
  });

  return distances;
}

function isPointInsideMeshes(point: THREE.Vector3, meshes: THREE.Mesh[]): boolean {
  const distances = getUniqueIntersectionDistances(
    meshes,
    point,
    INSIDE_TEST_DIRECTION,
  );

  return distances.length % 2 === 1;
}

function findInteriorAnchor(
  meshes: THREE.Mesh[],
  bounds: THREE.Box3,
): THREE.Vector3 {
  const center = bounds.getCenter(new THREE.Vector3());

  if (isPointInsideMeshes(center, meshes)) {
    return center;
  }

  const size = bounds.getSize(new THREE.Vector3());
  const offsets = [
    new THREE.Vector3(size.x * 0.1, 0, 0),
    new THREE.Vector3(-size.x * 0.1, 0, 0),
    new THREE.Vector3(0, size.y * 0.1, 0),
    new THREE.Vector3(0, -size.y * 0.1, 0),
    new THREE.Vector3(0, 0, size.z * 0.1),
    new THREE.Vector3(0, 0, -size.z * 0.1),
  ];

  for (const offset of offsets) {
    const candidate = center.clone().add(offset);

    if (isPointInsideMeshes(candidate, meshes)) {
      return candidate;
    }
  }

  const rayOrigin = new THREE.Vector3(
    bounds.min.x - size.x,
    center.y,
    center.z,
  );
  const intersections = getUniqueIntersectionDistances(
    meshes,
    rayOrigin,
    new THREE.Vector3(1, 0, 0),
  );

  if (intersections.length >= 2) {
    return rayOrigin.clone().add(
      new THREE.Vector3(
        (intersections[0] + intersections[1]) / 2,
        0,
        0,
      ),
    );
  }

  return center;
}

export function createBrainContainment(root: THREE.Object3D): BrainContainment {
  root.updateMatrixWorld(true);

  const meshes: THREE.Mesh[] = [];
  const bounds = new THREE.Box3();

  root.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      const raycastMesh = createRaycastMesh(node);
      meshes.push(raycastMesh);
      bounds.expandByObject(raycastMesh);
    }
  });

  return {
    center: findInteriorAnchor(meshes, bounds),
    meshes,
  };
}

export function isNodeInsideContainment(
  node: Pick<GraphNode, 'x' | 'y' | 'z'>,
  containment: BrainContainment,
): boolean {
  return isPointInsideMeshes(getNodePoint(node), containment.meshes);
}

export function clampNodeToContainment(
  node: GraphNode,
  containment: BrainContainment,
): boolean {
  if (isNodeInsideContainment(node, containment)) {
    return false;
  }

  const origin = containment.center.clone();
  const targetPoint = getNodePoint(node);
  const direction = targetPoint.sub(origin);

  if (direction.lengthSq() <= INTERSECTION_EPSILON) {
    direction.copy(INSIDE_TEST_DIRECTION);
  }

  const intersections = getUniqueIntersectionDistances(
    containment.meshes,
    origin,
    direction,
  );
  const surfaceDistance = intersections[0];

  if (surfaceDistance === undefined) {
    return false;
  }

  const clampedDistance = Math.max(
    Math.min(
      surfaceDistance * SURFACE_INSET_RATIO,
      surfaceDistance - SURFACE_INSET_DISTANCE,
    ),
    0,
  );
  const clampedPoint = origin.add(
    direction.normalize().multiplyScalar(clampedDistance),
  );

  node.x = clampedPoint.x;
  node.y = clampedPoint.y;
  node.z = clampedPoint.z;
  node.vx = (node.vx ?? 0) * VELOCITY_DAMPING;
  node.vy = (node.vy ?? 0) * VELOCITY_DAMPING;
  node.vz = (node.vz ?? 0) * VELOCITY_DAMPING;

  if (node.fx !== undefined) {
    node.fx = node.x;
  }

  if (node.fy !== undefined) {
    node.fy = node.y;
  }

  if (node.fz !== undefined) {
    node.fz = node.z;
  }

  return true;
}

export function clampNodesToContainment(
  nodes: GraphNode[],
  containment: BrainContainment,
): boolean {
  let changed = false;

  nodes.forEach((node) => {
    changed = clampNodeToContainment(node, containment) || changed;
  });

  return changed;
}
