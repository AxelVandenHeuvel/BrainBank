import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const sendMessage = vi.fn();
let isLoading = false;

vi.mock('../hooks/useChat', () => ({
  useChat: () => ({
    messages: [
      { role: 'user', content: 'What am I building?' },
      {
        role: 'assistant',
        content: 'You are building BrainBank.',
        discoveryConcepts: ['BrainBank', 'Knowledge Graph'],
      },
    ],
    isLoading,
    sendMessage,
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
});
