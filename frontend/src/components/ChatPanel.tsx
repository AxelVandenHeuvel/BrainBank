import { useState } from 'react';

import { useChat } from '../hooks/useChat';

export function ChatPanel() {
  const {
    messages,
    sessions,
    activeSessionId,
    isLoading,
    createSession,
    selectSession,
    sendMessage,
  } = useChat();
  const [question, setQuestion] = useState('');

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedQuestion = question.trim();
    if (!trimmedQuestion) {
      return;
    }

    setQuestion('');
    await sendMessage(trimmedQuestion);
  }

  return (
    <section
      data-testid="chat-panel-shell"
      className="flex min-h-[24rem] flex-1 flex-col border-l border-white/[0.06] bg-black p-4 lg:h-full lg:min-h-0"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium text-neutral-200">Chat</h2>
          <p className="mt-1 text-[10px] uppercase tracking-widest text-pink-400/70">GraphRAG</p>
        </div>
        <div className="flex items-center gap-3">
          {isLoading ? <span className="text-xs font-medium text-pink-400">Thinking...</span> : null}
          <button
            type="button"
            onClick={createSession}
            className="border border-white/[0.06] bg-neutral-950 px-3 py-1.5 text-xs font-medium text-neutral-300 transition hover:border-pink-500/30"
          >
            New chat
          </button>
        </div>
      </div>

      <div className="mt-4 grid flex-1 gap-4 overflow-hidden lg:grid-cols-[12rem_minmax(0,1fr)]">
        <div className="border-r border-white/[0.06] pr-3">
          <p className="text-[10px] font-medium uppercase tracking-widest text-neutral-500">
            Recent chats
          </p>
          <div className="mt-3 space-y-1">
            {sessions.map((session) => (
              <button
                key={session.id}
                type="button"
                aria-label={session.title}
                aria-pressed={session.id === activeSessionId}
                onClick={() => selectSession(session.id)}
                className={`flex w-full flex-col px-3 py-2 text-left text-sm transition ${
                  session.id === activeSessionId
                    ? 'bg-pink-500/10 text-pink-300'
                    : 'text-neutral-400 hover:bg-white/[0.03]'
                }`}
              >
                <span className="truncate font-medium">{session.title}</span>
                <span className="mt-1 text-xs text-neutral-600">
                  {new Date(session.updatedAt).toLocaleString()}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col overflow-hidden">
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

              return (
                <article
                  key={`${message.role}-${index}`}
                  className={`flex ${isAssistant ? 'justify-start' : 'justify-end'}`}
                >
                  <div
                    className={`max-w-[85%] px-4 py-3 text-sm leading-6 ${
                      isAssistant
                        ? 'border border-white/[0.06] bg-neutral-950 text-neutral-200'
                        : 'bg-pink-500 text-white'
                    }`}
                  >
                    <p>{message.content}</p>
                    {isAssistant ? (
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
                      </div>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>

          <form
            data-testid="chat-panel-form"
            className="mt-4 flex shrink-0 gap-2"
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

interface ConceptSectionProps {
  title: string;
  concepts: string[];
}

function ConceptSection({ title, concepts }: ConceptSectionProps) {
  return (
    <section>
      <p className="text-[10px] font-medium uppercase tracking-widest text-neutral-500">
        {title}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {concepts.map((concept) => (
          <span
            key={`${title}-${concept}`}
            className="border border-pink-500/20 bg-pink-500/10 px-2 py-0.5 text-[11px] font-medium text-pink-300"
          >
            {concept}
          </span>
        ))}
      </div>
    </section>
  );
}
