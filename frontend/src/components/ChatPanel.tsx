import { useEffect, useState } from 'react';

import { useChat } from '../hooks/useChat';
import type {
  AssistantMessageSelection,
  ChatMessage,
  ChatSession,
} from '../types/chat';
import type { GraphSource } from '../types/graph';
import type { ActiveTraversal } from '../types/traversal';
import {
  ConceptSection,
  InlineDocumentLinks,
  ChunkSection,
  RelationshipSection,
} from './ChatCitations';

interface ChatPanelProps {
  graphSource: GraphSource;
  onOpenDocument?: (docId: string, name: string) => void;
  onAssistantMessageSelect?: (selection: AssistantMessageSelection | null) => void;
  onTraversalChange?: (traversal: ActiveTraversal | null) => void;
}

const LOADING_MESSAGES = [
  'Traversing graph',
  'Harnessing concepts',
  'Following semantic bridges',
  'Surfacing latent threads',
  'Aligning context windows',
  'Cross-referencing notes',
  'Untangling knowledge paths',
];
const LOADING_MESSAGE_HOLD_MS = 2600;
const LOADING_MESSAGE_FADE_MS = 520;

export function ChatPanel({
  graphSource,
  onOpenDocument,
  onAssistantMessageSelect,
  onTraversalChange,
}: ChatPanelProps) {
  const {
    messages,
    sessions,
    activeSessionId,
    isLoading,
    activeTraversal,
    createSession,
    deleteSession,
    selectSession,
    sendMessage,
  } = useChat();
  const [question, setQuestion] = useState('');
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [selectedAssistantMessageKey, setSelectedAssistantMessageKey] = useState<string | null>(null);
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const [isLoadingMessageVisible, setIsLoadingMessageVisible] = useState(true);

  const activeSession =
    sessions.find((session) => session.id === activeSessionId) ?? sessions[0] ?? null;
  const latestAssistantMessage = getLatestAssistantMessage(activeSession);
  const highlightedConceptCount = new Set([
    ...(latestAssistantMessage?.sourceConcepts ?? []),
    ...(latestAssistantMessage?.discoveryConcepts ?? []),
  ]).size;

  useEffect(() => {
    if (!isLoading) {
      setLoadingMessageIndex(0);
      setIsLoadingMessageVisible(true);
      return;
    }

    setIsLoadingMessageVisible(true);
    let fadeTimeoutId: number | null = null;

    const intervalId = window.setInterval(() => {
      setIsLoadingMessageVisible(false);
      fadeTimeoutId = window.setTimeout(() => {
        setLoadingMessageIndex((current) => (current + 1) % LOADING_MESSAGES.length);
        setIsLoadingMessageVisible(true);
      }, LOADING_MESSAGE_FADE_MS);
    }, LOADING_MESSAGE_HOLD_MS);

    return () => {
      window.clearInterval(intervalId);
      if (fadeTimeoutId !== null) {
        window.clearTimeout(fadeTimeoutId);
      }
    };
  }, [isLoading]);

  useEffect(() => {
    onTraversalChange?.(activeTraversal);
  }, [activeTraversal, onTraversalChange]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedQuestion = question.trim();
    if (!trimmedQuestion) {
      return;
    }

    setSelectedAssistantMessageKey(null);
    onAssistantMessageSelect?.(null);
    setQuestion('');
    await sendMessage(trimmedQuestion);
  }

  function handleCreateSession() {
    setIsHistoryOpen(false);
    setSelectedAssistantMessageKey(null);
    onAssistantMessageSelect?.(null);
    createSession();
  }

  function handleSelectSession(sessionId: string) {
    setIsHistoryOpen(false);
    setSelectedAssistantMessageKey(null);
    onAssistantMessageSelect?.(null);
    selectSession(sessionId);
  }

  function handleDeleteSession(sessionId: string) {
    if (sessionId === activeSessionId) {
      setSelectedAssistantMessageKey(null);
      onAssistantMessageSelect?.(null);
    }

    deleteSession(sessionId);
  }

  function handleAssistantMessageClick(message: ChatMessage, index: number) {
    const messageKey = getAssistantMessageKey(message, index);

    if (selectedAssistantMessageKey === messageKey) {
      setSelectedAssistantMessageKey(null);
      onAssistantMessageSelect?.(null);
      return;
    }

    setSelectedAssistantMessageKey(messageKey);
    onAssistantMessageSelect?.({
      sourceConcepts: message.sourceConcepts ?? [],
      discoveryConcepts: message.discoveryConcepts ?? [],
      message,
    });
  }

  return (
    <section
      data-testid="chat-panel-shell"
      className="flex min-h-[24rem] flex-1 flex-col border-l border-white/[0.06] bg-black p-4 lg:h-full lg:min-h-0"
    >
      <div className="flex items-start justify-end gap-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleCreateSession}
            className="border border-white/[0.08] bg-neutral-950 px-3 py-1.5 text-xs font-medium text-neutral-300 transition hover:border-pink-500/30"
          >
            New chat
          </button>
        </div>
      </div>

      <div className="relative mt-4 border border-white/[0.06] bg-neutral-950/60 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-medium uppercase tracking-[0.3em] text-neutral-500">
              Active chat
            </p>
            <p className="mt-2 break-words text-sm font-medium leading-5 text-neutral-200">
              {activeSession?.title ?? 'New chat'}
            </p>
            <p className="mt-1 break-words text-xs leading-5 text-neutral-500">
              {activeSession ? formatSessionMeta(activeSession, highlightedConceptCount) : 'No messages yet'}
            </p>
          </div>
          <button
            type="button"
            aria-label="Toggle chat history"
            aria-expanded={isHistoryOpen}
            onClick={() => setIsHistoryOpen((previous) => !previous)}
            className={`inline-flex items-center gap-2 border px-3 py-2 text-xs font-medium transition ${
              isHistoryOpen
                ? 'border-pink-500/40 bg-pink-500/10 text-pink-200'
                : 'border-white/[0.08] bg-black/40 text-neutral-300 hover:border-pink-500/30'
            }`}
          >
            History
            <span className="border border-current/20 px-1.5 py-0.5 text-[10px]">
              {sessions.length}
            </span>
          </button>
        </div>

        {isHistoryOpen ? (
          <div className="mt-3 border-t border-white/[0.06] pt-3">
            <p className="text-[10px] font-medium uppercase tracking-[0.3em] text-neutral-500">
              Recent chats
            </p>
            <div className="mt-3 space-y-2">
              {sessions.map((session) => {
                const sessionConceptCount = new Set([
                  ...collectConcepts(session.messages, 'sourceConcepts'),
                  ...collectConcepts(session.messages, 'discoveryConcepts'),
                ]).size;

                return (
                  <div
                    key={session.id}
                    className={`flex items-start gap-2 border p-2 transition ${
                      session.id === activeSessionId
                        ? 'border-pink-500/30 bg-pink-500/10'
                        : 'border-white/[0.06] bg-black/30'
                    }`}
                  >
                    <button
                      type="button"
                      aria-label={session.title}
                      aria-pressed={session.id === activeSessionId}
                      onClick={() => handleSelectSession(session.id)}
                      className={`flex min-w-0 flex-1 flex-col px-3 py-2 text-left text-sm transition ${
                        session.id === activeSessionId
                          ? 'text-pink-200'
                          : 'text-neutral-300 hover:bg-white/[0.03]'
                      }`}
                    >
                      <span className="break-words font-medium leading-5">{session.title}</span>
                      <span className="mt-1 break-words text-xs leading-5 text-neutral-500">
                        {formatSessionMeta(session, sessionConceptCount)}
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${session.title}`}
                      onClick={() => handleDeleteSession(session.id)}
                      className="shrink-0 border border-white/[0.08] bg-black/40 px-2.5 py-2 text-[10px] font-medium uppercase tracking-[0.2em] text-neutral-400 transition hover:border-rose-500/30 hover:text-rose-300"
                    >
                      Del
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>

      <div
        data-testid="chat-panel-body"
        className="mt-4 flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {graphSource === 'mock' ? (
            <div className="mb-3 shrink-0 border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm leading-6 text-amber-100">
              Graph is showing mock data. Chat only queries live ingested notes from the backend.
            </div>
          ) : null}
          <div
            data-testid="chat-panel-messages"
            className="flex-1 space-y-3 overflow-y-auto pr-1 lg:min-h-0"
          >
            {messages.length === 0 ? (
              <div className="border border-dashed border-white/[0.06] p-4 text-sm leading-6 text-neutral-500">
                Ask a question about your projects, tasks, or connections in the graph.
              </div>
            ) : null}

            {messages.map((message, index) => {
              const isAssistant = message.role === 'assistant';
              const messageKey = getAssistantMessageKey(message, index);
              const isSelectedAssistantMessage =
                isAssistant && selectedAssistantMessageKey === messageKey;

              return (
                <article
                  key={`${message.role}-${index}`}
                  className={`flex ${isAssistant ? 'justify-start' : 'justify-end'}`}
                >
                  {isAssistant ? (
                    <div
                      role="button"
                      tabIndex={0}
                      aria-label={`Select response ${index}`}
                      aria-pressed={isSelectedAssistantMessage}
                      onClick={() => handleAssistantMessageClick(message, index)}
                      onKeyDown={(event) =>
                        handleAssistantMessageKeyDown(event, () =>
                          handleAssistantMessageClick(message, index),
                        )
                      }
                      className={`max-w-[85%] px-4 py-3 text-left text-sm leading-6 transition ${
                        isSelectedAssistantMessage
                          ? 'border border-amber-300/40 bg-amber-300/10 text-neutral-100'
                          : 'border border-white/[0.06] bg-neutral-950 text-neutral-200 hover:border-amber-300/20'
                      }`}
                    >
                      <p>{message.content}</p>
                      <InlineDocumentLinks
                        sourceDocuments={message.sourceDocuments ?? []}
                        discoveryDocuments={message.discoveryDocuments ?? []}
                        onOpenDocument={onOpenDocument}
                      />
                      <div className="mt-3 space-y-3">
                        {message.sourceConcepts?.length ? (
                          <ConceptSection title="Source concepts" concepts={message.sourceConcepts} />
                        ) : null}
                        {message.discoveryConcepts?.length ? (
                          <ConceptSection
                            title="Discovery concepts"
                            concepts={message.discoveryConcepts}
                          />
                        ) : null}
                        {(message.sourceChunks?.length || message.discoveryChunks?.length) ? (
                          <ChunkSection
                            title="Evidence excerpts"
                            chunks={[...(message.sourceChunks ?? []), ...(message.discoveryChunks ?? [])]}
                          />
                        ) : null}
                        {message.supportingRelationships?.length ? (
                          <RelationshipSection
                            title="Supporting relationships"
                            relationships={message.supportingRelationships}
                          />
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <div className="max-w-[85%] bg-pink-500 px-4 py-3 text-sm leading-6 text-white">
                      <p>{message.content}</p>
                    </div>
                  )}
                </article>
              );
            })}

            {isLoading ? (
              <article className="flex justify-start" data-testid="chat-panel-loading">
                <div className="max-w-[85%] border border-white/[0.06] bg-neutral-950 px-4 py-3 text-left text-sm text-neutral-200">
                  <div className="flex items-center gap-2">
                    <span className="flex gap-1 pt-0.5" aria-hidden="true">
                      <span className="h-1.5 w-1.5 rounded-full bg-pink-400/90" />
                      <span className="h-1.5 w-1.5 rounded-full bg-pink-400/70" />
                      <span className="h-1.5 w-1.5 rounded-full bg-pink-400/50" />
                    </span>
                    <span
                      className={`chat-loading-text font-medium text-pink-200 ${
                        isLoadingMessageVisible ? 'is-visible' : ''
                      }`}
                    >
                      {LOADING_MESSAGES[loadingMessageIndex]}
                    </span>
                  </div>
                </div>
              </article>
            ) : null}
          </div>

          <form
            data-testid="chat-panel-form"
            className="mt-auto flex shrink-0 gap-2 pt-4"
            onSubmit={handleSubmit}
          >
            <label htmlFor="chat-question" className="sr-only">
              Ask braen
            </label>
            <input
              id="chat-question"
              type="text"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Ask what matters next"
              className="flex-1 border border-white/[0.06] bg-neutral-950 px-4 py-2.5 text-sm text-neutral-100 outline-none transition placeholder:text-neutral-600 focus:border-pink-500/40"
            />
            <button
              type="submit"
              disabled={isLoading}
              className="bg-pink-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-pink-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Send
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}

function formatSessionMeta(session: ChatSession, conceptCount: number): string {
  const relativeParts = [`${new Date(session.updatedAt).toLocaleString()}`];

  if (session.messages.length > 0) {
    relativeParts.push(`${session.messages.length} messages`);
  }

  if (conceptCount > 0) {
    relativeParts.push(`${conceptCount} highlighted concepts`);
  }

  return relativeParts.join(' • ');
}

function getLatestAssistantMessage(session: ChatSession | null): ChatMessage | null {
  if (!session) {
    return null;
  }

  for (let index = session.messages.length - 1; index >= 0; index -= 1) {
    if (session.messages[index].role === 'assistant') {
      return session.messages[index];
    }
  }

  return null;
}

function collectConcepts(
  messages: ChatMessage[],
  key: 'sourceConcepts' | 'discoveryConcepts',
): string[] {
  return messages.flatMap((message) => message[key] ?? []);
}

function getAssistantMessageKey(message: ChatMessage, index: number): string {
  return `${index}:${message.content}`;
}

function handleAssistantMessageKeyDown(
  event: React.KeyboardEvent<HTMLElement>,
  onSelect: () => void,
) {
  if (event.key !== 'Enter' && event.key !== ' ') {
    return;
  }

  event.preventDefault();
  onSelect();
}

