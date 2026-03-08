import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useChat } from './useChat';

describe('useChat', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
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

  it('creates a new empty session without deleting prior sessions and updates only the active session', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        answer: 'Focus on retrieval quality.',
        discovery_concepts: ['Retrieval'],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useChat());

    expect(result.current.sessions).toHaveLength(1);
    const firstSessionId = result.current.activeSessionId;

    await act(async () => {
      await result.current.sendMessage('What should I focus on next?');
    });

    act(() => {
      result.current.createSession();
    });

    const secondSessionId = result.current.activeSessionId;

    expect(result.current.sessions).toHaveLength(2);
    expect(secondSessionId).not.toBe(firstSessionId);
    expect(result.current.messages).toEqual([]);

    await act(async () => {
      await result.current.sendMessage('What did I leave unfinished?');
    });

    const firstSession = result.current.sessions.find((session) => session.id === firstSessionId);
    const secondSession = result.current.sessions.find((session) => session.id === secondSessionId);

    expect(firstSession?.messages).toHaveLength(2);
    expect(secondSession?.messages).toHaveLength(2);
    expect(secondSession?.title).toBe('What did I leave unfinished?');
  });

  it('restores sessions from localStorage and allows switching back to an older session', () => {
    localStorage.setItem(
      'brainbank.chat.sessions',
      JSON.stringify([
        {
          id: 'session-1',
          title: 'First chat',
          createdAt: '2026-03-07T18:00:00.000Z',
          updatedAt: '2026-03-07T18:05:00.000Z',
          messages: [{ role: 'user', content: 'First question' }],
        },
        {
          id: 'session-2',
          title: 'Second chat',
          createdAt: '2026-03-07T19:00:00.000Z',
          updatedAt: '2026-03-07T19:05:00.000Z',
          messages: [{ role: 'user', content: 'Second question' }],
        },
      ]),
    );
    localStorage.setItem('brainbank.chat.activeSessionId', 'session-2');

    const { result } = renderHook(() => useChat());

    expect(result.current.activeSessionId).toBe('session-2');
    expect(result.current.messages).toEqual([{ role: 'user', content: 'Second question' }]);

    act(() => {
      result.current.selectSession('session-1');
    });

    expect(result.current.activeSessionId).toBe('session-1');
    expect(result.current.messages).toEqual([{ role: 'user', content: 'First question' }]);
  });
});
