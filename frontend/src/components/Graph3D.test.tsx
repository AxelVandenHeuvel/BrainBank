import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GraphData, GraphNode } from '../types/graph';
import { Graph3D } from './Graph3D';

const graphPropsSpy = vi.fn();
const controls = {
  autoRotate: false,
  autoRotateSpeed: 0,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
};
const cameraPosition = vi.fn();
const graph2ScreenCoords = vi.fn(() => ({ x: 160, y: 120 }));
const sceneAdd = vi.fn();
const sceneRemove = vi.fn();

vi.mock('react-force-graph-3d', async () => {
  const React = await vi.importActual<typeof import('react')>('react');

  return {
    default: React.forwardRef((props: Record<string, unknown>, ref) => {
      React.useImperativeHandle(ref, () => ({
        controls: () => controls,
        cameraPosition,
        graph2ScreenCoords,
        scene: () => ({
          add: sceneAdd,
          remove: sceneRemove,
        }),
      }));
      graphPropsSpy(props);
      return <div data-testid="force-graph" />;
    }),
  };
});

vi.mock('three/examples/jsm/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class {
    load(_url: string, onLoad: (value: { scene: { traverse: (fn: (node: object) => void) => void } }) => void) {
      onLoad({
        scene: {
          traverse: () => undefined,
        },
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
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('configures orbit auto-rotation and pauses on interaction', () => {
    render(
      <Graph3D
        data={graph}
        query=""
        hoveredNode={null}
        onHoverNode={vi.fn()}
      />,
    );

    expect(controls.autoRotate).toBe(true);
    expect(controls.autoRotateSpeed).toBeGreaterThan(0);
    expect(controls.addEventListener).toHaveBeenCalledWith('start', expect.any(Function));
    expect(controls.addEventListener).toHaveBeenCalledWith('end', expect.any(Function));
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
});
