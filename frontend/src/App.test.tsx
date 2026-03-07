import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

vi.mock('./components/ChatPanel', () => ({
  ChatPanel: () => <div data-testid="chat-panel">Chat panel</div>,
}));

import App from './App';

describe('App', () => {
  it('renders the shell, graph summary, node legend, and lets users toggle the chat panel', async () => {
    const user = userEvent.setup();

    render(<App />);

    expect(screen.getByTestId('graph-scene')).toBeInTheDocument();
    expect(screen.getByTestId('chat-panel')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close chat panel' })).toBeInTheDocument();
    expect(screen.getByText('BrainBank')).toBeInTheDocument();
    expect(screen.getByText('Mock data')).toBeInTheDocument();
    expect(screen.getByText('Concept')).toBeInTheDocument();
    expect(screen.getByText('Document')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close chat panel' }));

    expect(screen.queryByTestId('chat-panel')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open chat panel' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open chat panel' }));

    expect(screen.getByTestId('chat-panel')).toBeInTheDocument();
  });
});
