import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useChat } from './useChat';

describe('useChat', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the question and appends the assistant answer with discovery concepts', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        answer: 'Calculus is the study of change.',
        discovery_concepts: ['Derivatives', 'Integrals'],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useChat());

    await act(async () => {
      await result.current.sendMessage('What is calculus?');
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(fetchMock).toHaveBeenCalledWith('/query/test-llm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'What is calculus?' }),
    });
    expect(result.current.messages).toEqual([
      { role: 'user', content: 'What is calculus?' },
      {
        role: 'assistant',
        content: 'Calculus is the study of change.',
        discoveryConcepts: ['Derivatives', 'Integrals'],
      },
    ]);
  });

  it('adds an assistant fallback message when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    const { result } = renderHook(() => useChat());

    await act(async () => {
      await result.current.sendMessage('Can you answer?');
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.messages).toEqual([
      { role: 'user', content: 'Can you answer?' },
      {
        role: 'assistant',
        content: 'I could not reach BrainBank right now.',
        discoveryConcepts: [],
      },
    ]);
  });
});
