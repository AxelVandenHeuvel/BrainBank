import { useEffect, useRef, useState } from 'react';
import { getApiUrl } from '../lib/api';

import {
  loadActiveSessionId,
  loadSessions,
  saveActiveSessionId,
  saveSessions,
} from '../lib/chatStorage';
import type {
  ChatChunkCitation,
  ChatDocumentCitation,
  ChatMessage,
  ChatRelationshipCitation,
  ChatSession,
} from '../types/chat';
import type { ActiveTraversal, TraversalPlan } from '../types/traversal';

interface QueryResponse {
  answer?: string;
  source_concepts?: string[];
  discovery_concepts?: string[];
  source_documents?: Array<{ doc_id: string; name: string }>;
  discovery_documents?: Array<{ doc_id: string; name: string }>;
  source_chunks?: Array<{ chunk_id: string; doc_id: string; doc_name: string; text: string }>;
  discovery_chunks?: Array<{ chunk_id: string; doc_id: string; doc_name: string; text: string }>;
  supporting_relationships?: Array<{
    source: string;
    target: string;
    type: string;
    reason?: string | null;
  }>;
}

interface QueryPrepareResponse {
  route?: 'LOCAL' | 'GLOBAL';
  requires_direct_query?: boolean;
  prepared_query_id?: string | null;
  source_concepts?: string[];
  discovery_concepts?: string[];
  traversal_plan?: {
    root_node_id: string;
    step_interval_ms: number;
    pulse_duration_ms: number;
    brightness_decay: number;
    brightness_threshold: number;
    steps: Array<{
      node_id: string;
      concept: string;
      hop: number;
      brightness: number;
      delay_ms: number;
    }>;
  } | null;
}

interface UseChatResult {
  sessions: ChatSession[];
  activeSessionId: string;
  messages: ChatMessage[];
  isLoading: boolean;
  activeTraversal: ActiveTraversal | null;
  createSession: () => void;
  deleteSession: (sessionId: string) => void;
  selectSession: (sessionId: string) => void;
  sendMessage: (question: string) => Promise<void>;
}

const QUERY_ENDPOINT = getApiUrl('/query');
const QUERY_PREPARE_ENDPOINT = getApiUrl('/query/prepare');
const QUERY_ANSWER_ENDPOINT = getApiUrl('/query/answer');

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

function mapDocuments(
  documents: QueryResponse['source_documents'] | QueryResponse['discovery_documents'],
): ChatDocumentCitation[] {
  return (documents ?? []).map((document) => ({
    docId: document.doc_id,
    name: document.name,
  }));
}

function mapChunks(
  chunks: QueryResponse['source_chunks'] | QueryResponse['discovery_chunks'],
): ChatChunkCitation[] {
  return (chunks ?? []).map((chunk) => ({
    chunkId: chunk.chunk_id,
    docId: chunk.doc_id,
    docName: chunk.doc_name,
    text: chunk.text,
  }));
}

function mapRelationships(
  relationships: QueryResponse['supporting_relationships'],
): ChatRelationshipCitation[] {
  return (relationships ?? []).map((relationship) => ({
    source: relationship.source,
    target: relationship.target,
    type: relationship.type,
    reason: relationship.reason,
  }));
}

function mapTraversalPlan(
  traversalPlan: QueryPrepareResponse['traversal_plan'],
): TraversalPlan | null {
  if (!traversalPlan) {
    return null;
  }

  return {
    rootNodeId: traversalPlan.root_node_id,
    stepIntervalMs: traversalPlan.step_interval_ms,
    pulseDurationMs: traversalPlan.pulse_duration_ms,
    brightnessDecay: traversalPlan.brightness_decay,
    brightnessThreshold: traversalPlan.brightness_threshold,
    steps: traversalPlan.steps.map((step) => ({
      nodeId: step.node_id,
      concept: step.concept,
      hop: step.hop,
      brightness: step.brightness,
      delayMs: step.delay_ms,
    })),
  };
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
  const [activeTraversal, setActiveTraversal] = useState<ActiveTraversal | null>(null);
  const traversalRunIdRef = useRef(0);
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

  function deleteSession(sessionId: string) {
    setSessions((previousSessions) => {
      const nextSessions = previousSessions.filter((session) => session.id !== sessionId);

      if (nextSessions.length === 0) {
        const fallbackSession = createEmptySession();
        setActiveSessionId(fallbackSession.id);
        return [fallbackSession];
      }

      if (sessionId === activeSessionId) {
        setActiveSessionId(nextSessions[0].id);
      }

      return sortSessionsByUpdatedAt(nextSessions);
    });
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

  function appendAssistantResponse(sessionId: string, data: QueryResponse) {
    appendMessage(sessionId, {
      role: 'assistant',
      content: data.answer ?? '',
      sourceConcepts: data.source_concepts ?? [],
      discoveryConcepts: data.discovery_concepts ?? [],
      sourceDocuments: mapDocuments(data.source_documents),
      discoveryDocuments: mapDocuments(data.discovery_documents),
      sourceChunks: mapChunks(data.source_chunks),
      discoveryChunks: mapChunks(data.discovery_chunks),
      supportingRelationships: mapRelationships(data.supporting_relationships),
    });
  }

  async function sendMessage(question: string) {
    const trimmedQuestion = question.trim();

    if (!trimmedQuestion) {
      return;
    }

    appendMessage(activeSession.id, { role: 'user', content: trimmedQuestion });
    setIsLoading(true);
    setActiveTraversal(null);

    try {
      const recentHistory = activeSession.messages.slice(-20).map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));

      const requestBody = {
        question: trimmedQuestion,
        session_id: activeSession.id,
        history: recentHistory,
      };
      const prepareResponse = await fetch(QUERY_PREPARE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!prepareResponse.ok) {
        throw new Error(`Request failed with status ${prepareResponse.status}`);
      }

      const prepareData = (await prepareResponse.json()) as QueryPrepareResponse;
      if (prepareData.requires_direct_query) {
        const response = await fetch(QUERY_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }

        const data = (await response.json()) as QueryResponse;
        appendAssistantResponse(activeSession.id, data);
        return;
      }

      const traversalPlan = mapTraversalPlan(prepareData.traversal_plan);
      if (traversalPlan) {
        traversalRunIdRef.current += 1;
        setActiveTraversal({
          runId: traversalRunIdRef.current,
          plan: traversalPlan,
        });
      }

      if (!prepareData.prepared_query_id) {
        throw new Error('Missing prepared query id');
      }

      const answerResponse = await fetch(QUERY_ANSWER_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prepared_query_id: prepareData.prepared_query_id,
          session_id: activeSession.id,
          history: recentHistory,
        }),
      });

      if (!answerResponse.ok) {
        throw new Error(`Request failed with status ${answerResponse.status}`);
      }

      const data = (await answerResponse.json()) as QueryResponse;
      appendAssistantResponse(activeSession.id, data);
    } catch {
      setActiveTraversal(null);
      appendMessage(activeSession.id, {
        role: 'assistant',
        content: FALLBACK_ERROR_MESSAGE,
        sourceConcepts: [],
        discoveryConcepts: [],
        sourceDocuments: [],
        discoveryDocuments: [],
        sourceChunks: [],
        discoveryChunks: [],
        supportingRelationships: [],
      });
    } finally {
      setActiveTraversal(null);
      setIsLoading(false);
    }
  }

  return {
    sessions,
    activeSessionId: activeSession.id,
    messages,
    isLoading,
    activeTraversal,
    createSession,
    deleteSession,
    selectSession,
    sendMessage,
  };
}
