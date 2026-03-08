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
    //   centeredBrain.sphere.radius ≈ 162.5, distance = max(162.5 * 2.6, 240) = 422.5
    //   orbitTarget ≈ {x:0, y:0, z:0} after centering
    //   camera.y = target.y + distance * 0.08 ≈ 33.8
    expect(cameraPosition).toHaveBeenLastCalledWith(
      expect.objectContaining({
        x: 0,
        y: expect.closeTo(33.8, 2),
        z: 422.5,
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

  it('pins nodes to fixed layout anchors so every neuron has a stable hardcoded position', () => {
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
    const mathNotes = renderedNodes.find((node) => node.id === 'doc:abc-123');

    expect(calculus).toEqual(
      expect.objectContaining({
        id: 'concept:Calculus',
        x: 0,
        y: 30.9,
        z: 0,
        fx: 0,
        fy: 30.9,
        fz: 0,
      }),
    );
    expect(derivatives).toEqual(
      expect.objectContaining({
        id: 'concept:Derivatives',
        x: -39.9,
        y: 8.5,
        z: -31.6,
        fx: -39.9,
        fy: 8.5,
        fz: -31.6,
      }),
    );
    expect(mathNotes).toEqual(
      expect.objectContaining({
        id: 'doc:abc-123',
        x: 4.5,
        y: -20.5,
        z: 44.1,
        fx: 4.5,
        fy: -20.5,
        fz: 44.1,
      }),
    );
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
        y: expect.closeTo(33.8, 2),
        z: 422.5,
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

  it('left-drag rotation uses the focused concept node as the pivot', async () => {
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

    await act(async () => {
      await getLatestGraphProps().onNodeClick(graph.nodes[0]);
    });

    sceneObject.rotation.set(0, 0, 0);
    sceneObject.position.set(0, 0, 0);
    cameraPosition.mockClear();

    const root = container.firstChild as HTMLElement;
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
    sceneObject.updateMatrixWorld(true);

    const pivotWorld = sceneObject.localToWorld(
      new THREE.Vector3(
        graph.nodes[0].x ?? 0,
        graph.nodes[0].y ?? 0,
        graph.nodes[0].z ?? 0,
      ),
    );

    expect(sceneObject.rotation.x).not.toBe(0);
    expect(sceneObject.rotation.y).not.toBe(0);
    expect(sceneObject.position.length()).toBeGreaterThan(0);
    expect(pivotWorld.x).toBeCloseTo(0, 3);
    expect(pivotWorld.y).toBeCloseTo(0, 3);
    expect(pivotWorld.z).toBeCloseTo(0, 3);
    expect(cameraPosition).not.toHaveBeenCalled();
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
        y: expect.closeTo(33.8, 2),
        z: 422.5,
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
        y: expect.closeTo(33.8, 2),
        z: 422.5,
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
    currentCameraPosition = { x: 0, y: 33.8, z: 422.5 };

    const root = container.firstChild as HTMLElement;

    fireEvent.wheel(root, { deltaY: -120 });
    vi.advanceTimersByTime(500);

    expect(cameraPosition).toHaveBeenLastCalledWith(
      expect.objectContaining({
        x: 0,
        y: expect.closeTo(30.42, 3),
        z: expect.closeTo(380.25, 3),
      }),
      expect.objectContaining({ x: 0, y: 0, z: 0 }),
    );

    fireEvent.wheel(root, { deltaY: 120 });
    vi.advanceTimersByTime(500);

    expect(cameraPosition).toHaveBeenLastCalledWith(
      expect.objectContaining({
        x: 0,
        y: expect.closeTo(36.504, 3),
        z: expect.closeTo(456.3, 3),
      }),
      expect.objectContaining({ x: 0, y: 0, z: 0 }),
    );
  });

  it('does not zoom with the scroll wheel while the document overlay is open', async () => {
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

    const { onNodeClick } = graphPropsSpy.mock.calls.at(-1)?.[0] as {
      onNodeClick: (node: GraphNode) => void;
    };

    await act(async () => {
      onNodeClick(graph.nodes[0]); // first click
      vi.advanceTimersByTime(100);
      onNodeClick(graph.nodes[0]); // double click — opens overlay
      await Promise.resolve();
    });

    cameraPosition.mockClear();
    fireEvent.wheel(container.firstChild as HTMLElement, { deltaY: -120 });

    expect(cameraPosition).not.toHaveBeenCalled();
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

  it('makes edges slightly more opaque so the click targets are easier to see', () => {
    render(
      <Graph3D
        data={graph}
        source="api"
        query=""
        hoveredNode={null}
        onHoverNode={vi.fn()}
      />,
    );

    expect(getLatestGraphProps().linkOpacity).toBeGreaterThan(0.7);
  });

  it('renders unhighlighted edges as translucent bluish white for baseline visibility', () => {
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
    expect(props.linkColor(graph.links[0])).toBe('rgba(186, 224, 255, 0.52)');
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

  it('double-clicking empty space resets node-focused rotation back to the home view', async () => {
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

    await act(async () => {
      await getLatestGraphProps().onNodeClick(graph.nodes[0]);
    });

    sceneObject.rotation.order = 'YXZ';
    sceneObject.rotation.y = 0.5;
    sceneObject.position.set(6, 0, 4);
    sceneObject.updateMatrixWorld(true);
    cameraPosition.mockClear();
    vi.advanceTimersByTime(301);

    fireEvent.doubleClick(screen.getByTestId('force-graph'));

    vi.advanceTimersByTime(1300);

    // After reset the scene is nearly zeroed; small idle rotation may have resumed
    expect(sceneObject.rotation.x).toBeCloseTo(0, 1);
    expect(sceneObject.rotation.y).toBeCloseTo(0, 1);
    expect(sceneObject.position.length()).toBeCloseTo(0, 1);
    expect(cameraPosition).toHaveBeenLastCalledWith(
      expect.objectContaining({
        x: 0,
        y: expect.closeTo(33.8, 2),
        z: 422.5,
      }),
      expect.objectContaining({
        x: 0,
        y: 0,
        z: 0,
      }),
    );
  });

  it('keeps the clicked node centered while rotating the scene', async () => {
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

    await act(async () => {
      getLatestGraphProps().onNodeClick(graph.nodes[0]);
    });

    const root = container.firstChild as HTMLElement;

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

    const centeredPoint = sceneObject.localToWorld(
      new THREE.Vector3(
        graph.nodes[0].x ?? 0,
        graph.nodes[0].y ?? 0,
        graph.nodes[0].z ?? 0,
      ),
    );

    expect(centeredPoint.x).toBeCloseTo(0, 4);
    expect(centeredPoint.y).toBeCloseTo(0, 4);
    expect(centeredPoint.z).toBeCloseTo(0, 4);
  });
  describe('Concept node document expansion', () => {
    it('clicking a Document node is a no-op and does not fetch', async () => {
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
        onNodeClick(graph.nodes[2]); // Document node
      });

      expect(globalThis.fetch).not.toHaveBeenCalled();
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

    it('double-clicking a Concept node opens the expansion overlay', async () => {
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

      expect(screen.getByRole('heading', { name: 'Calculus' })).toBeTruthy();
    });

    it('single-clicking a Concept node does not open the expansion overlay', async () => {
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
        onNodeClick(graph.nodes[0]); // single click only
      });

      expect(screen.queryByRole('heading', { name: 'Calculus' })).toBeNull();
    });

    it('single-clicking a Concept node pins a node card with an open docs action', async () => {
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

      expect(screen.getByText('Calculus')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Open docs' })).toBeInTheDocument();
    });

    it('expansion overlay shows document cards after fetch resolves', async () => {
      const mockDocs = [
        { doc_id: 'abc123', name: 'Math Notes', full_text: 'some content' },
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
        onNodeClick(graph.nodes[0]); // double click — Calculus
        await Promise.resolve();
      });

      expect(screen.getByRole('button', { name: 'Math Notes' })).toBeInTheDocument();
    });

    it('clicking open docs on the pinned node card opens that node documents', async () => {
      const mockDocs = [
        {
          doc_id: 'abc123',
          name: 'Math Notes',
          full_text: '# Math Notes\n\nChain rule explanation.',
        },
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
        onNodeClick(graph.nodes[0]);
      });

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Open docs' }));
        await Promise.resolve();
      });

      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/concepts/Calculus/documents',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(screen.getByRole('heading', { name: 'Calculus' })).toBeTruthy();
      expect(
        screen.getByRole('heading', { name: 'Math Notes', level: 1 }),
      ).toBeInTheDocument();
    });

    it('double-clicking a Concept node opens the first related document in the viewer', async () => {
      const mockDocs = [
        {
          doc_id: 'abc123',
          name: 'Math Notes',
          full_text: '# Math Notes\n\nChain rule explanation.',
        },
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
        onNodeClick(graph.nodes[0]); // double click — Calculus
        await Promise.resolve();
      });

      expect(
        screen.getByRole('heading', { name: 'Math Notes', level: 1 }),
      ).toBeInTheDocument();
      expect(screen.getByText('Chain rule explanation.')).toBeInTheDocument();
    });

    it('the collapse button closes the overlay', async () => {
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
        onNodeClick(graph.nodes[0]); // double click — Calculus
        await Promise.resolve();
      });
      expect(screen.getByRole('heading', { name: 'Calculus' })).toBeTruthy();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /back to graph/i }));
      });

      expect(screen.queryByRole('heading', { name: 'Calculus' })).toBeNull();
    });

    it('when already expanded, clicking another concept does nothing', async () => {
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
        onNodeClick(graph.nodes[0]); // double click — Calculus
        await Promise.resolve();
      });
      expect(screen.getByRole('heading', { name: 'Calculus' })).toBeTruthy();

      await act(async () => {
        onNodeClick(graph.nodes[1]); // Derivatives — single click, should be ignored
      });

      expect(screen.getByRole('heading', { name: 'Calculus' })).toBeTruthy();
      expect(screen.queryByRole('heading', { name: 'Derivatives' })).toBeNull();
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
    expect(focusedProps.linkWidth(graph.links[0])).toBeCloseTo(Math.log((1 + 1)) * 3.5, 6);
    expect(focusedProps.linkWidth(graph.links[1])).toBeCloseTo(Math.log((1 + 1)) * 3.5, 6);

    await act(async () => {
      getLatestGraphProps().onNodeClick(graph.nodes[1]);
    });

    const refocusedProps = getLatestGraphProps();

    expect(refocusedProps.linkColor(graph.links[0])).toBe('rgba(125, 211, 252, 0.9)');
    expect(refocusedProps.linkColor(graph.links[1])).toBe('rgba(51, 65, 85, 0.22)');
    expect(refocusedProps.linkWidth(graph.links[0])).toBeCloseTo(Math.log((1 + 1)) * 3.5, 6);
    expect(refocusedProps.linkWidth(graph.links[1])).toBeCloseTo(Math.log((1 + 1)) * 3.5, 6);
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
    expect(selectedProps.linkWidth(graph.links[0])).toBeCloseTo(Math.log((1 + 1)) * 3.5, 6);
    expect(selectedProps.linkWidth(graph.links[1])).toBeCloseTo(Math.log((1 + 1)) * 3.5, 6);
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

    expect(clearedProps.linkWidth(graph.links[0])).toBeCloseTo(Math.log((1 + 1)) * 3.5, 6);
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

    expect(clearedProps.linkWidth(graph.links[0])).toBeCloseTo(Math.log((1 + 1)) * 3.5, 6);
  });

  it('pressing Escape also exits node-focused rotation mode', async () => {
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

    await act(async () => {
      await getLatestGraphProps().onNodeClick(graph.nodes[0]);
    });

    sceneObject.rotation.order = 'YXZ';
    sceneObject.rotation.y = 0.5;
    sceneObject.position.set(6, 0, 4);
    sceneObject.updateMatrixWorld(true);
    cameraPosition.mockClear();

    fireEvent.keyDown(window, { key: 'Escape' });

    vi.advanceTimersByTime(1300);

    // After reset the scene is nearly zeroed; small idle rotation may have resumed
    expect(sceneObject.rotation.x).toBeCloseTo(0, 1);
    expect(sceneObject.rotation.y).toBeCloseTo(0, 1);
    expect(sceneObject.position.length()).toBeCloseTo(0, 1);
    expect(cameraPosition).toHaveBeenLastCalledWith(
      expect.objectContaining({
        x: 0,
        y: expect.closeTo(33.8, 2),
        z: 422.5,
      }),
      expect.objectContaining({
        x: 0,
        y: 0,
        z: 0,
      }),
    );
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
    expect(props.linkWidth({ ...graph.links[0], weight: 8 })).toBeCloseTo(Math.log(9) * 3.5, 6);
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
      expect(withGhost.linkWidth(ghostLink)).toBeCloseTo(0.8, 6);
    }

    fireEvent.click(screen.getByLabelText('Discovery mode'));

    const withoutGhost = getLatestGraphProps();
    expect(withoutGhost.graphData.links.some((link) => link.type === 'LATENT_DISCOVERY')).toBe(false);
  });
});
