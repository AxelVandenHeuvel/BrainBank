import type { ChatMessage, ChatSession } from '../types/chat';

export const CHAT_SESSIONS_KEY = 'brainbank.chat.sessions';
export const CHAT_ACTIVE_SESSION_KEY = 'brainbank.chat.activeSessionId';

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  const hasValidRole = candidate.role === 'user' || candidate.role === 'assistant';
  const hasValidContent = typeof candidate.content === 'string';
  const hasValidDiscoveryConcepts =
    candidate.discoveryConcepts === undefined ||
    (Array.isArray(candidate.discoveryConcepts) &&
      candidate.discoveryConcepts.every((item) => typeof item === 'string'));

  return hasValidRole && hasValidContent && hasValidDiscoveryConcepts;
}

function isChatSession(value: unknown): value is ChatSession {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.createdAt === 'string' &&
    typeof candidate.updatedAt === 'string' &&
    Array.isArray(candidate.messages) &&
    candidate.messages.every(isChatMessage)
  );
}

function readStorageValue(key: string): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function loadSessions(): ChatSession[] {
  const rawValue = readStorageValue(CHAT_SESSIONS_KEY);

  if (!rawValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isChatSession) : [];
  } catch {
    return [];
  }
}

export function saveSessions(sessions: ChatSession[]): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(CHAT_SESSIONS_KEY, JSON.stringify(sessions));
}

export function loadActiveSessionId(): string | null {
  const rawValue = readStorageValue(CHAT_ACTIVE_SESSION_KEY);

  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    return typeof parsed === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

export function saveActiveSessionId(sessionId: string | null): void {
  if (typeof window === 'undefined') {
    return;
  }

  if (sessionId === null) {
    window.localStorage.removeItem(CHAT_ACTIVE_SESSION_KEY);
    return;
  }

  window.localStorage.setItem(CHAT_ACTIVE_SESSION_KEY, JSON.stringify(sessionId));
}
