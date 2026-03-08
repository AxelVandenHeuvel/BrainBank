import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

import { createBrainContainment, isNodeInsideContainment } from '../lib/brainModel';
import type { GraphData, GraphNode } from '../types/graph';
import { Graph3D } from './Graph3D';

const graphPropsSpy = vi.fn();
const controls = {
  autoRotate: false,
  autoRotateSpeed: 0,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
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
const sceneAdd = vi.fn();
const sceneRemove = vi.fn();
const zoomToFit = vi.fn();
const refresh = vi.fn();

vi.mock('react-force-graph-3d', async () => {
  const React = await vi.importActual<typeof import('react')>('react');

  return {
    default: React.forwardRef((props: Record<string, unknown>, ref) => {
      React.useImperativeHandle(ref, () => ({
        controls: () => controls,
        cameraPosition,
        graph2ScreenCoords,
        zoomToFit,
        scene: () => ({
          add: sceneAdd,
          remove: sceneRemove,
        }),
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
      scene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 8, 8)));
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
    },
    {
      source: 'doc:abc-123',
      target: 'concept:Calculus',
      type: 'MENTIONS',
    },
  ],
};

const hoveredNode: GraphNode = {
  id: 'concept:Calculus',
  type: 'Concept',
  name: 'Calculus',
  x: 10,
  y: 0,
  z: 0,
};

describe('Graph3D', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    currentCameraPosition = { x: 200, y: 60, z: 200 };
    // Default: fetch returns empty doc list so existing tests don't crash
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('centers the home view on the brain shell when it loads', () => {
    render(
      <Graph3D
        data={graph}
        query=""
        hoveredNode={null}
        onHoverNode={vi.fn()}
      />,
    );

    vi.advanceTimersByTime(200);

    // Camera should be positioned to frame the scaled brain geometry.
    // The SphereGeometry(50) mock scales to ~260 world-units, giving:
    //   framedSphere.radius ≈ 130, distance = max(130 * 2.8, 300) = 364
    //   target.y ≈ framedSize.y * 0.15 ≈ 22.52
    //   camera.y ≈ target.y + distance * 0.08 ≈ 51.64
    expect(cameraPosition).toHaveBeenCalledWith(
      expect.objectContaining({
        x: 0,
        y: expect.closeTo(51.64, 2),
        z: 364,
      }),
      expect.objectContaining({
        x: 0,
        y: expect.closeTo(22.52, 2),
        z: 0,
      }),
      1200,
    );
  });

  it('zooms the camera to the first matching search result', () => {
    render(
      <Graph3D
        data={graph}
        query="calc"
        hoveredNode={null}
        onHoverNode={vi.fn()}
      />,
    );

    expect(cameraPosition).toHaveBeenCalledWith(
      expect.objectContaining({ x: expect.any(Number), y: expect.any(Number), z: expect.any(Number) }),
      expect.objectContaining({ x: 10, y: 0, z: 0 }),
      1200,
    );
  });

  it('starts rotating after 5 seconds of idle time and stops on mouse movement', () => {
    const { container } = render(
      <Graph3D
        data={graph}
        query=""
        hoveredNode={null}
        onHoverNode={vi.fn()}
      />,
    );

    const callCountBeforeIdle = cameraPosition.mock.calls.length;
    vi.advanceTimersByTime(5000);
    vi.advanceTimersByTime(32);

    expect(cameraPosition.mock.calls.length).toBeGreaterThan(callCountBeforeIdle);

    const callCountAfterIdle = cameraPosition.mock.calls.length;
    fireEvent.mouseMove(container.firstChild as HTMLElement);
    vi.advanceTimersByTime(100);

    expect(cameraPosition.mock.calls.length).toBe(callCountAfterIdle);
  });

  it('highlights connected neighbors while dimming unrelated nodes on hover', () => {
    render(
      <Graph3D
        data={graph}
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
        y: expect.closeTo(51.64, 2),
        z: 364,
      }),
      expect.objectContaining({
        x: 0,
        y: expect.closeTo(22.52, 2),
        z: 0,
      }),
      1200,
    );
  });

  describe('Concept node document expansion', () => {
    it('clicking a Concept node fetches its documents from the API', async () => {
      render(
        <Graph3D data={graph} query="" hoveredNode={null} onHoverNode={vi.fn()} />,
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
        <Graph3D data={graph} query="" hoveredNode={null} onHoverNode={vi.fn()} />,
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
        <Graph3D data={graph} query="" hoveredNode={null} onHoverNode={vi.fn()} />,
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
        <Graph3D data={graph} query="" hoveredNode={null} onHoverNode={vi.fn()} />,
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
        <Graph3D data={graph} query="" hoveredNode={null} onHoverNode={vi.fn()} />,
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
});
