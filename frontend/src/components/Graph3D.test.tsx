import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

import { createBrainContainment, isNodeInsideContainment } from '../lib/brainModel';
import type { GraphData, GraphLink, GraphNode, RelationshipDetails } from '../types/graph';
import { Graph3D } from './Graph3D';

const graphPropsSpy = vi.fn();
let sceneObject = new THREE.Scene();
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
const cameraPosition = vi.fn((position?: typeof currentCameraPosition) => {
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
    load(_url: string, onLoad: (value: { scene: THREE.Object3D }) => void) {
      const scene = new THREE.Group();
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(50, 8, 8));
      mesh.position.set(40, -20, 10);
      scene.add(mesh);
      onLoad({
        scene,
      });
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
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('centers the home view on the brain shell when it loads', () => {
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

    // Camera should be positioned to frame the scaled brain geometry.
    // The SphereGeometry(50) mock with mesh at (40,-20,10) gives:
    //   centeredBrain.sphere.radius ≈ 130, distance = max(130 * 2.6, 240) = 338
    //   orbitTarget ≈ {x:0, y:0, z:0} after centering
    //   camera.y = target.y + distance * 0.08 ≈ 27.04
    expect(cameraPosition).toHaveBeenCalledWith(
      expect.objectContaining({
        x: 0,
        y: expect.closeTo(27.04, 2),
        z: 338,
      }),
      expect.objectContaining({
        x: 0,
        y: 0,
        z: 0,
      }),
      1200,
    );
    expect((graphPropsSpy.mock.calls.at(-1)?.[0] as {
      enableNavigationControls: boolean;
    }).enableNavigationControls).toBe(false);
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
        y: expect.closeTo(27.04, 2),
        z: 338,
      }),
      expect.objectContaining({
        x: 0,
        y: 0,
        z: 0,
      }),
      1200,
    );
  });

  it('zooms the camera to the first matching search result', () => {
    render(
      <Graph3D
        data={graph}
        source="api"
        query="calc"
        hoveredNode={null}
        onHoverNode={vi.fn()}
      />,
    );

    expect(cameraPosition).toHaveBeenLastCalledWith(
      expect.objectContaining({ x: 0, y: expect.closeTo(11.2, 2), z: 140 }),
      expect.objectContaining({ x: 0, y: 0, z: 0 }),
      1200,
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

  it('rotates around the clicked concept node after focus is set', async () => {
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

    sceneObject.rotation.set(0, 0, 0);
    sceneObject.position.set(0, 0, 0);
    cameraPosition.mockClear();

    vi.advanceTimersByTime(5000);
    vi.advanceTimersByTime(32);
    sceneObject.updateMatrixWorld(true);

    const pivotWorld = sceneObject.localToWorld(new THREE.Vector3(10, 0, 0));

    expect(sceneObject.rotation.y).not.toBe(0);
    expect(sceneObject.position.length()).toBeGreaterThan(0);
    expect(pivotWorld.x).toBeCloseTo(0, 3);
    expect(pivotWorld.y).toBeCloseTo(0, 3);
    expect(pivotWorld.z).toBeCloseTo(0, 3);
    expect(cameraPosition).not.toHaveBeenCalled();
  });

  it('keeps the selected node center as the pivot when that node position updates', async () => {
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

    graph.nodes[0].x = 24;
    graph.nodes[0].y = 6;
    graph.nodes[0].z = -8;
    sceneObject.rotation.order = 'YXZ';
    sceneObject.rotation.y = Math.PI / 3;

    act(() => {
      getLatestGraphProps().onEngineTick();
    });

    const pivotWorld = sceneObject.localToWorld(new THREE.Vector3(24, 6, -8));

    expect(pivotWorld.x).toBeCloseTo(0, 3);
    expect(pivotWorld.y).toBeCloseTo(0, 3);
    expect(pivotWorld.z).toBeCloseTo(0, 3);
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

    expect(sceneObject.rotation.x).not.toBe(0);
    expect(sceneObject.rotation.y).not.toBe(0);
    expect(cameraPosition.mock.calls.length).toBe(callCountBeforeDrag);
  });

  it('right-drag rotation uses the focused concept node as the pivot', async () => {
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
    sceneObject.updateMatrixWorld(true);

    const pivotWorld = sceneObject.localToWorld(new THREE.Vector3(10, 0, 0));

    expect(sceneObject.rotation.x).not.toBe(0);
    expect(sceneObject.rotation.y).not.toBe(0);
    expect(sceneObject.position.length()).toBeGreaterThan(0);
    expect(pivotWorld.x).toBeCloseTo(0, 3);
    expect(pivotWorld.y).toBeCloseTo(0, 3);
    expect(pivotWorld.z).toBeCloseTo(0, 3);
    expect(cameraPosition).not.toHaveBeenCalled();
  });

  it('does not rotate the scene on left-button drag so node interaction stays available', () => {
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

    const callsAfterFirstResize = cameraPosition.mock.calls.length;

    act(() => {
      resizeObserverCallback?.([{ contentRect: { width: 900, height: 760 } }]);
    });

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
        y: expect.closeTo(27.04, 2),
        z: 338,
      }),
      expect.objectContaining({
        x: 0,
        y: 0,
        z: 0,
      }),
      1200,
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
    fireEvent.click(screen.getByRole('button', { name: '−' }));
    fireEvent.click(screen.getByRole('button', { name: '⟳' }));

    expect(container.querySelector('.absolute.top-4.right-4.flex.flex-col.gap-2')).not.toBeNull();
    expect(cameraPosition).toHaveBeenCalled();
    // ⟳ resets to brain home view
    expect(cameraPosition).toHaveBeenLastCalledWith(
      expect.objectContaining({
        x: 0,
        y: expect.closeTo(27.04, 2),
        z: 338,
      }),
      expect.objectContaining({
        x: 0,
        y: 0,
        z: 0,
      }),
      1200,
    );
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
    });

    expect(cameraPosition).toHaveBeenLastCalledWith(
      expect.objectContaining({ x: 0, y: 8, z: 100 }),
      expect.objectContaining({ x: 0, y: 0, z: 0 }),
      1200,
    );
  });

  it('clicking a node centers that node at the screen pivot', async () => {
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
      getLatestGraphProps().onNodeClick(graph.nodes[1]);
    });

    const centeredPoint = sceneObject.localToWorld(
      new THREE.Vector3(
        graph.nodes[1].x ?? 0,
        graph.nodes[1].y ?? 0,
        graph.nodes[1].z ?? 0,
      ),
    );

    expect(centeredPoint.x).toBeCloseTo(0, 4);
    expect(centeredPoint.y).toBeCloseTo(0, 4);
    expect(centeredPoint.z).toBeCloseTo(0, 4);
    expect(cameraPosition).toHaveBeenLastCalledWith(
      expect.objectContaining({
        x: 0,
        y: expect.any(Number),
        z: expect.any(Number),
      }),
      expect.objectContaining({ x: 0, y: 0, z: 0 }),
      1200,
    );
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

    expect(sceneObject.rotation.x).toBeCloseTo(0, 6);
    expect(sceneObject.rotation.y).toBeCloseTo(0, 6);
    expect(sceneObject.position.length()).toBeCloseTo(0, 6);
    expect(cameraPosition).toHaveBeenLastCalledWith(
      expect.objectContaining({
        x: 0,
        y: expect.closeTo(27.04, 2),
        z: 338,
      }),
      expect.objectContaining({
        x: 0,
        y: 0,
        z: 0,
      }),
      1200,
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

    it('clicking a Concept node fetches its documents from the API', async () => {
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
        onNodeClick(graph.nodes[0]); // Calculus
      });

      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/concepts/Calculus/documents',
      );
    });

    it('clicking a Concept node opens the expansion overlay', async () => {
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
        onNodeClick(graph.nodes[0]); // Calculus
      });

      expect(screen.getByRole('heading', { name: 'Calculus' })).toBeTruthy();
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
        onNodeClick(graph.nodes[0]); // Calculus
      });

      expect(screen.getByText('Math Notes')).toBeTruthy();
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
        onNodeClick(graph.nodes[0]); // Calculus
      });
      expect(screen.getByRole('heading', { name: 'Calculus' })).toBeTruthy();

      await act(async () => {
        fireEvent.click(screen.getByText(/Back to Web/));
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
        onNodeClick(graph.nodes[0]); // Calculus
      });
      expect(screen.getByRole('heading', { name: 'Calculus' })).toBeTruthy();

      await act(async () => {
        onNodeClick(graph.nodes[1]); // Derivatives — should be ignored
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
      onEngineTick: () => void;
    };
    const outsideNode = graph.nodes[0];
    outsideNode.x = 250;
    outsideNode.y = 210;
    outsideNode.z = 180;

    props.onEngineTick();

    expect(
      isNodeInsideContainment(
        outsideNode,
        createBrainContainment(
          new THREE.Mesh(
            new THREE.SphereGeometry(75, 8, 8),
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
    expect(focusedProps.linkWidth(graph.links[0])).toBeGreaterThan(0.7);
    expect(focusedProps.linkWidth(graph.links[1])).toBeGreaterThan(0.7);

    await act(async () => {
      getLatestGraphProps().onNodeClick(graph.nodes[1]);
    });

    const refocusedProps = getLatestGraphProps();

    expect(refocusedProps.linkColor(graph.links[0])).toBe('rgba(125, 211, 252, 0.9)');
    expect(refocusedProps.linkColor(graph.links[1])).toBe('rgba(51, 65, 85, 0.22)');
    expect(refocusedProps.linkWidth(graph.links[0])).toBeGreaterThan(
      refocusedProps.linkWidth(graph.links[1]),
    );
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
    expect(selectedProps.linkWidth(graph.links[0])).toBeGreaterThan(selectedProps.linkWidth(graph.links[1]));
  });

  it('clicking a MENTIONS edge does not open the panel', () => {
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

    props.onLinkClick(graph.links[1]);

    expect(screen.queryByText('Derivative Rules')).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
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

    expect(clearedProps.linkWidth(graph.links[0])).toBe(0.7);
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

    expect(clearedProps.linkWidth(graph.links[0])).toBe(0.7);
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

    await act(async () => {
      await getLatestGraphProps().onNodeClick(graph.nodes[0]);
    });

    sceneObject.rotation.order = 'YXZ';
    sceneObject.rotation.y = 0.5;
    sceneObject.position.set(6, 0, 4);
    sceneObject.updateMatrixWorld(true);
    cameraPosition.mockClear();

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(sceneObject.rotation.x).toBeCloseTo(0, 6);
    expect(sceneObject.rotation.y).toBeCloseTo(0, 6);
    expect(sceneObject.position.length()).toBeCloseTo(0, 6);
    expect(cameraPosition).toHaveBeenLastCalledWith(
      expect.objectContaining({
        x: 0,
        y: expect.closeTo(27.04, 2),
        z: 338,
      }),
      expect.objectContaining({
        x: 0,
        y: 0,
        z: 0,
      }),
      1200,
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

    expect(screen.getByText('Derivatives are a core tool within calculus')).toBeInTheDocument();
    expect(screen.getByText('Math Notes')).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
