import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ChatMessage } from '../types/chat';

const sendMessage = vi.fn();
const createSession = vi.fn();
const selectSession = vi.fn();
const deleteSession = vi.fn();
const openDocument = vi.fn();
let isLoading = false;
let activeSessionId = 'session-2';
let messages = [
  { role: 'user', content: 'What am I building?' },
  {
    role: 'assistant',
    content: 'You are building BrainBank.',
    sourceConcepts: ['BrainBank'],
    discoveryConcepts: ['BrainBank', 'Knowledge Graph'],
    sourceDocuments: [{ docId: 'doc-1', name: 'Architecture Notes' }],
    discoveryDocuments: [{ docId: 'doc-2', name: 'Knowledge Graph Primer' }],
    sourceChunks: [
      {
        chunkId: 'chunk-1',
        docId: 'doc-1',
        docName: 'Architecture Notes',
        text: 'BrainBank connects notes into a graph.',
      },
    ],
    discoveryChunks: [],
    supportingRelationships: [
      {
        source: 'BrainBank',
        target: 'Knowledge Graph',
        type: 'RELATED_TO',
        reason: 'BrainBank is built around a knowledge graph.',
      },
    ],
  },
];
let sessions = [
  {
    id: 'session-2',
    title: 'Current chat',
    createdAt: '2026-03-07T19:00:00.000Z',
    updatedAt: '2026-03-07T19:05:00.000Z',
    messages,
  },
  {
    id: 'session-1',
    title: 'Earlier chat',
    createdAt: '2026-03-07T18:00:00.000Z',
    updatedAt: '2026-03-07T18:05:00.000Z',
    messages: [{ role: 'user', content: 'Earlier question' }],
  },
];

vi.mock('../hooks/useChat', () => ({
  useChat: () => ({
    messages,
    sessions,
    activeSessionId,
    isLoading,
    sendMessage,
    createSession,
    selectSession,
    deleteSession,
  }),
}));

import { ChatPanel } from './ChatPanel';

