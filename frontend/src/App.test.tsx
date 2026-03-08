import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
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
    refetch: () => {},
  }),
}));

vi.mock('./components/Graph3D', () => ({
  Graph3D: () => <div data-testid="graph-scene" />,
}));

vi.mock('./components/ChatPanel', () => ({
  ChatPanel: () => {
    const [draft, setDraft] = useState('');

    return (
      <div data-testid="chat-panel">
        <label htmlFor="chat-draft">Draft</label>
        <input
          id="chat-draft"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <div>{draft || 'Empty draft'}</div>
      </div>
    );
  },
}));

import App from './App';

describe('App', () => {
  it('renders the shell, graph summary, node legend, and keeps chat state when users toggle the panel', async () => {
    const user = userEvent.setup();

    render(<App />);

    expect(screen.getByRole('main')).toHaveClass('lg:h-screen', 'lg:overflow-hidden');
    expect(screen.getByTestId('graph-scene')).toBeInTheDocument();
    expect(screen.getByTestId('chat-panel')).toBeInTheDocument();
    expect(screen.getByText('BrainBank').closest('aside')).toHaveClass('lg:min-h-0', 'lg:overflow-y-auto');
    expect(screen.getByTestId('graph-scene').parentElement).toHaveClass('lg:min-h-0', 'lg:overflow-hidden');
    expect(screen.getByRole('button', { name: 'Close chat panel' })).toBeInTheDocument();
    expect(screen.getByText('BrainBank')).toBeInTheDocument();
    expect(screen.getByText('Mock data')).toBeInTheDocument();
    expect(screen.getByText('Concept')).toBeInTheDocument();
    expect(screen.getByText('Document')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Draft'), 'Persist me');
    expect(screen.getByDisplayValue('Persist me')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close chat panel' }));

    expect(screen.getByTestId('chat-panel')).not.toBeVisible();
    expect(screen.getByRole('button', { name: 'Open chat panel' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open chat panel' }));

    expect(screen.getByTestId('chat-panel')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Persist me')).toBeInTheDocument();
  });
});
