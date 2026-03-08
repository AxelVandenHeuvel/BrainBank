import { afterEach, describe, expect, it } from 'vitest';

import {
  loadActiveSessionId,
  loadSessions,
  saveActiveSessionId,
  saveSessions,
} from './chatStorage';

const CHAT_SESSIONS_KEY = 'brainbank.chat.sessions';
const CHAT_ACTIVE_SESSION_KEY = 'brainbank.chat.activeSessionId';

describe('chatStorage', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('saves and loads chat sessions', () => {
    const sessions = [
      {
        id: 'session-1',
        title: 'New chat',
        createdAt: '2026-03-07T18:00:00.000Z',
        updatedAt: '2026-03-07T18:01:00.000Z',
        messages: [{ role: 'user' as const, content: 'What matters next?' }],
      },
    ];

    saveSessions(sessions);

    expect(localStorage.getItem(CHAT_SESSIONS_KEY)).toBeTruthy();
    expect(loadSessions()).toEqual(sessions);
  });

  it('saves and loads the active session id', () => {
    saveActiveSessionId('session-2');

    expect(loadActiveSessionId()).toBe('session-2');
  });

  it('falls back safely when localStorage contains malformed data', () => {
    localStorage.setItem(CHAT_SESSIONS_KEY, '{broken json');
    localStorage.setItem(CHAT_ACTIVE_SESSION_KEY, '{"not":"a string"}');

    expect(loadSessions()).toEqual([]);
    expect(loadActiveSessionId()).toBeNull();
  });
});
