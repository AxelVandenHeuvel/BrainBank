import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

import type { GraphData, GraphNode } from '../types/graph';
import { Graph3D } from './Graph3D';
import { createBrainContainment, isNodeInsideContainment } from '../lib/brainModel';

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
const refresh = vi.fn();

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
