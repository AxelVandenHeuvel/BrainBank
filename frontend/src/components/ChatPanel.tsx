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
      className="flex min-h-[24rem] flex-1 flex-col rounded-3xl border border-white/10 bg-slate-900/60 p-4 lg:h-full lg:min-h-0"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium text-slate-200">Chat</h2>
          <p className="mt-1 text-xs uppercase tracking-[0.24em] text-cyan-200/70">GraphRAG</p>
        </div>
        <div className="flex items-center gap-3">
          {isLoading ? <span className="text-xs font-semibold text-cyan-200">Thinking...</span> : null}
          <button
            type="button"
            onClick={createSession}
            className="rounded-2xl border border-cyan-300/20 bg-slate-950/80 px-3 py-2 text-xs font-semibold text-cyan-100 transition hover:border-cyan-300/40"
          >
            New chat
          </button>
        </div>
      </div>

      <div className="mt-4 grid flex-1 gap-4 overflow-hidden lg:grid-cols-[12rem_minmax(0,1fr)]">
        <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-3">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
            Recent chats
          </p>
          <div className="mt-3 space-y-2">
            {sessions.map((session) => (
              <button
                key={session.id}
                type="button"
                aria-label={session.title}
                aria-pressed={session.id === activeSessionId}
                onClick={() => selectSession(session.id)}
                className={`flex w-full flex-col rounded-2xl border px-3 py-2 text-left text-sm transition ${
                  session.id === activeSessionId
                    ? 'border-cyan-300/40 bg-cyan-300/10 text-cyan-100'
                    : 'border-white/10 bg-slate-900/70 text-slate-300 hover:border-cyan-300/20'
                }`}
              >
                <span className="truncate font-medium">{session.title}</span>
                <span className="mt-1 text-xs text-slate-400">
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
            className="flex-1 space-y-3 overflow-y-auto pr-1"
          >
            {messages.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-cyan-300/15 bg-slate-950/60 p-4 text-sm leading-6 text-slate-400">
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
                    className={`max-w-[85%] rounded-3xl px-4 py-3 text-sm leading-6 shadow-lg ${
                      isAssistant
                        ? 'border border-white/10 bg-slate-950/90 text-slate-100'
                        : 'bg-cyan-400 text-slate-950'
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
            className="mt-4 flex shrink-0 gap-3"
            onSubmit={handleSubmit}
          >
            <label htmlFor="chat-question" className="sr-only">
              Ask BrainBank
            </label>
            <input
              id="chat-question"
              type="text"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Ask what matters next"
              className="flex-1 rounded-2xl border border-cyan-300/20 bg-slate-950/90 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-cyan-300/60"
            />
            <button
              type="submit"
              disabled={isLoading}
              className="rounded-2xl bg-cyan-300 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:bg-cyan-300/50"
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
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
        {title}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {concepts.map((concept) => (
          <span
            key={`${title}-${concept}`}
            className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2.5 py-1 text-[11px] font-semibold tracking-[0.16em] text-cyan-100"
          >
            {concept}
          </span>
        ))}
      </div>
    </section>
  );
}
