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
          x: [-100, 100],
          y: [-60, 60],
          z: [-80, 80],
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

  it('auto-centers the graph on load', () => {
    render(
      <Graph3D
        data={graph}
        query=""
        hoveredNode={null}
        onHoverNode={vi.fn()}
      />,
    );

    vi.advanceTimersByTime(200);

    expect(zoomToFit).toHaveBeenCalledWith(1200, 120);
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
    expect(zoomToFit).toHaveBeenCalledWith(1200, 120);
  });

  it('double-clicking a node focuses it', () => {
    render(
      <Graph3D
        data={graph}
        query=""
        hoveredNode={null}
        onHoverNode={vi.fn()}
      />,
    );

    const props = graphPropsSpy.mock.calls.at(-1)?.[0] as {
      onNodeClick: (node: GraphNode) => void;
    };

    props.onNodeClick(graph.nodes[1]);
    vi.advanceTimersByTime(100);
    props.onNodeClick(graph.nodes[1]);

    expect(cameraPosition).toHaveBeenCalledWith(
      expect.objectContaining({ x: expect.any(Number), y: expect.any(Number), z: expect.any(Number) }),
      expect.objectContaining({ x: -10, y: 0, z: 0 }),
      1200,
    );
  });

  describe('Concept node document expansion', () => {
    it('clicking a Document node is a no-op and does not fetch', async () => {
      render(
        <Graph3D data={graph} query="" hoveredNode={null} onHoverNode={vi.fn()} />,
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

    it('fetched documents are injected as extra nodes and links into the graph', async () => {
      const mockDocs = [
        { doc_id: 'abc123', name: 'Math Notes', full_text: 'content' },
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

      const { graphData } = graphPropsSpy.mock.calls.at(-1)?.[0] as {
        graphData: GraphData;
      };
      expect(graphData.nodes).toHaveLength(graph.nodes.length + 1);
      const injected = graphData.nodes.find((n) => n.id === 'doc:abc123');
      expect(injected?.name).toBe('Math Notes');
      expect(injected?.type).toBe('Document');
      expect(graphData.links.some((l) => l.target === 'doc:abc123')).toBe(true);
    });

    it('clicking the same Concept node again collapses the document nodes', async () => {
      const mockDocs = [
        { doc_id: 'abc123', name: 'Math Notes', full_text: 'content' },
      ];
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockDocs),
      });

      render(
        <Graph3D data={graph} query="" hoveredNode={null} onHoverNode={vi.fn()} />,
      );

      // First click — expand
      await act(async () => {
        (graphPropsSpy.mock.calls.at(-1)?.[0] as {
          onNodeClick: (n: GraphNode) => void;
        }).onNodeClick(graph.nodes[0]);
      });
      expect(graphPropsSpy.mock.calls.at(-1)?.[0].graphData.nodes).toHaveLength(
        graph.nodes.length + 1,
      );

      // Advance past double-click threshold so second click is not treated as zoom
      vi.advanceTimersByTime(400);

      // Second click — collapse
      await act(async () => {
        (graphPropsSpy.mock.calls.at(-1)?.[0] as {
          onNodeClick: (n: GraphNode) => void;
        }).onNodeClick(graph.nodes[0]);
      });
      expect(graphPropsSpy.mock.calls.at(-1)?.[0].graphData.nodes).toHaveLength(
        graph.nodes.length,
      );
    });

    it('clicking a different Concept node replaces the previous document nodes', async () => {
      const docsA = [{ doc_id: 'docA', name: 'Doc A', full_text: 'a' }];
      const docsB = [{ doc_id: 'docB', name: 'Doc B', full_text: 'b' }];
      let call = 0;
      globalThis.fetch = vi.fn().mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(call++ === 0 ? docsA : docsB),
        }),
      );

      render(
        <Graph3D data={graph} query="" hoveredNode={null} onHoverNode={vi.fn()} />,
      );

      // Click Calculus
      await act(async () => {
        (graphPropsSpy.mock.calls.at(-1)?.[0] as {
          onNodeClick: (n: GraphNode) => void;
        }).onNodeClick(graph.nodes[0]);
      });

      vi.advanceTimersByTime(400);

      // Click Derivatives
      await act(async () => {
        (graphPropsSpy.mock.calls.at(-1)?.[0] as {
          onNodeClick: (n: GraphNode) => void;
        }).onNodeClick(graph.nodes[1]);
      });

      const { graphData } = graphPropsSpy.mock.calls.at(-1)?.[0] as {
        graphData: GraphData;
      };
      expect(graphData.nodes.find((n) => n.id === 'doc:docA')).toBeUndefined();
      expect(graphData.nodes.find((n) => n.id === 'doc:docB')).toBeDefined();
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
