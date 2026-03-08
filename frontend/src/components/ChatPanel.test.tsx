import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const sendMessage = vi.fn();
const createSession = vi.fn();
const selectSession = vi.fn();
let isLoading = false;
let activeSessionId = 'session-2';
let messages = [
  { role: 'user', content: 'What am I building?' },
  {
    role: 'assistant',
    content: 'You are building BrainBank.',
    discoveryConcepts: ['BrainBank', 'Knowledge Graph'],
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
  }),
}));

import { ChatPanel } from './ChatPanel';

describe('ChatPanel', () => {
  it('renders message history, discovery tags, and loading state', () => {
    isLoading = true;
    render(<ChatPanel />);

    expect(screen.getByText('What am I building?')).toBeInTheDocument();
    expect(screen.getByText('You are building BrainBank.')).toBeInTheDocument();
    expect(screen.getByText('BrainBank')).toBeInTheDocument();
    expect(screen.getByText('Knowledge Graph')).toBeInTheDocument();
    expect(screen.getByText('Thinking...')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Current chat' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('submits the current question and clears the input', async () => {
    isLoading = false;
    const user = userEvent.setup();
    sendMessage.mockResolvedValue(undefined);

    render(<ChatPanel />);

    const input = screen.getByLabelText('Ask BrainBank');
    await user.type(input, 'Where should I focus next?');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(sendMessage).toHaveBeenCalledWith('Where should I focus next?');
    expect(input).toHaveValue('');
  });

  it('lets users create a new chat and switch back to an older session', async () => {
    isLoading = false;
    const user = userEvent.setup();

    render(<ChatPanel />);

    await user.click(screen.getByRole('button', { name: 'New chat' }));
    expect(createSession).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Earlier chat' }));
    expect(selectSession).toHaveBeenCalledWith('session-1');
  });
});