describe('ChatPanel', () => {
  afterEach(() => {
    vi.useRealTimers();
    deleteSession.mockReset();
  });

  it('renders message history, retrieval concept sections, and loading state', () => {
    isLoading = true;
    render(<ChatPanel graphSource="api" onOpenDocument={openDocument} />);

    expect(screen.getByTestId('chat-panel-shell')).toHaveClass('lg:h-full', 'lg:min-h-0');
    expect(screen.getByTestId('chat-panel-body')).toHaveClass('min-h-0', 'flex-1');
    expect(screen.getByTestId('chat-panel-messages')).toHaveClass('flex-1', 'overflow-y-auto');
    expect(screen.getByTestId('chat-panel-form')).toHaveClass('mt-auto', 'shrink-0');
    expect(screen.queryByRole('button', { name: 'Earlier chat' })).not.toBeInTheDocument();
    expect(screen.getByText('What am I building?')).toBeInTheDocument();
    expect(screen.getByText('You are building BrainBank.')).toBeInTheDocument();
    expect(screen.getByText('Source concepts')).toBeInTheDocument();
    expect(screen.getByText('Discovery concepts')).toBeInTheDocument();
    expect(screen.getByText('Linked documents')).toBeInTheDocument();
    expect(screen.getByText('Source:')).toBeInTheDocument();
    expect(screen.getByText('Discovery:')).toBeInTheDocument();
    expect(screen.getByText('Supporting relationships')).toBeInTheDocument();
    expect(screen.getByText('Evidence excerpts')).toBeInTheDocument();
    expect(screen.getAllByText('BrainBank')).toHaveLength(2);
    expect(screen.getByText('Knowledge Graph')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Architecture Notes' })).toBeInTheDocument();
    expect(screen.getByText('BrainBank connects notes into a graph.')).toBeInTheDocument();
    expect(screen.getByText('BrainBank -> Knowledge Graph')).toBeInTheDocument();
    expect(screen.queryByText('GraphRAG')).not.toBeInTheDocument();
    expect(screen.queryByText('Thinking...')).not.toBeInTheDocument();
    expect(screen.getByTestId('chat-panel-loading')).toBeInTheDocument();
    expect(screen.getByText('Traversing graph')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Toggle chat history' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('rotates loading phrases while the assistant is generating a response', () => {
    vi.useFakeTimers();
    isLoading = true;
    render(<ChatPanel graphSource="api" />);

    expect(screen.getByText('Traversing graph')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2600);
    });

    expect(screen.getByText('Traversing graph')).not.toHaveClass('is-visible');

    act(() => {
      vi.advanceTimersByTime(520);
    });

    expect(screen.getByText('Harnessing concepts')).toBeInTheDocument();
    expect(screen.getByText('Harnessing concepts')).toHaveClass('is-visible');
  });

  it('submits the current question and clears the input', async () => {
    isLoading = false;
    const user = userEvent.setup();
    sendMessage.mockResolvedValue(undefined);

    render(<ChatPanel graphSource="api" onOpenDocument={openDocument} />);

    const input = screen.getByLabelText('Ask braen');
    await user.type(input, 'Where should I focus next?');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(sendMessage).toHaveBeenCalledWith('Where should I focus next?');
    expect(input).toHaveValue('');
  });

  it('lets users create a new chat and switch back to an older session', async () => {
    isLoading = false;
    const user = userEvent.setup();

    render(<ChatPanel graphSource="api" onOpenDocument={openDocument} />);

    await user.click(screen.getByRole('button', { name: 'New chat' }));
    expect(createSession).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Toggle chat history' }));
    expect(screen.getByRole('button', { name: 'Current chat' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(screen.getByRole('button', { name: 'Earlier chat' }));
    expect(selectSession).toHaveBeenCalledWith('session-1');
  });

  it('shows chat history only after the history toggle is opened', async () => {
    isLoading = false;
    const user = userEvent.setup();

    render(<ChatPanel graphSource="api" />);

    expect(screen.queryByText('Recent chats')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Earlier chat' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Toggle chat history' }));

    expect(screen.getByText('Recent chats')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Earlier chat' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Toggle chat history' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('deletes a chat session from the history list', async () => {
    isLoading = false;
    const user = userEvent.setup();

    render(<ChatPanel graphSource="api" />);

    await user.click(screen.getByRole('button', { name: 'Toggle chat history' }));
    await user.click(screen.getByRole('button', { name: 'Delete Earlier chat' }));

    expect(deleteSession).toHaveBeenCalledWith('session-1');
  });

  it('warns when the graph is mock data because chat only queries live ingested notes', () => {
    render(<ChatPanel graphSource="mock" onOpenDocument={openDocument} />);

    expect(
      screen.getByText('Graph is showing mock data. Chat only queries live ingested notes from the backend.'),
    ).toBeInTheDocument();
  });

  it('opens a cited document when the user clicks its citation', async () => {
    isLoading = false;
    const user = userEvent.setup();

    render(<ChatPanel graphSource="api" onOpenDocument={openDocument} />);

    await user.click(screen.getByRole('link', { name: 'Architecture Notes' }));

    expect(openDocument).toHaveBeenCalledWith('doc-1', 'Architecture Notes');
  });

  it('toggles graph focus when users click the same assistant response twice', async () => {
    const user = userEvent.setup();
    const onAssistantMessageSelect = vi.fn();

    render(
      <ChatPanel
        graphSource="api"
        onAssistantMessageSelect={onAssistantMessageSelect}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Select response 1' }));
    expect(onAssistantMessageSelect).toHaveBeenNthCalledWith(1, {
      sourceConcepts: ['BrainBank'],
      discoveryConcepts: ['BrainBank', 'Knowledge Graph'],
      message: messages[1] as ChatMessage,
    });

    await user.click(screen.getByRole('button', { name: 'Select response 1' }));
    expect(onAssistantMessageSelect).toHaveBeenNthCalledWith(2, null);
  });
});
