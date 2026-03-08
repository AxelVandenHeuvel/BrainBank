import { useEffect, useState } from 'react';

import {
  loadActiveSessionId,
  loadSessions,
  saveActiveSessionId,
  saveSessions,
} from '../lib/chatStorage';
import type { ChatMessage, ChatSession } from '../types/chat';

interface QueryResponse {
  answer?: string;
  source_concepts?: string[];
  discovery_concepts?: string[];
}

interface UseChatResult {
  sessions: ChatSession[];
  activeSessionId: string;
  messages: ChatMessage[];
  isLoading: boolean;
  createSession: () => void;
  selectSession: (sessionId: string) => void;
  sendMessage: (question: string) => Promise<void>;
}

const QUERY_ENDPOINT = '/query';
const FALLBACK_ERROR_MESSAGE = 'I could not reach BrainBank right now.';
const DEFAULT_SESSION_TITLE = 'New chat';

function createSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `chat-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createEmptySession(): ChatSession {
  const now = new Date().toISOString();

  return {
    id: createSessionId(),
    title: DEFAULT_SESSION_TITLE,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

function sortSessionsByUpdatedAt(sessions: ChatSession[]): ChatSession[] {
  return [...sessions].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function getSessionTitle(question: string, currentTitle: string): string {
  if (currentTitle !== DEFAULT_SESSION_TITLE) {
    return currentTitle;
  }

  return question.slice(0, 60);
}

export function useChat(): UseChatResult {
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    const storedSessions = sortSessionsByUpdatedAt(loadSessions());
    return storedSessions.length > 0 ? storedSessions : [createEmptySession()];
  });
  const [activeSessionId, setActiveSessionId] = useState<string>(() => {
    const storedSessions = sortSessionsByUpdatedAt(loadSessions());
    const storedActiveSessionId = loadActiveSessionId();
    const hasStoredActiveSession = storedSessions.some(
      (session) => session.id === storedActiveSessionId,
    );

    if (storedActiveSessionId && hasStoredActiveSession) {
      return storedActiveSessionId;
    }

    if (storedSessions.length > 0) {
      return storedSessions[0].id;
    }

    return createEmptySession().id;
  });
  const [isLoading, setIsLoading] = useState(false);
  const activeSession =
    sessions.find((session) => session.id === activeSessionId) ?? sessions[0] ?? createEmptySession();
  const messages = activeSession.messages;

  useEffect(() => {
    saveSessions(sessions);
  }, [sessions]);

  useEffect(() => {
    saveActiveSessionId(activeSessionId);
  }, [activeSessionId]);

  useEffect(() => {
    if (!sessions.some((session) => session.id === activeSessionId)) {
      setActiveSessionId(sessions[0].id);
    }
  }, [activeSessionId, sessions]);

  function createSession() {
    const nextSession = createEmptySession();

    setSessions((previousSessions) => sortSessionsByUpdatedAt([nextSession, ...previousSessions]));
    setActiveSessionId(nextSession.id);
  }

  function selectSession(sessionId: string) {
    if (!sessions.some((session) => session.id === sessionId)) {
      return;
    }

    setActiveSessionId(sessionId);
  }

  function appendMessage(sessionId: string, message: ChatMessage) {
    const nextUpdatedAt = new Date().toISOString();

    setSessions((previousSessions) =>
      sortSessionsByUpdatedAt(
        previousSessions.map((session) =>
          session.id === sessionId
            ? {
                ...session,
                title:
                  message.role === 'user'
                    ? getSessionTitle(message.content, session.title)
                    : session.title,
                updatedAt: nextUpdatedAt,
                messages: [...session.messages, message],
              }
            : session,
        ),
      ),
    );
  }

  async function sendMessage(question: string) {
    const trimmedQuestion = question.trim();

    if (!trimmedQuestion) {
      return;
    }

    appendMessage(activeSession.id, { role: 'user', content: trimmedQuestion });
    setIsLoading(true);

    try {
      const response = await fetch(QUERY_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: trimmedQuestion }),
      });

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      const data = (await response.json()) as QueryResponse;
      appendMessage(activeSession.id, {
        role: 'assistant',
        content: data.answer ?? '',
        sourceConcepts: data.source_concepts ?? [],
        discoveryConcepts: data.discovery_concepts ?? [],
      });
    } catch {
      appendMessage(activeSession.id, {
        role: 'assistant',
        content: FALLBACK_ERROR_MESSAGE,
        sourceConcepts: [],
        discoveryConcepts: [],
      });
    } finally {
      setIsLoading(false);
    }
  }

  return {
    sessions,
    activeSessionId: activeSession.id,
    messages,
    isLoading,
    createSession,
    selectSession,
    sendMessage,
  };
}
