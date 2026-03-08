import { describe, expect, it, vi } from 'vitest';

import {
  NODE_TYPE_COLORS,
  autoRotateCamera,
  buildAdjacencyMap,
  centerCameraOnTarget,
  conceptColorFromScore,
  findMatchingNodeIds,
  getConnectionCount,
  zoomToNode,
} from './graphView';
import type { GraphData } from '../types/graph';

const graph: GraphData = {
  nodes: [
    { id: 'concept:Calculus', type: 'Concept', name: 'Calculus' },
    { id: 'concept:Derivatives', type: 'Concept', name: 'Derivatives' },
    { id: 'doc:abc-123', type: 'Document', name: 'Math Notes' },
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

describe('graphView helpers', () => {
  it('maps score 0 to red, score 1 to blue, and undefined to the default concept color', () => {
    expect(conceptColorFromScore(0)).toBe('hsl(0, 75%, 60%)');
    expect(conceptColorFromScore(0.5)).toBe('hsl(120, 75%, 60%)');
    expect(conceptColorFromScore(1)).toBe('hsl(240, 75%, 60%)');
    expect(conceptColorFromScore(undefined)).toBe(NODE_TYPE_COLORS.Concept);
  });

  it('maps each node type to the required color', () => {
    expect(NODE_TYPE_COLORS).toEqual({
      Concept: '#3b82f6',
      Document: '#22c55e',
      Project: '#f97316',
      Task: '#eab308',
      Reflection: '#a855f7',
    });
  });

  it('builds adjacency data from links', () => {
    const adjacency = buildAdjacencyMap(graph);

    expect(Array.from(adjacency.get('concept:Calculus') ?? []).sort()).toEqual([
      'concept:Derivatives',
      'doc:abc-123',
    ]);
  });

  it('counts direct node connections', () => {
    const adjacency = buildAdjacencyMap(graph);

    expect(getConnectionCount('concept:Calculus', adjacency)).toBe(2);
    expect(getConnectionCount('doc:abc-123', adjacency)).toBe(1);
  });

  it('matches nodes by case-insensitive name search', () => {
    const matches = findMatchingNodeIds(graph.nodes, 'calc');

    expect(matches).toEqual(new Set(['concept:Calculus']));
  });

  it('rotates the camera around the y axis', () => {
    let currentPosition = { x: 100, y: 25, z: 0 };
    const cameraPosition = vi.fn((position?: typeof currentPosition) => {
      if (!position) {
        return currentPosition;
      }

      currentPosition = position;
      return currentPosition;
    });
    const fgRef = {
      current: {
        cameraPosition,
      },
    };

    autoRotateCamera(fgRef, 0.01);

    expect(cameraPosition).toHaveBeenLastCalledWith({
      x: expect.closeTo(99.995, 3),
      y: 25,
      z: expect.closeTo(0.9999, 3),
    });
  });

  it('zooms the camera to a node', () => {
    const cameraPosition = vi.fn();
    const fgRef = {
      current: {
        cameraPosition,
      },
    };

    zoomToNode(
      fgRef,
      {
        id: 'concept:Calculus',
        type: 'Concept',
        name: 'Calculus',
        x: 10,
        y: 5,
        z: -5,
      },
      120,
    );

    expect(cameraPosition).toHaveBeenCalledWith(
      { x: 130, y: 35, z: 115 },
      { x: 10, y: 5, z: -5 },
      1200,
    );
  });

  it('centers the home view camera on a target', () => {
    const cameraPosition = vi.fn();
    const fgRef = {
      current: {
        cameraPosition,
      },
    };

    centerCameraOnTarget(
      fgRef,
      { x: 0, y: 8, z: 0 },
      300,
      900,
    );

    expect(cameraPosition).toHaveBeenCalledWith(
      { x: 0, y: 32, z: 300 },
      { x: 0, y: 8, z: 0 },
      900,
    );
  });
});
