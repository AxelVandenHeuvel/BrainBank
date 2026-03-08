import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

import { createBrainContainment, isNodeInsideContainment } from '../lib/brainModel';
import type { GraphData, GraphLink, GraphNode, RelationshipDetails } from '../types/graph';
import { Graph3D } from './Graph3D';

const graphPropsSpy = vi.fn();
const gltfLoadSpy = vi.fn();
let sceneObject = new THREE.Scene();
let canvasGetContextSpy: { mockRestore: () => void } | null = null;
let resizeObserverCallback:
  | ((entries: Array<{ contentRect: { width: number; height: number } }>) => void)
  | null = null;
const controls = {
  autoRotate: false,
  autoRotateSpeed: 0,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  target: {
    set: vi.fn(),
  },
  update: vi.fn(),
};
let currentCameraPosition = { x: 200, y: 60, z: 200 };
const cameraPosition = vi.fn((
  position?: typeof currentCameraPosition,
  _lookAt?: typeof currentCameraPosition,
  _durationMs?: number,
) => {
  if (!position) {
    return currentCameraPosition;
  }

  currentCameraPosition = position;
  return currentCameraPosition;
});
const graph2ScreenCoords = vi.fn(() => ({ x: 160, y: 120 }));
const zoomToFit = vi.fn();
const refresh = vi.fn();

class MockResizeObserver {
  constructor(
    callback: (
      entries: Array<{ contentRect: { width: number; height: number } }>,
    ) => void,
  ) {
    resizeObserverCallback = callback;
  }

  observe = vi.fn();
  disconnect = vi.fn();
}

vi.mock('react-force-graph-3d', async () => {
  const React = await vi.importActual<typeof import('react')>('react');

  return {
    default: React.forwardRef((props: Record<string, unknown>, ref) => {
      React.useImperativeHandle(ref, () => ({
        controls: () => controls,
        cameraPosition,
        graph2ScreenCoords,
        zoomToFit,
        scene: () => sceneObject,
        getGraphBbox: () => ({
          x: [80, 200],
          y: [-30, 90],
          z: [-20, 100],
        }),
        refresh,
      }));
      graphPropsSpy(props);
      return <div data-testid="force-graph" />;
    }),
  };
});

vi.mock('three/examples/jsm/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class {
    load(url: string, onLoad: (value: { scene: THREE.Object3D }) => void) {
      gltfLoadSpy(url);

      if (url === '/assets/neuron-spinous-stellate-cell.glb') {
        const scene = new THREE.Group();
        const dendrite = new THREE.Mesh(
          new THREE.ConeGeometry(5, 16, 8),
          new THREE.MeshStandardMaterial({ color: '#ffffff' }),
        );
        dendrite.name = 'neuron-dendrite';
        dendrite.rotation.z = Math.PI / 8;
        const soma = new THREE.Mesh(
          new THREE.SphereGeometry(4.5, 8, 8),
          new THREE.MeshStandardMaterial({ color: '#ffffff' }),
        );
        soma.name = 'neuron-soma';
        soma.position.set(-1, -5, 2);
        scene.add(dendrite);
        scene.add(soma);
        onLoad({ scene });
        return;
      }

      const scene = new THREE.Group();
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(50, 8, 8));
      mesh.position.set(40, -20, 10);
      scene.add(mesh);
      onLoad({ scene });
    }
  },
}));

const graph: GraphData = {
  nodes: [
    { id: 'concept:Calculus', type: 'Concept', name: 'Calculus', x: 10, y: 0, z: 0 },
    { id: 'concept:Derivatives', type: 'Concept', name: 'Derivatives', x: -10, y: 0, z: 0 },
    { id: 'doc:abc-123', type: 'Document', name: 'Math Notes', x: 0, y: 10, z: 0 },
  ],
  links: [
    {
      source: 'concept:Calculus',
      target: 'concept:Derivatives',
      type: 'RELATED_TO',
      reason: 'Derivatives are a core tool within calculus',
    },
    {
      source: 'doc:abc-123',
      target: 'concept:Calculus',
      type: 'MENTIONS',
    },
  ],
};

const relationshipDetails: RelationshipDetails = {
  source: 'Calculus',
  target: 'Derivatives',
  type: 'RELATED_TO',
  reason: 'Derivatives are a core tool within calculus',
  source_documents: [
    { doc_id: 'shared-1', name: 'Math Notes', full_text: 'Calculus and derivatives appear together.' },
  ],
  target_documents: [
    { doc_id: 'shared-1', name: 'Math Notes', full_text: 'Calculus and derivatives appear together.' },
    { doc_id: 'target-1', name: 'Derivative Rules', full_text: 'Derivative rules live here.' },
  ],
  shared_document_ids: ['shared-1'],
};

const hoveredNode: GraphNode = {
  id: 'concept:Calculus',
  type: 'Concept',
  name: 'Calculus',
  x: 10,
  y: 0,
  z: 0,
};

function getLatestGraphProps() {
  return graphPropsSpy.mock.calls.at(-1)?.[0] as {
    onNodeClick: (node: GraphNode) => Promise<void> | void;
    onLinkClick: (link: GraphLink) => Promise<void> | void;
    onEngineTick: () => void;
    nodeColor: (node: GraphNode) => string;
    linkColor: (link: GraphLink) => string;
    linkWidth: (link: GraphLink) => number;
    linkLineDash?: (link: GraphLink) => [number, number] | undefined;
    graphData: GraphData;
    nodeThreeObject: (node: GraphNode) => THREE.Object3D | null;
    linkOpacity: number;
    linkDirectionalParticles: number;
    linkDirectionalParticleWidth?: number;
    width: number;
    height: number;
    enableNavigationControls: boolean;
    linkHoverPrecision: number;
    nodeLabel?: (node: GraphNode) => string | null;
  };
}

