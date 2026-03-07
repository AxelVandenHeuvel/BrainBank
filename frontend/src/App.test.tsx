import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./hooks/useGraphData', () => ({
  useGraphData: () => ({
    data: {
      nodes: [
        { id: 'concept:Calculus', type: 'Concept', name: 'Calculus' },
        { id: 'doc:abc-123', type: 'Document', name: 'Math Notes' },
      ],
      links: [
        {
          source: 'doc:abc-123',
          target: 'concept:Calculus',
          type: 'MENTIONS',
        },
      ],
    },
    source: 'mock',
    isLoading: false,
    error: null,
  }),
}));

vi.mock('./components/Graph3D', () => ({
  Graph3D: () => <div data-testid="graph-scene" />,
}));

import App from './App';

describe('App', () => {
  it('renders the shell, graph summary, and node legend', () => {
    render(<App />);

    expect(screen.getByTestId('graph-scene')).toBeInTheDocument();
    expect(screen.getByText('BrainBank')).toBeInTheDocument();
    expect(screen.getByText('Mock data')).toBeInTheDocument();
    expect(screen.getByText('Concept')).toBeInTheDocument();
    expect(screen.getByText('Document')).toBeInTheDocument();
  });
});

