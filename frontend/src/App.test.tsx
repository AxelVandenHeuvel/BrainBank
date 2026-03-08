import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

const graph3DSpy = vi.fn();

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
  Graph3D: (props: { chatFocus?: { sourceConcepts: string[]; discoveryConcepts: string[] } | null }) => {
    graph3DSpy(props);

    return (
      <div
        data-testid="graph-scene"
        data-chat-focus={props.chatFocus ? JSON.stringify(props.chatFocus) : 'none'}
      />
    );
  },
}));

vi.mock('./components/DocumentEditor', () => ({
  DocumentEditor: ({
    docId,
    onSaved,
  }: {
    docId: string;
    onSaved?: (docId: string, newDocId?: string, currentContent?: string) => void;
  }) => (
    <div data-testid="document-editor">
      <div>{docId}</div>
      <button
        type="button"
        onClick={() => onSaved?.(docId, docId.startsWith('new-note-') ? 'saved-doc-1' : undefined, 'Saved content')}
      >
        Trigger save
      </button>
    </div>
  ),
}));

vi.mock('./components/ChatPanel', () => ({
  ChatPanel: ({
    graphSource,
    onOpenDocument,
    onAssistantMessageSelect,
  }: {
    graphSource: 'api' | 'mock';
    onOpenDocument?: (docId: string, name: string) => void;
    onAssistantMessageSelect?: (selection: {
      sourceConcepts: string[];
      discoveryConcepts: string[];
    } | null) => void;
  }) => {
    const [draft, setDraft] = useState('');

    return (
      <div
        data-testid="chat-panel"
        data-graph-source={graphSource}
        data-has-bottom-composer="true"
      >
        <label htmlFor="chat-draft">Draft</label>
        <input
          id="chat-draft"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <div>{draft || 'Empty draft'}</div>
        <button type="button" onClick={() => onOpenDocument?.('doc-1', 'Architecture Notes')}>
          Open cited doc
        </button>
        <button
          type="button"
          onClick={() =>
            onAssistantMessageSelect?.({
              sourceConcepts: ['Calculus'],
              discoveryConcepts: ['Derivatives'],
            })}
        >
          Select response
        </button>
        <button type="button" onClick={() => onAssistantMessageSelect?.(null)}>
          Clear response
        </button>
      </div>
    );
  },
}));

import App from './App';

describe('App', () => {
  it('passes selected assistant response concepts into the graph highlight state', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Select response' }));
    expect(screen.getByTestId('graph-scene')).toHaveAttribute(
      'data-chat-focus',
      JSON.stringify({
        sourceConcepts: ['Calculus'],
        discoveryConcepts: ['Derivatives'],
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Clear response' }));
    expect(screen.getByTestId('graph-scene')).toHaveAttribute('data-chat-focus', 'none');
  });

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
    expect(screen.getByTestId('chat-panel')).toHaveAttribute('data-graph-source', 'mock');
    expect(screen.getByTestId('chat-overlay')).toHaveClass(
      'lg:absolute',
      'lg:inset-y-3',
      'lg:right-3',
      'lg:w-[30rem]',
    );
    expect(screen.getByTestId('chat-panel')).toHaveAttribute('data-has-bottom-composer', 'true');
    expect(screen.getByRole('button', { name: 'Close chat panel' })).toBeInTheDocument();

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

  it('closes the new note editor after saving a new note', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /new note/i }));

    expect(screen.getByTestId('document-editor')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Trigger save' }));

    expect(screen.queryByTestId('document-editor')).not.toBeInTheDocument();
    expect(screen.getByTestId('graph-scene')).toBeVisible();
  });

  it('opens a cited chat document in the document editor', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        doc_id: 'doc-1',
        name: 'Architecture Notes',
        full_text: '# Architecture Notes',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Open cited doc' }));

    expect(fetchMock).toHaveBeenCalledWith('/api/documents/doc-1');
    expect(await screen.findByTestId('document-editor')).toBeInTheDocument();
    expect(screen.getByText('doc-1')).toBeInTheDocument();
  });
});
