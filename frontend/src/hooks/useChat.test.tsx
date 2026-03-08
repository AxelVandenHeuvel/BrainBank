import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useChat } from './useChat';

describe('useChat', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('sends the question and appends the assistant answer with retrieval concepts', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          route: 'LOCAL',
          requires_direct_query: false,
          prepared_query_id: 'prepared-1',
          source_concepts: ['Calculus'],
          discovery_concepts: ['Derivatives', 'Integrals'],
          traversal_plan: {
            root_node_id: 'concept:Calculus',
            step_interval_ms: 160,
            pulse_duration_ms: 320,
            brightness_decay: 0.65,
            brightness_threshold: 0.25,
            steps: [],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          answer: 'Calculus is the study of change.',
          source_concepts: ['Calculus'],
          discovery_concepts: ['Derivatives', 'Integrals'],
          source_documents: [{ doc_id: 'doc-1', name: 'Math Notes' }],
          discovery_documents: [{ doc_id: 'doc-2', name: 'Derivative Rules' }],
          source_chunks: [
            {
              chunk_id: 'chunk-1',
              doc_id: 'doc-1',
              doc_name: 'Math Notes',
              text: 'Calculus is the study of change.',
            },
          ],
          discovery_chunks: [],
          supporting_relationships: [
            {
              source: 'Calculus',
              target: 'Derivatives',
              type: 'RELATED_TO',
              reason: 'Derivatives are part of calculus.',
            },
          ],
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useChat());

    await act(async () => {
      await result.current.sendMessage('What is calculus?');
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/query/prepare', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/query/answer', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }));
    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sentBody.question).toBe('What is calculus?');
    expect(sentBody.session_id).toBeDefined();
    expect(sentBody.history).toEqual([]);
    expect(result.current.messages).toEqual([
      { role: 'user', content: 'What is calculus?' },
      {
        role: 'assistant',
        content: 'Calculus is the study of change.',
        sourceConcepts: ['Calculus'],
        discoveryConcepts: ['Derivatives', 'Integrals'],
        sourceDocuments: [{ docId: 'doc-1', name: 'Math Notes' }],
        discoveryDocuments: [{ docId: 'doc-2', name: 'Derivative Rules' }],
        sourceChunks: [
          {
            chunkId: 'chunk-1',
            docId: 'doc-1',
            docName: 'Math Notes',
            text: 'Calculus is the study of change.',
          },
        ],
        discoveryChunks: [],
        supportingRelationships: [
          {
            source: 'Calculus',
            target: 'Derivatives',
            type: 'RELATED_TO',
            reason: 'Derivatives are part of calculus.',
          },
        ],
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
        sourceConcepts: [],
        discoveryConcepts: [],
        sourceDocuments: [],
        discoveryDocuments: [],
        sourceChunks: [],
        discoveryChunks: [],
        supportingRelationships: [],
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

  it('deletes the active session and falls back to the next most recent session', () => {
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

    act(() => {
      result.current.deleteSession('session-2');
    });

    expect(result.current.sessions).toHaveLength(1);
    expect(result.current.activeSessionId).toBe('session-1');
    expect(result.current.messages).toEqual([{ role: 'user', content: 'First question' }]);
  });

  it('creates a fresh empty session when deleting the only remaining chat', () => {
    const { result } = renderHook(() => useChat());
    const originalSessionId = result.current.activeSessionId;

    act(() => {
      result.current.deleteSession(originalSessionId);
    });

    expect(result.current.sessions).toHaveLength(1);
    expect(result.current.activeSessionId).not.toBe(originalSessionId);
    expect(result.current.messages).toEqual([]);
    expect(result.current.sessions[0].title).toBe('New chat');
  });

  it('uses prepare plus answer for local traversal queries and exposes activeTraversal while waiting', async () => {
    let resolveAnswer: ((value: {
      ok: boolean;
      json: () => Promise<unknown>;
    }) => void) | null = null;
    const answerPromise = new Promise<{
      ok: boolean;
      json: () => Promise<unknown>;
    }>((resolve) => {
      resolveAnswer = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          route: 'LOCAL',
          requires_direct_query: false,
          prepared_query_id: 'prepared-1',
          source_concepts: ['Calculus'],
          discovery_concepts: ['Derivatives'],
          traversal_plan: {
            root_node_id: 'concept:Calculus',
            step_interval_ms: 160,
            pulse_duration_ms: 320,
            brightness_decay: 0.65,
            brightness_threshold: 0.25,
            steps: [
              {
                node_id: 'concept:Calculus',
                concept: 'Calculus',
                hop: 0,
                brightness: 1,
                delay_ms: 0,
              },
            ],
          },
        }),
      })
      .mockReturnValueOnce(answerPromise);
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useChat());

    let sendPromise: Promise<void>;
    await act(async () => {
      sendPromise = result.current.sendMessage('What is calculus?');
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(result.current.activeTraversal).toEqual({
        runId: 1,
        plan: {
          rootNodeId: 'concept:Calculus',
          stepIntervalMs: 160,
          pulseDurationMs: 320,
          brightnessDecay: 0.65,
          brightnessThreshold: 0.25,
          steps: [
            {
              nodeId: 'concept:Calculus',
              concept: 'Calculus',
              hop: 0,
              brightness: 1,
              delayMs: 0,
            },
          ],
        },
      }),
    );

    expect(fetchMock.mock.calls[0][0]).toBe('/query/prepare');
    expect(fetchMock.mock.calls[1][0]).toBe('/query/answer');

    expect(resolveAnswer).not.toBeNull();
    resolveAnswer!({
      ok: true,
      json: async () => ({
        answer: 'Calculus is the study of change.',
        source_concepts: ['Calculus'],
        discovery_concepts: ['Derivatives'],
        source_documents: [],
        discovery_documents: [],
        source_chunks: [],
        discovery_chunks: [],
        supporting_relationships: [],
      }),
    });

    await act(async () => {
      await sendPromise!;
    });

    await waitFor(() => expect(result.current.activeTraversal).toBeNull());
    expect(result.current.messages.at(-1)?.content).toBe('Calculus is the study of change.');
  });

  it('falls back to the original query endpoint for global queries', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          route: 'GLOBAL',
          requires_direct_query: true,
          prepared_query_id: null,
          source_concepts: [],
          discovery_concepts: [],
          traversal_plan: null,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          answer: 'High level summary',
          source_concepts: ['Calculus'],
          discovery_concepts: [],
          source_documents: [],
          discovery_documents: [],
          source_chunks: [],
          discovery_chunks: [],
          supporting_relationships: [],
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useChat());

    await act(async () => {
      await result.current.sendMessage('Give me a high level summary of calculus');
    });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/query/prepare',
      '/query',
    ]);
    expect(result.current.activeTraversal).toBeNull();
    expect(result.current.messages.at(-1)?.content).toBe('High level summary');
  });

  it('clears activeTraversal when answering fails after prepare succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          route: 'LOCAL',
          requires_direct_query: false,
          prepared_query_id: 'prepared-1',
          source_concepts: ['Calculus'],
          discovery_concepts: ['Derivatives'],
          traversal_plan: {
            root_node_id: 'concept:Calculus',
            step_interval_ms: 160,
            pulse_duration_ms: 320,
            brightness_decay: 0.65,
            brightness_threshold: 0.25,
            steps: [],
          },
        }),
      })
      .mockRejectedValueOnce(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useChat());

    await act(async () => {
      await result.current.sendMessage('What is calculus?');
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.activeTraversal).toBeNull();
    expect(result.current.messages.at(-1)?.content).toBe('I could not reach BrainBank right now.');
  });
});