describe('Graph3D', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
    canvasGetContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation(() => null as never);
    sceneObject = new THREE.Scene();
    resizeObserverCallback = null;
    currentCameraPosition = { x: 200, y: 60, z: 200 };
    graph.nodes[0].x = 10;
    graph.nodes[0].y = 0;
    graph.nodes[0].z = 0;
    graph.nodes[1].x = -10;
    graph.nodes[1].y = 0;
    graph.nodes[1].z = 0;
    graph.nodes[2].x = 0;
    graph.nodes[2].y = 10;
    graph.nodes[2].z = 0;
    cameraPosition.mockClear();
    graphPropsSpy.mockClear();
    gltfLoadSpy.mockClear();
    zoomToFit.mockClear();
    refresh.mockClear();
    controls.target.set.mockClear();
    controls.update.mockClear();
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        if (url.includes('/api/relationships/details')) {
          return Promise.resolve({
            ok: true,
            json: async () => relationshipDetails,
          });
        }

        return Promise.resolve({
          ok: true,
          json: async () => [],
        });
      }),
    );
  });

  afterEach(() => {
    canvasGetContextSpy?.mockRestore();
    canvasGetContextSpy = null;
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('centers the home view on the larger brain shell when it loads', () => {
    render(
      <Graph3D
        data={graph}
        source="api"
        query=""
        hoveredNode={null}
        onHoverNode={vi.fn()}
      />,
    );

    vi.advanceTimersByTime(200);
    vi.advanceTimersByTime(1300);

    // Camera should be positioned to frame the scaled brain geometry.
    // The SphereGeometry(50) mock with mesh at (40,-20,10) gives:
    //   centeredBrain.sphere.radius ≈ 250, distance = max(250 * 2.6, 240) = 650
    //   orbitTarget ≈ {x:0, y:0, z:0} after centering
    //   camera.y = target.y + distance * 0.08 ≈ 52
    expect(cameraPosition).toHaveBeenLastCalledWith(
      expect.objectContaining({
        x: 0,
        y: expect.closeTo(52, 2),
        z: expect.closeTo(650, 0),
      }),
      expect.objectContaining({
        x: 0,
        y: 0,
        z: 0,
      }),
    );
    expect((graphPropsSpy.mock.calls.at(-1)?.[0] as {
      enableNavigationControls: boolean;
    }).enableNavigationControls).toBe(false);
  });

  it('renders the brain shell with a light pink wireframe color and opacity', async () => {
    render(
      <Graph3D
        data={graph}
        source="api"
        query=""
        hoveredNode={null}
        onHoverNode={vi.fn()}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    const brainMaterials: THREE.MeshBasicMaterial[] = [];
    sceneObject.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshBasicMaterial) {
        brainMaterials.push(child.material);
      }
    });

    expect(brainMaterials).not.toHaveLength(0);
    const expectedBrainColor = new THREE.Color('#ec4899').lerp(new THREE.Color('#ffffff'), 0.4);
    brainMaterials.forEach((material) => {
      expect(material.transparent).toBe(true);
      expect(material.opacity).toBeCloseTo(0.06, 6);
      expect(material.color.getHex()).toBe(expectedBrainColor.getHex());
    });
  });

  it('renders a top-left checkbox control that fades the brain mesh in and out', async () => {
    render(
      <Graph3D
        data={graph}
        source="api"
        query=""
        hoveredNode={null}
        onHoverNode={vi.fn()}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    const toggleCheckbox = screen.getByRole('checkbox', { name: 'Brain mesh' });
    expect(toggleCheckbox).toBeInTheDocument();
    expect(toggleCheckbox).toBeChecked();

    const brainGroup = sceneObject.children[0] as THREE.Group | undefined;
    expect(brainGroup?.visible).toBe(true);
    const brainMaterials: THREE.MeshBasicMaterial[] = [];
    brainGroup?.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshBasicMaterial) {
        brainMaterials.push(child.material);
      }
    });
    expect(brainMaterials).not.toHaveLength(0);
    brainMaterials.forEach((material) => {
      expect(material.opacity).toBeCloseTo(0.06, 6);
    });

    fireEvent.click(toggleCheckbox);
    expect(screen.getByRole('checkbox', { name: 'Brain mesh' })).not.toBeChecked();
    expect(brainGroup?.visible).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(16);
      await Promise.resolve();
    });

    brainMaterials.forEach((material) => {
      expect(material.opacity).toBeGreaterThan(0);
      expect(material.opacity).toBeLessThan(0.06);
    });

    await act(async () => {
      vi.advanceTimersByTime(250);
      await Promise.resolve();
    });

    expect(brainGroup?.visible).toBe(false);
    brainMaterials.forEach((material) => {
      expect(material.opacity).toBeCloseTo(0, 6);
    });

    fireEvent.click(screen.getByRole('checkbox', { name: 'Brain mesh' }));
    expect(screen.getByRole('checkbox', { name: 'Brain mesh' })).toBeChecked();
    expect(brainGroup?.visible).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(16);
      await Promise.resolve();
    });

    brainMaterials.forEach((material) => {
      expect(material.opacity).toBeGreaterThan(0);
      expect(material.opacity).toBeLessThan(0.06);
    });

    await act(async () => {
      vi.advanceTimersByTime(250);
      await Promise.resolve();
    });

    brainMaterials.forEach((material) => {
      expect(material.opacity).toBeCloseTo(0.06, 6);
    });
  });

  it('creates dodecahedron node with correct color and label', () => {
    render(
      <Graph3D
        data={graph}
        source="api"
        query=""
        hoveredNode={null}
        onHoverNode={vi.fn()}
      />,
    );

    const nodeObject = getLatestGraphProps().nodeThreeObject(graph.nodes[0]);
    expect(nodeObject).toBeDefined();

    const shape = nodeObject?.getObjectByName('node-shape') as THREE.Mesh;
    expect(shape).toBeDefined();
    expect(shape.geometry.type).toBe('DodecahedronGeometry');

    const expectedColorScore = String(graph.nodes[0].id)
      .split('')
      .reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) % 10000, 0) / 10000;
    const expectedColor = new THREE.Color(0xff4444).lerp(
      new THREE.Color(0x4444ff),
      expectedColorScore,
    );

    const material = shape.material as THREE.MeshStandardMaterial;
    expect(material.color.getHex()).toBe(expectedColor.getHex());
    expect(material.flatShading).toBe(true);

    expect(nodeObject?.children.some((child) => child instanceof THREE.Sprite)).toBe(true);
  });

  it('seeds initial node positions for force-directed layout', () => {
    render(
      <Graph3D
        data={graph}
        source="api"
        query=""
        hoveredNode={null}
        onHoverNode={vi.fn()}
      />,
    );

    const renderedNodes = getLatestGraphProps().graphData.nodes;
    const calculus = renderedNodes.find((node) => node.id === 'concept:Calculus');
    const derivatives = renderedNodes.find((node) => node.id === 'concept:Derivatives');

    // Nodes should have initial positions; after brain loads they are pinned (fx/fy/fz)
    expect(calculus).toBeDefined();
    expect(typeof calculus!.x).toBe('number');
    expect(typeof calculus!.y).toBe('number');
    expect(typeof calculus!.z).toBe('number');

    expect(derivatives).toBeDefined();
    expect(typeof derivatives!.x).toBe('number');
    // Different nodes should get different seed positions
    expect(calculus!.x !== derivatives!.x || calculus!.y !== derivatives!.y || calculus!.z !== derivatives!.z).toBe(true);
  });

  it('re-centers the brain when the graph panel reports its initial measured size', () => {
    render(
      <Graph3D
        data={graph}
        source="api"
        query=""
        hoveredNode={null}
        onHoverNode={vi.fn()}
      />,
    );

    vi.advanceTimersByTime(200);
    cameraPosition.mockClear();

    act(() => {
      resizeObserverCallback?.([{ contentRect: { width: 1260, height: 820 } }]);
    });

    vi.advanceTimersByTime(1300);

    expect((graphPropsSpy.mock.calls.at(-1)?.[0] as {
      width: number;
      height: number;
    }).width).toBe(1260);
    expect((graphPropsSpy.mock.calls.at(-1)?.[0] as {
      width: number;
      height: number;
    }).height).toBe(820);
    expect(cameraPosition).toHaveBeenLastCalledWith(
      expect.objectContaining({
        x: 0,
        y: expect.closeTo(52, 2),
        z: expect.closeTo(650, 0),
      }),
      expect.objectContaining({
        x: 0,
        y: 0,
        z: 0,
      }),
    );
  });

  it('smoothly flies the camera to the first matching search result without snapping the scene', () => {
    render(
      <Graph3D
        data={graph}
        source="api"
        query="calc"
        hoveredNode={null}
        onHoverNode={vi.fn()}
      />,
    );

    // Advance time so the self-managed rAF animation completes
    vi.advanceTimersByTime(1300);

    // Camera should have been animated to the node's world position
    const lastCall = cameraPosition.mock.calls.at(-1);
    expect(lastCall).toBeDefined();
    // No duration arg — we manage our own animation via rAF
    expect(lastCall!.length).toBeLessThanOrEqual(2);
    // The lookAt target should be the node position (world coords)
    expect(lastCall![1]).toEqual(
      expect.objectContaining({ y: expect.any(Number), z: expect.any(Number) }),
    );
  });

  it('starts rotating the scene in place after 5 seconds of idle time and stops on mouse movement', () => {
    const { container } = render(
      <Graph3D
        data={graph}
        source="api"
        query=""
        hoveredNode={null}
        onHoverNode={vi.fn()}
      />,
    );

    vi.advanceTimersByTime(200);
    vi.advanceTimersByTime(1300);

    const callCountBeforeIdle = cameraPosition.mock.calls.length;
    vi.advanceTimersByTime(5000);
    vi.advanceTimersByTime(32);

    expect(sceneObject.rotation.y).not.toBe(0);
    expect(cameraPosition.mock.calls.length).toBe(callCountBeforeIdle);

    const callCountAfterIdle = cameraPosition.mock.calls.length;
    fireEvent.mouseMove(container.firstChild as HTMLElement);
    vi.advanceTimersByTime(100);

    expect(cameraPosition.mock.calls.length).toBe(callCountAfterIdle);
  });

  it('does not auto-rotate around a clicked concept node (rotation only resumes on reset)', async () => {
    render(
      <Graph3D
        data={graph}
        source="api"
        query=""
        hoveredNode={null}
        onHoverNode={vi.fn()}
      />,
    );

    vi.advanceTimersByTime(200);

    await act(async () => {
      await getLatestGraphProps().onNodeClick(graph.nodes[0]);
    });

    // Let the rAF camera animation finish
    vi.advanceTimersByTime(1300);

    sceneObject.rotation.set(0, 0, 0);
    sceneObject.position.set(0, 0, 0);
    cameraPosition.mockClear();

    // Wait well past the old idle delay — rotation should NOT resume
    vi.advanceTimersByTime(5000);
    vi.advanceTimersByTime(32);

    expect(sceneObject.rotation.y).toBe(0);
    expect(sceneObject.position.length()).toBe(0);
  });

  it('does not reposition the scene on engine tick after clicking a node', async () => {
    render(
      <Graph3D
        data={graph}
        source="api"
        query=""
        hoveredNode={null}
        onHoverNode={vi.fn()}
      />,
    );

    vi.advanceTimersByTime(200);

    await act(async () => {
      await getLatestGraphProps().onNodeClick(graph.nodes[0]);
    });

    vi.advanceTimersByTime(1300);

    sceneObject.rotation.set(0, 0, 0);
    sceneObject.position.set(0, 0, 0);

    act(() => {
      getLatestGraphProps().onEngineTick();
    });

    // Engine tick should not reposition the scene after a node click
    expect(sceneObject.rotation.y).toBe(0);
    expect(sceneObject.position.length()).toBe(0);
  });

  it('rotates the scene on pointer drag without moving the camera', () => {
    const { container } = render(
      <Graph3D
        data={graph}
        source="api"
        query=""
        hoveredNode={null}
        onHoverNode={vi.fn()}
      />,
    );

    vi.advanceTimersByTime(200);

    const root = container.firstChild as HTMLElement;
    const callCountBeforeDrag = cameraPosition.mock.calls.length;

    fireEvent.mouseDown(root, {
      button: 0,
      buttons: 1,
      clientX: 100,
      clientY: 120,
    });
    fireEvent.mouseMove(root, {
      buttons: 1,
      clientX: 140,
      clientY: 90,
    });
    fireEvent.mouseUp(root, { button: 0 });

    expect(sceneObject.rotation.x).not.toBe(0);
    expect(sceneObject.rotation.y).not.toBe(0);
    expect(cameraPosition.mock.calls.length).toBe(callCountBeforeDrag);
  });

  it('clicking a node repositions the scene so the node is centered and flies the camera', async () => {
    render(
      <Graph3D
        data={graph}
        source="api"
        query=""
        hoveredNode={null}
        onHoverNode={vi.fn()}
      />,
    );

    vi.advanceTimersByTime(200);
    cameraPosition.mockClear();

    await act(async () => {
      await getLatestGraphProps().onNodeClick(graph.nodes[0]);
    });

    vi.advanceTimersByTime(1300);

    // Camera should have moved, and the clicked node should now be at world origin
    expect(cameraPosition).toHaveBeenCalled();
    sceneObject.updateMatrixWorld(true);
    const nodeWorld = sceneObject.localToWorld(
      new THREE.Vector3(
        graph.nodes[0].x ?? 0,
        graph.nodes[0].y ?? 0,
        graph.nodes[0].z ?? 0,
      ),
    );
    expect(nodeWorld.x).toBeCloseTo(0, 1);
    expect(nodeWorld.y).toBeCloseTo(0, 1);
    expect(nodeWorld.z).toBeCloseTo(0, 1);
  });

  it('does not snap the scene to the next node before the node-to-node fly animation completes', async () => {
    render(
      <Graph3D
        data={graph}
        source="api"
        query=""
        hoveredNode={null}
        onHoverNode={vi.fn()}
      />,
    );

    vi.advanceTimersByTime(200);

    await act(async () => {
      await getLatestGraphProps().onNodeClick(graph.nodes[0]);
    });

    vi.advanceTimersByTime(1300);

    await act(async () => {
      await getLatestGraphProps().onNodeClick(graph.nodes[1]);
    });

    sceneObject.updateMatrixWorld(true);
    const secondNodeWorldBeforeAnimation = sceneObject.localToWorld(
      new THREE.Vector3(
        graph.nodes[1].x ?? 0,
        graph.nodes[1].y ?? 0,
        graph.nodes[1].z ?? 0,
      ),
    );

    expect(secondNodeWorldBeforeAnimation.x).not.toBeCloseTo(0, 1);

    vi.advanceTimersByTime(1300);

    sceneObject.updateMatrixWorld(true);
    const secondNodeWorldAfterAnimation = sceneObject.localToWorld(
      new THREE.Vector3(
        graph.nodes[1].x ?? 0,
        graph.nodes[1].y ?? 0,
        graph.nodes[1].z ?? 0,
      ),
    );

    expect(secondNodeWorldAfterAnimation.x).toBeCloseTo(0, 1);
    expect(secondNodeWorldAfterAnimation.y).toBeCloseTo(0, 1);
    expect(secondNodeWorldAfterAnimation.z).toBeCloseTo(0, 1);
  });

  it('does not rotate the scene on right-button drag', () => {
    const { container } = render(
      <Graph3D
        data={graph}
        source="api"
        query=""
        hoveredNode={null}
        onHoverNode={vi.fn()}
      />,
    );

    vi.advanceTimersByTime(200);
    sceneObject.rotation.set(0, 0, 0);
    sceneObject.updateMatrixWorld(true);

    const root = container.firstChild as HTMLElement;

    fireEvent.mouseDown(root, {
      button: 2,
      buttons: 2,
      clientX: 100,
      clientY: 120,
    });
    fireEvent.mouseMove(root, {
      buttons: 2,
      clientX: 140,
      clientY: 90,
    });
    fireEvent.mouseUp(root, { button: 2 });

    expect(sceneObject.rotation.x).toBe(0);
    expect(sceneObject.rotation.y).toBe(0);
  });

  it('re-centers the home view when the graph panel size changes', () => {
    render(
      <Graph3D
        data={graph}
        source="api"
        query=""
        hoveredNode={null}
        onHoverNode={vi.fn()}
      />,
    );

    vi.advanceTimersByTime(200);
    cameraPosition.mockClear();

    act(() => {
      resizeObserverCallback?.([{ contentRect: { width: 1200, height: 760 } }]);
    });

    vi.advanceTimersByTime(1300);
    const callsAfterFirstResize = cameraPosition.mock.calls.length;

    act(() => {
      resizeObserverCallback?.([{ contentRect: { width: 900, height: 760 } }]);
    });

    vi.advanceTimersByTime(1300);

    expect(callsAfterFirstResize).toBeGreaterThan(0);
    expect((graphPropsSpy.mock.calls.at(-1)?.[0] as {
      width: number;
      height: number;
    }).width).toBe(900);
    expect((graphPropsSpy.mock.calls.at(-1)?.[0] as {
      width: number;
      height: number;
    }).height).toBe(760);
    expect(cameraPosition.mock.calls.length).toBeGreaterThan(callsAfterFirstResize);
    expect(cameraPosition).toHaveBeenLastCalledWith(
      expect.objectContaining({
        x: 0,
        y: expect.closeTo(52, 2),
        z: expect.closeTo(650, 0),
      }),
      expect.objectContaining({
        x: 0,
        y: 0,
        z: 0,
      }),
    );
  });

  it('highlights connected neighbors while dimming unrelated nodes on hover', () => {
    render(
      <Graph3D
        data={graph}
        source="api"
        query=""
        hoveredNode={hoveredNode}
        onHoverNode={vi.fn()}
      />,
    );

    const props = graphPropsSpy.mock.calls.at(-1)?.[0] as {
      nodeColor: (node: GraphNode) => string;
    };

    expect(props.nodeColor(graph.nodes[0])).toBe('#3b82f6');
    expect(props.nodeColor(graph.nodes[1])).toBe('#3b82f6');
    expect(props.nodeColor({
      id: 'project:BrainBank',
      type: 'Project',
      name: 'BrainBank',
    })).toBe('rgba(148, 163, 184, 0.2)');
  });

  it('applies assistant-response graph focus with lit source nodes, gold-outlined discovery nodes, and hidden unrelated labels', () => {
    render(
      <Graph3D
        data={graph}
        source="api"
        query=""
        hoveredNode={null}
        onHoverNode={vi.fn()}
        chatFocus={{
          sourceConcepts: ['Calculus'],
          discoveryConcepts: ['Derivatives'],
        }}
      />,
    );

    const props = getLatestGraphProps();

    expect(props.nodeColor(graph.nodes[0])).toBe('#3b82f6');
    expect(props.nodeColor(graph.nodes[1])).toBe('rgba(71, 85, 105, 0.35)');
    expect(props.nodeColor(graph.nodes[2])).toBe('rgba(71, 85, 105, 0.35)');

    const discoveryObject = props.nodeThreeObject(graph.nodes[1]);
    const unrelatedObject = props.nodeThreeObject(graph.nodes[2]);

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    const discoveryOutline = discoveryObject?.getObjectByName('node-outline') as THREE.Mesh | undefined;
    const unrelatedLabel = unrelatedObject?.children.find((child) => child instanceof THREE.Sprite) as
      | THREE.Sprite
      | undefined;

    expect(discoveryOutline).toBeDefined();
    expect((discoveryOutline?.material as THREE.MeshBasicMaterial).opacity).toBeGreaterThan(0.5);
    expect(unrelatedLabel?.material.opacity).toBeLessThan(0.01);
  });

  it('renders zoom controls and uses them', () => {
    const { container } = render(
      <Graph3D
        data={graph}
        source="api"
        query=""
        hoveredNode={null}
        onHoverNode={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '+' }));
    vi.advanceTimersByTime(1300);
    fireEvent.click(screen.getByRole('button', { name: '−' }));
    vi.advanceTimersByTime(1300);
    fireEvent.click(screen.getByRole('button', { name: '⟳' }));
    vi.advanceTimersByTime(1300);

    expect(container.querySelector('.absolute.top-4.right-4.flex.flex-col.gap-2')).not.toBeNull();
    expect(cameraPosition).toHaveBeenCalled();
    // ⟳ resets to brain home view
    expect(cameraPosition).toHaveBeenLastCalledWith(
      expect.objectContaining({
        x: 0,
        y: expect.closeTo(52, 2),
        z: expect.closeTo(650, 0),
      }),
      expect.objectContaining({
        x: 0,
        y: 0,
        z: 0,
      }),
    );
  });

  it('zooms in and out with the scroll wheel', () => {
    const { container } = render(
      <Graph3D
        data={graph}
        source="api"
        query=""
        hoveredNode={null}
        onHoverNode={vi.fn()}
      />,
    );

    vi.advanceTimersByTime(200);
    cameraPosition.mockClear();
    currentCameraPosition = { x: 0, y: 52, z: 650 };

    const root = container.firstChild as HTMLElement;

    fireEvent.wheel(root, { deltaY: -120 });
    vi.advanceTimersByTime(500);

    expect(cameraPosition).toHaveBeenLastCalledWith(
      expect.objectContaining({
        x: 0,
        y: expect.closeTo(46.8, 3),
        z: expect.closeTo(585, 3),
      }),
      expect.objectContaining({ x: 0, y: 0, z: 0 }),
    );

    fireEvent.wheel(root, { deltaY: 120 });
    vi.advanceTimersByTime(500);

    expect(cameraPosition).toHaveBeenLastCalledWith(
      expect.objectContaining({
        x: 0,
        y: expect.closeTo(56.16, 3),
        z: expect.closeTo(702, 3),
      }),
      expect.objectContaining({ x: 0, y: 0, z: 0 }),
    );
  });

  it('always allows scroll wheel zoom since overlay is no longer rendered internally', () => {
    const { container } = render(
      <Graph3D
        data={graph}
        source="api"
        query=""
        hoveredNode={null}
        onHoverNode={vi.fn()}
      />,
    );

    vi.advanceTimersByTime(200);
    cameraPosition.mockClear();
    currentCameraPosition = { x: 0, y: 52, z: 650 };

    fireEvent.wheel(container.firstChild as HTMLElement, { deltaY: -120 });
    vi.advanceTimersByTime(500);

    expect(cameraPosition).toHaveBeenCalled();
  });

  it('increases link hover precision so edges are easier to click', () => {
    render(
      <Graph3D
        data={graph}
        source="api"
        query=""
        hoveredNode={null}
        onHoverNode={vi.fn()}
      />,
    );

    const props = graphPropsSpy.mock.calls.at(-1)?.[0] as {
      linkHoverPrecision: number;
    };

    expect(props.linkHoverPrecision).toBeGreaterThanOrEqual(8);
  });

  it('keeps edges visually subdued so the neuron models remain the focus', () => {
    render(
      <Graph3D
        data={graph}
        source="api"
        query=""
        hoveredNode={null}
        onHoverNode={vi.fn()}
      />,
    );

    expect(getLatestGraphProps().linkOpacity).toBeCloseTo(0.55, 6);
  });

  it('renders unhighlighted edges as a softer bluish white', () => {
    render(
      <Graph3D
        data={graph}
        source="api"
        query=""
        hoveredNode={null}
        onHoverNode={vi.fn()}
      />,
    );

    const props = getLatestGraphProps();
    expect(props.linkColor(graph.links[0])).toBe('rgba(186, 224, 255, 0.34)');
  });

  it('shows a meaningful visual width difference between low and high weighted links', () => {
    render(
      <Graph3D
        data={graph}
        source="api"
        query=""
        hoveredNode={null}
        onHoverNode={vi.fn()}
      />,
    );

    const props = getLatestGraphProps();
    const low = props.linkWidth({ ...graph.links[0], weight: 1 });
    const high = props.linkWidth({ ...graph.links[0], weight: 6 });

    expect(high).toBeGreaterThan(low * 2);
  });
  it('renders edges as plain lines without directional particles', () => {
    render(
      <Graph3D
        data={graph}
        source="api"
        query=""
        hoveredNode={null}
        onHoverNode={vi.fn()}
      />,
    );

    const props = getLatestGraphProps();

    expect(props.linkDirectionalParticles).toBe(0);
    expect(props.linkDirectionalParticleWidth).toBeUndefined();
  });

  it('double-clicking a node focuses it', async () => {
    render(
      <Graph3D
        data={graph}
        source="api"
        query=""
        hoveredNode={null}
        onHoverNode={vi.fn()}
      />,
    );

    const props = graphPropsSpy.mock.calls.at(-1)?.[0] as {
      onNodeClick: (node: GraphNode) => void;
    };

    await act(async () => {
      props.onNodeClick(graph.nodes[1]);
      vi.advanceTimersByTime(100);
      props.onNodeClick(graph.nodes[1]);
      await Promise.resolve();
    });

    // Advance time so the self-managed rAF animation completes
    vi.advanceTimersByTime(1300);

    // Camera should have been animated to the node's world position
    const lastCall = cameraPosition.mock.calls.at(-1)!;
    expect(lastCall.length).toBeLessThanOrEqual(2);
    // lookAt should be at the node's world position
    expect(lastCall[1]).toEqual(
      expect.objectContaining({ x: expect.any(Number), y: expect.any(Number), z: expect.any(Number) }),
    );
  });

  it('clicking a node smoothly flies the camera to that node', async () => {
    render(
      <Graph3D
        data={graph}
        source="api"
        query=""
        hoveredNode={null}
        onHoverNode={vi.fn()}
      />,
    );

    vi.advanceTimersByTime(200);
    sceneObject.rotation.set(0, 0, 0);
    sceneObject.updateMatrixWorld(true);
    cameraPosition.mockClear();

    await act(async () => {
      getLatestGraphProps().onNodeClick(graph.nodes[1]);
    });

    // Advance time so the self-managed rAF animation completes
    vi.advanceTimersByTime(1300);

    // Camera should have been animated to the node's world-space position
    const lastCall = cameraPosition.mock.calls.at(-1)!;
    expect(lastCall.length).toBeLessThanOrEqual(2);
    // The lookAt target should be the node's world-space position
    const nodePos = graph.nodes[1];
    const lookAt = lastCall[1];
    const worldPos = sceneObject.localToWorld(
      new THREE.Vector3(nodePos.x ?? 0, nodePos.y ?? 0, nodePos.z ?? 0),
    );
    expect(lookAt).toBeDefined();
    expect(lookAt!.x).toBeCloseTo(worldPos.x, 2);
    expect(lookAt!.y).toBeCloseTo(worldPos.y, 2);
    expect(lookAt!.z).toBeCloseTo(worldPos.z, 2);
  });

  it('double-clicking empty space resets camera to the home view', async () => {
    render(
      <Graph3D
        data={graph}
        source="api"
        query=""
        hoveredNode={null}
        onHoverNode={vi.fn()}
      />,
    );

    vi.advanceTimersByTime(200);

    await act(async () => {
      await getLatestGraphProps().onNodeClick(graph.nodes[0]);
    });

    cameraPosition.mockClear();
    vi.advanceTimersByTime(301);

    fireEvent.doubleClick(screen.getByTestId('force-graph'));

    vi.advanceTimersByTime(1300);

    expect(cameraPosition).toHaveBeenCalled();
  });

  it('keeps the clicked node at world origin after scene repositioning', async () => {
    render(
      <Graph3D
        data={graph}
        source="api"
        query=""
        hoveredNode={null}
        onHoverNode={vi.fn()}
      />,
    );

    vi.advanceTimersByTime(200);

    await act(async () => {
      getLatestGraphProps().onNodeClick(graph.nodes[0]);
    });

    vi.advanceTimersByTime(1300);

    sceneObject.updateMatrixWorld(true);
    const nodeWorld = sceneObject.localToWorld(
      new THREE.Vector3(
        graph.nodes[0].x ?? 0,
        graph.nodes[0].y ?? 0,
        graph.nodes[0].z ?? 0,
      ),
    );

    // Clicked node is at world origin (centered on screen)
    expect(nodeWorld.x).toBeCloseTo(0, 1);
    expect(nodeWorld.y).toBeCloseTo(0, 1);
    expect(nodeWorld.z).toBeCloseTo(0, 1);
  });
  describe('Concept node document callbacks', () => {
    it('clicking a Document node does not fetch or call onOpenDocument', async () => {
      const onOpenDocument = vi.fn();
      render(
        <Graph3D
          data={graph}
          source="api"
          query=""
          hoveredNode={null}
          onHoverNode={vi.fn()}
          onOpenDocument={onOpenDocument}
        />,
      );
      const { onNodeClick } = graphPropsSpy.mock.calls.at(-1)?.[0] as {
        onNodeClick: (n: GraphNode) => void;
      };

      await act(async () => {
        onNodeClick(graph.nodes[2]); // Document node
      });

      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(onOpenDocument).not.toHaveBeenCalled();
    });

    it('double-clicking a Concept node fetches its documents from the API', async () => {
      render(
        <Graph3D
          data={graph}
          source="api"
          query=""
          hoveredNode={null}
          onHoverNode={vi.fn()}
        />,
      );
      const { onNodeClick } = graphPropsSpy.mock.calls.at(-1)?.[0] as {
        onNodeClick: (n: GraphNode) => void;
      };

      await act(async () => {
        onNodeClick(graph.nodes[0]); // first click
        vi.advanceTimersByTime(100);
        onNodeClick(graph.nodes[0]); // double click
        await Promise.resolve();
      });

      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/concepts/Calculus/documents',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it('double-clicking a Concept node injects doc sub-nodes into the graph', async () => {
      const mockDocs = [
        { doc_id: 'abc123', name: 'Math Notes', full_text: 'some content' },
        { doc_id: 'def456', name: 'Other Notes', full_text: 'other content' },
      ];
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockDocs),
      });

      render(
        <Graph3D
          data={graph}
          source="api"
          query=""
          hoveredNode={null}
          onHoverNode={vi.fn()}
        />,
      );
      const { onNodeClick } = graphPropsSpy.mock.calls.at(-1)?.[0] as {
        onNodeClick: (n: GraphNode) => void;
      };

      await act(async () => {
        onNodeClick(graph.nodes[0]); // first click
        vi.advanceTimersByTime(100);
        onNodeClick(graph.nodes[0]); // double click
        await Promise.resolve();
      });

      // Advance past the dive zoom-in animation so onComplete fires
      await act(async () => {
        vi.advanceTimersByTime(800);
        await Promise.resolve();
      });

      const latestData = getLatestGraphProps().graphData;
      expect(latestData.nodes.some((n: GraphNode) => n.id === 'doc-expand:abc123')).toBe(true);
      expect(latestData.nodes.some((n: GraphNode) => n.id === 'doc-expand:def456')).toBe(true);
    });

    it('single-clicking a Concept node does not call onOpenDocument', async () => {
      const onOpenDocument = vi.fn();
      render(
        <Graph3D
          data={graph}
          source="api"
          query=""
          hoveredNode={null}
          onHoverNode={vi.fn()}
          onOpenDocument={onOpenDocument}
        />,
      );
      const { onNodeClick } = graphPropsSpy.mock.calls.at(-1)?.[0] as {
        onNodeClick: (n: GraphNode) => void;
      };

      await act(async () => {
        onNodeClick(graph.nodes[0]); // single click only
      });

      expect(onOpenDocument).not.toHaveBeenCalled();
    });

    it('renders the hover tooltip as name plus connection count', async () => {
      render(
        <Graph3D
          data={graph}
          source="api"
          query=""
          hoveredNode={hoveredNode}
          onHoverNode={vi.fn()}
        />,
      );

      await act(async () => {
        vi.advanceTimersByTime(16);
      });

      expect(screen.getByText('Calculus (2)')).toBeInTheDocument();
      expect(screen.queryByText('Concept')).not.toBeInTheDocument();
      expect(screen.queryByText('2 connections')).not.toBeInTheDocument();
    });

    it('disables the force-graph cursor-following node label', () => {
      render(
        <Graph3D
          data={graph}
          source="api"
          query=""
          hoveredNode={hoveredNode}
          onHoverNode={vi.fn()}
        />,
      );

      const nodeLabel = getLatestGraphProps().nodeLabel;

      expect(nodeLabel).toBeTypeOf('function');
      expect(nodeLabel?.(graph.nodes[0])).toBeNull();
    });

    it('hides the hovered node sprite label while keeping other node labels visible', async () => {
      render(
        <Graph3D
          data={graph}
          source="api"
          query=""
          hoveredNode={hoveredNode}
          onHoverNode={vi.fn()}
        />,
      );

      const props = getLatestGraphProps();
      const hoveredObject = props.nodeThreeObject(graph.nodes[0]);
      const relatedObject = props.nodeThreeObject(graph.nodes[1]);
      const hoveredLabel = hoveredObject?.children.find((child) => child instanceof THREE.Sprite) as
        | THREE.Sprite
        | undefined;
      const relatedLabel = relatedObject?.children.find((child) => child instanceof THREE.Sprite) as
        | THREE.Sprite
        | undefined;

      await act(async () => {
        vi.advanceTimersByTime(1000);
      });

      expect(hoveredLabel).toBeDefined();
      expect(relatedLabel).toBeDefined();
      expect((hoveredLabel?.material as THREE.SpriteMaterial).opacity).toBeLessThan(0.01);
      expect((relatedLabel?.material as THREE.SpriteMaterial).opacity).toBeGreaterThan(0.9);
    });

    it('single-clicking a Concept node does not pin a node card', async () => {
      render(
        <Graph3D
          data={graph}
          source="api"
          query=""
          hoveredNode={null}
          onHoverNode={vi.fn()}
        />,
      );
      const { onNodeClick } = graphPropsSpy.mock.calls.at(-1)?.[0] as {
        onNodeClick: (n: GraphNode) => void;
      };

      await act(async () => {
        onNodeClick(graph.nodes[0]);
      });

      await act(async () => {
        vi.advanceTimersByTime(16);
      });

      expect(screen.queryByText('Calculus (2)')).not.toBeInTheDocument();
      expect(screen.queryByText('Calculus')).not.toBeInTheDocument();
    });

    it('falls back to mock documents when the API returns empty and injects doc sub-nodes', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([]),
      });

      render(
        <Graph3D
          data={graph}
          source="api"
          query=""
          hoveredNode={null}
          onHoverNode={vi.fn()}
        />,
      );
      const { onNodeClick } = graphPropsSpy.mock.calls.at(-1)?.[0] as {
        onNodeClick: (n: GraphNode) => void;
      };

      await act(async () => {
        onNodeClick(graph.nodes[0]); // first click
        vi.advanceTimersByTime(100);
        onNodeClick(graph.nodes[0]); // double click
        await Promise.resolve();
      });

      // Advance past the dive zoom-in animation so onComplete fires
      await act(async () => {
        vi.advanceTimersByTime(800);
        await Promise.resolve();
      });

      // API returned empty so mock fallback docs appear as sub-nodes
      const latestData = getLatestGraphProps().graphData;
      const docExpandNodes = latestData.nodes.filter((n: GraphNode) => n.id.startsWith('doc-expand:'));
      expect(docExpandNodes.length).toBeGreaterThan(0);
    });

    it('does not render ConceptDocumentOverlay after double-clicking a concept', async () => {
      render(
        <Graph3D
          data={graph}
          source="api"
          query=""
          hoveredNode={null}
          onHoverNode={vi.fn()}
        />,
      );
      const { onNodeClick } = graphPropsSpy.mock.calls.at(-1)?.[0] as {
        onNodeClick: (n: GraphNode) => void;
      };

      await act(async () => {
        onNodeClick(graph.nodes[0]); // first click
        vi.advanceTimersByTime(100);
        onNodeClick(graph.nodes[0]); // double click
        await Promise.resolve();
      });

      // Advance past the dive zoom-in animation
      await act(async () => {
        vi.advanceTimersByTime(800);
        await Promise.resolve();
      });

      // ConceptDocumentOverlay used to render a heading with concept name
      // and a "Back to graph (Esc)" button - neither should exist now
      expect(screen.queryByRole('button', { name: /back to graph/i })).toBeNull();
    });

    it('double-clicking a doc-expand node opens the document in a tab', async () => {
      const mockDocs = [
        { doc_id: 'abc123', name: 'Math Notes', full_text: 'some content' },
        { doc_id: 'def456', name: 'Other Notes', full_text: 'other content' },
      ];
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockDocs),
      });
      const onOpenDocument = vi.fn();

      render(
        <Graph3D
          data={graph}
          source="api"
          query=""
          hoveredNode={null}
          onHoverNode={vi.fn()}
          onOpenDocument={onOpenDocument}
        />,
      );

      // First: double-click concept to expand it and inject doc sub-nodes
      let onNodeClick = (graphPropsSpy.mock.calls.at(-1)?.[0] as {
        onNodeClick: (n: GraphNode) => void;
      }).onNodeClick;

      await act(async () => {
        onNodeClick(graph.nodes[0]); // first click
        vi.advanceTimersByTime(100);
        onNodeClick(graph.nodes[0]); // double click — expands concept
        await Promise.resolve();
      });

      // Advance past the dive zoom-in animation so onComplete fires
      await act(async () => {
        vi.advanceTimersByTime(800);
        await Promise.resolve();
      });

      // Get the doc-expand node from the latest graph data
      const latestData = getLatestGraphProps().graphData;
      const docExpandNode = latestData.nodes.find(
        (n: GraphNode) => n.id === 'doc-expand:abc123',
      );
      expect(docExpandNode).toBeDefined();

      // Now double-click the doc-expand node to open it
      onNodeClick = (graphPropsSpy.mock.calls.at(-1)?.[0] as {
        onNodeClick: (n: GraphNode) => void;
      }).onNodeClick;

      await act(async () => {
        onNodeClick(docExpandNode!); // first click
        vi.advanceTimersByTime(100);
        onNodeClick(docExpandNode!); // double click — opens document
      });

      expect(onOpenDocument).toHaveBeenCalledWith('abc123', 'Math Notes', 'some content');
    });
  });

  describe('onConceptFocused callback', () => {
    it('calls onConceptFocused with the concept name when a concept node is clicked', async () => {
      const onConceptFocused = vi.fn();
      render(
        <Graph3D
          data={graph}
          source="api"
          query=""
          hoveredNode={null}
          onHoverNode={vi.fn()}
          onConceptFocused={onConceptFocused}
        />,
      );

      await act(async () => {
        getLatestGraphProps().onNodeClick(graph.nodes[0]); // concept:Calculus
      });

      expect(onConceptFocused).toHaveBeenCalledWith('Calculus');
    });

    it('calls onConceptFocused with null when focus is cleared', async () => {
      const onConceptFocused = vi.fn();
      render(
        <Graph3D
          data={graph}
          source="api"
          query=""
          hoveredNode={null}
          onHoverNode={vi.fn()}
          onConceptFocused={onConceptFocused}
        />,
      );

      await act(async () => {
        getLatestGraphProps().onNodeClick(graph.nodes[0]);
      });

      onConceptFocused.mockClear();

      // Advance past the double-click suppression window
      vi.advanceTimersByTime(400);

      // Click background to clear
      const { onBackgroundClick } = graphPropsSpy.mock.calls.at(-1)?.[0] as {
        onBackgroundClick: () => void;
      };
      act(() => {
        onBackgroundClick();
      });

      expect(onConceptFocused).toHaveBeenCalledWith(null);
    });

    it('calls onConceptFocused with null for non-concept nodes', async () => {
      const onConceptFocused = vi.fn();
      render(
        <Graph3D
          data={graph}
          source="api"
          query=""
          hoveredNode={null}
          onHoverNode={vi.fn()}
          onConceptFocused={onConceptFocused}
        />,
      );

      await act(async () => {
        getLatestGraphProps().onNodeClick(graph.nodes[2]); // doc:abc-123
      });

      // Non-concept nodes: the node id "doc:abc-123" does not start with "concept:"
      // so onConceptFocused should be called with null
      expect(onConceptFocused).toHaveBeenCalledWith(null);
    });
  });

  it('keeps simulated nodes inside the brain containment volume', () => {
    render(
      <Graph3D
        data={graph}
        source="api"
        query=""
        hoveredNode={null}
        onHoverNode={vi.fn()}
      />,
    );

    const props = graphPropsSpy.mock.calls.at(-1)?.[0] as {
      graphData: GraphData;
      onEngineTick: () => void;
    };
    const outsideNode = props.graphData.nodes[0];
    outsideNode.x = 250;
    outsideNode.y = 210;
    outsideNode.z = 180;
    outsideNode.fx = 250;
    outsideNode.fy = 210;
    outsideNode.fz = 180;

    props.onEngineTick();

    expect(
      isNodeInsideContainment(
        outsideNode,
        createBrainContainment(
          new THREE.Mesh(
            new THREE.SphereGeometry(170, 8, 8),
            new THREE.MeshBasicMaterial(),
          ),
        ),
      ),
    ).toBe(true);
  });

  it('clicking a RELATED_TO edge opens the detail panel', async () => {
    render(
      <Graph3D
        data={graph}
        source="api"
        query=""
        hoveredNode={null}
        onHoverNode={vi.fn()}
      />,
    );

    const props = graphPropsSpy.mock.calls.at(-1)?.[0] as {
      onLinkClick: (link: GraphLink) => Promise<void> | void;
    };

    await act(async () => {
      await props.onLinkClick(graph.links[0]);
    });

    expect(screen.getByText('Derivatives are a core tool within calculus')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      '/api/relationships/details?source=Calculus&target=Derivatives',
      expect.any(Object),
    );
  });

  it('clicking a MENTIONS edge opens the detail panel with its connection type', async () => {
    render(
      <Graph3D
        data={graph}
        source="api"
        query=""
        hoveredNode={null}
        onHoverNode={vi.fn()}
      />,
    );

    const props = graphPropsSpy.mock.calls.at(-1)?.[0] as {
      onLinkClick: (link: GraphLink) => Promise<void> | void;
    };

    await act(async () => {
      await props.onLinkClick(graph.links[1]);
    });

    expect(screen.getByText('MENTIONS')).toBeInTheDocument();
    expect(screen.getByText('Math Notes to Calculus')).toBeInTheDocument();
    expect(screen.getByText('MENTIONS connection')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('clicking a node persists highlight on its adjacent edges until focus changes', async () => {
    render(
      <Graph3D
        data={graph}
        source="api"
        query=""
        hoveredNode={null}
        onHoverNode={vi.fn()}
      />,
    );

    vi.advanceTimersByTime(200);

    await act(async () => {
      getLatestGraphProps().onNodeClick(graph.nodes[0]);
    });

    const focusedProps = getLatestGraphProps();

    expect(focusedProps.linkColor(graph.links[0])).toBe('rgba(125, 211, 252, 0.9)');
    expect(focusedProps.linkColor(graph.links[1])).toBe('rgba(125, 211, 252, 0.9)');
    expect(focusedProps.linkWidth(graph.links[0])).toBeCloseTo(Math.log((1 + 1)) * 2.2, 6);
    expect(focusedProps.linkWidth(graph.links[1])).toBeCloseTo(Math.log((1 + 1)) * 2.2, 6);

    await act(async () => {
      getLatestGraphProps().onNodeClick(graph.nodes[1]);
    });

    const refocusedProps = getLatestGraphProps();

    expect(refocusedProps.linkColor(graph.links[0])).toBe('rgba(125, 211, 252, 0.9)');
    expect(refocusedProps.linkColor(graph.links[1])).toBe('rgba(51, 65, 85, 0.22)');
    expect(refocusedProps.linkWidth(graph.links[0])).toBeCloseTo(Math.log((1 + 1)) * 2.2, 6);
    expect(refocusedProps.linkWidth(graph.links[1])).toBeCloseTo(Math.log((1 + 1)) * 2.2, 6);
  });

  it('selected edge styling takes precedence over hover styling', async () => {
    render(
      <Graph3D
        data={graph}
        source="api"
        query=""
        hoveredNode={graph.nodes[2]}
        onHoverNode={vi.fn()}
      />,
    );

    const initialProps = graphPropsSpy.mock.calls.at(-1)?.[0] as {
      onLinkClick: (link: GraphLink) => Promise<void> | void;
      linkColor: (link: GraphLink) => string;
      linkWidth: (link: GraphLink) => number;
    };

    await act(async () => {
      await initialProps.onLinkClick(graph.links[0]);
    });
    expect(screen.getByText('Derivative Rules')).toBeInTheDocument();

    const selectedProps = graphPropsSpy.mock.calls.at(-1)?.[0] as {
      linkColor: (link: GraphLink) => string;
      linkWidth: (link: GraphLink) => number;
    };

    expect(selectedProps.linkColor(graph.links[0])).toBe('rgba(125, 211, 252, 0.9)');
    expect(selectedProps.linkWidth(graph.links[0])).toBeCloseTo(Math.log((1 + 1)) * 2.2, 6);
    expect(selectedProps.linkWidth(graph.links[1])).toBeCloseTo(Math.log((1 + 1)) * 2.2, 6);
  });

  it('closing the panel clears selected edge state', async () => {
    render(
      <Graph3D
        data={graph}
        source="api"
        query=""
        hoveredNode={null}
        onHoverNode={vi.fn()}
      />,
    );

    const props = graphPropsSpy.mock.calls.at(-1)?.[0] as {
      onLinkClick: (link: GraphLink) => Promise<void> | void;
    };

    await act(async () => {
      await props.onLinkClick(graph.links[0]);
    });
    expect(screen.getByText('Derivative Rules')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close relationship details' }));

    expect(screen.queryByText('Derivative Rules')).not.toBeInTheDocument();

    const clearedProps = graphPropsSpy.mock.calls.at(-1)?.[0] as {
      linkWidth: (link: GraphLink) => number;
    };

    expect(clearedProps.linkWidth(graph.links[0])).toBeCloseTo(Math.log((1 + 1)) * 2.2, 6);
  });

  it('pressing Escape clears selected edge state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => relationshipDetails,
      }),
    );

    render(
      <Graph3D
        data={graph}
        source="api"
        query=""
        hoveredNode={null}
        onHoverNode={vi.fn()}
      />,
    );

    const props = graphPropsSpy.mock.calls.at(-1)?.[0] as {
      onLinkClick: (link: GraphLink) => Promise<void> | void;
    };

    await act(async () => {
      await props.onLinkClick(graph.links[0]);
    });
    expect(screen.getByText('Derivative Rules')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByText('Derivative Rules')).not.toBeInTheDocument();

    const clearedProps = graphPropsSpy.mock.calls.at(-1)?.[0] as {
      linkWidth: (link: GraphLink) => number;
    };

    expect(clearedProps.linkWidth(graph.links[0])).toBeCloseTo(Math.log((1 + 1)) * 2.2, 6);
  });

  it('pressing Escape resets camera to the home view', async () => {
    render(
      <Graph3D
        data={graph}
        source="api"
        query=""
        hoveredNode={null}
        onHoverNode={vi.fn()}
      />,
    );

    vi.advanceTimersByTime(200);

    await act(async () => {
      await getLatestGraphProps().onNodeClick(graph.nodes[0]);
    });

    cameraPosition.mockClear();

    fireEvent.keyDown(window, { key: 'Escape' });

    vi.advanceTimersByTime(1300);

    expect(cameraPosition).toHaveBeenCalled();
  });

  it('uses bundled relationship details when the graph is in mock mode', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', mockFetch);

    render(
      <Graph3D
        data={graph}
        source="mock"
        query=""
        hoveredNode={null}
        onHoverNode={vi.fn()}
      />,
    );

    const props = graphPropsSpy.mock.calls.at(-1)?.[0] as {
      onLinkClick: (link: GraphLink) => Promise<void> | void;
    };

    await act(async () => {
      await props.onLinkClick(graph.links[0]);
    });

    expect(screen.getByText('Derivatives are the central tool of differential calculus, measuring instantaneous rates of change')).toBeInTheDocument();
    expect(screen.getByText('Limits and Continuity Review')).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it('uses weighted link width scaling for established edges', () => {
    render(
      <Graph3D
        data={graph}
        source="api"
        query=""
        hoveredNode={null}
        onHoverNode={vi.fn()}
      />,
    );

    const props = getLatestGraphProps();
    expect(props.linkWidth({ ...graph.links[0], weight: 8 })).toBeCloseTo(Math.log(9) * 2.2, 6);
  });

  it('injects latent ghost links on concept click and hides them when discovery mode is off', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

        if (url.includes('/api/discovery/latent/Calculus')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              concept_name: 'Calculus',
              results: [{ doc_name: 'Latent Doc', similarity_score: 0.87 }],
            }),
          });
        }

        return Promise.resolve({ ok: true, json: async () => [] });
      }),
    );

    render(
      <Graph3D
        data={graph}
        source="api"
        query=""
        hoveredNode={null}
        onHoverNode={vi.fn()}
      />,
    );

    await act(async () => {
      await getLatestGraphProps().onNodeClick(graph.nodes[0]);
    });

    const withGhost = getLatestGraphProps();
    const ghostLink = withGhost.graphData.links.find((link) => link.type === 'LATENT_DISCOVERY');

    expect(ghostLink).toBeTruthy();
    if (ghostLink) {
      expect(withGhost.linkLineDash?.(ghostLink)).toEqual([2, 1]);
      expect(withGhost.linkWidth(ghostLink)).toBeCloseTo(0.55, 6);
    }

    fireEvent.click(screen.getByLabelText('Discovery mode'));

    const withoutGhost = getLatestGraphProps();
    expect(withoutGhost.graphData.links.some((link) => link.type === 'LATENT_DISCOVERY')).toBe(false);
  });
});
