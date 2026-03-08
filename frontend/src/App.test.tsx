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
  it('renders the shell with search bar in the top bar area', () => {
    render(<App />);

    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByTestId('app-shell')).toBeInTheDocument();
    expect(screen.getByTestId('graph-scene')).toBeInTheDocument();

    // Search bar should be in the top bar, not the sidebar
    const topBar = screen.getByTestId('top-bar');
    expect(topBar).toBeInTheDocument();
    expect(topBar.querySelector('#graph-search')).toBeInTheDocument();
  });

  it('renders the sidebar with toggle button defaulting to expanded', () => {
    render(<App />);

    const sidebar = screen.getByTestId('sidebar');
    expect(sidebar).toBeInTheDocument();

    const toggleBtn = screen.getByRole('button', { name: 'Collapse sidebar' });
    expect(toggleBtn).toBeInTheDocument();

    // Sidebar should be expanded by default (22rem wide)
    expect(sidebar).toHaveClass('w-[22rem]');
  });

  it('collapses and expands the sidebar when toggle is clicked', async () => {
    const user = userEvent.setup();
    render(<App />);

    const sidebar = screen.getByTestId('sidebar');

    // Initially expanded
    expect(sidebar).toHaveClass('w-[22rem]');

    // Click to collapse
    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(sidebar).toHaveClass('w-[3rem]');
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();

    // Click to expand
    await user.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(sidebar).toHaveClass('w-[22rem]');
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeInTheDocument();
  });

  it('hides sidebar content when collapsed', async () => {
    const user = userEvent.setup();
    render(<App />);

    // Content visible when expanded
    const sidebarContent = screen.getByTestId('sidebar-content');
    expect(sidebarContent).toHaveClass('opacity-100');

    // Collapse
    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));

    // Content should be hidden
    expect(sidebarContent).toHaveClass('opacity-0');
  });

  it('always keeps Graph3D mounted even when activeTabId would be set', () => {
    render(<App />);

    // Graph should always be in the DOM
    expect(screen.getByTestId('graph-scene')).toBeInTheDocument();
  });

  it('renders the sidebar with ingest controls', () => {
    render(<App />);

    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-content')).toBeInTheDocument();
  });

  it('supports chat toggle and preserves state', async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByTestId('chat-panel')).toBeInTheDocument();

    // Type in chat
    await user.type(screen.getByLabelText('Draft'), 'Persist me');
    expect(screen.getByDisplayValue('Persist me')).toBeInTheDocument();

    // Close chat
    await user.click(screen.getByRole('button', { name: 'Close chat panel' }));
    expect(screen.getByTestId('chat-panel')).not.toBeVisible();

    // Open chat
    await user.click(screen.getByRole('button', { name: 'Open chat panel' }));
    expect(screen.getByTestId('chat-panel')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Persist me')).toBeInTheDocument();
  });

  it('does not render the old NoteEditor view toggle', () => {
    render(<App />);

    // The old NoteEditor full-page overlay should not be rendered
    // There should be no "Back to graph" button from NoteEditor
    expect(screen.queryByText('Back to graph')).not.toBeInTheDocument();
  });
});
