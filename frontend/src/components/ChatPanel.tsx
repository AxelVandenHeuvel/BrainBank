import { useState } from 'react';

import { useChat } from '../hooks/useChat';

export function ChatPanel() {
  const { messages, isLoading, sendMessage } = useChat();
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
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium text-slate-200">Chat</h2>
          <p className="mt-1 text-xs uppercase tracking-[0.24em] text-cyan-200/70">
            LLM test route
          </p>
        </div>
        {isLoading ? (
          <span className="text-xs font-semibold text-cyan-200">Thinking...</span>
        ) : null}
      </div>

      <div
        data-testid="chat-panel-messages"
        className="mt-4 flex-1 space-y-3 overflow-y-auto pr-1 lg:min-h-0"
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
                {isAssistant && message.discoveryConcepts?.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {message.discoveryConcepts.map((concept) => (
                      <span
                        key={concept}
                        className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2.5 py-1 text-[11px] font-semibold tracking-[0.16em] text-cyan-100"
                      >
                        {concept}
                      </span>
                    ))}
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
    </section>
  );
}
