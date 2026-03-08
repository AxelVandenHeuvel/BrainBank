import ReactMarkdown from 'react-markdown';

import type { RelationshipDocument } from '../types/graph';

interface MarkdownDocumentViewerProps {
  document: RelationshipDocument;
}

export function MarkdownDocumentViewer({
  document,
}: MarkdownDocumentViewerProps) {
  return (
    <section className="flex min-h-[24rem] flex-col rounded-[1.75rem] border border-white/10 bg-slate-950/70 shadow-2xl shadow-cyan-950/20">
      <div className="border-b border-white/10 px-6 py-5">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200/70">
          Markdown Viewer
        </p>
        <h3 className="mt-2 text-2xl font-semibold text-white">{document.name}</h3>
      </div>
      <article className="min-h-0 flex-1 overflow-y-auto px-6 py-6 text-sm leading-7 text-slate-200">
        <ReactMarkdown
          components={{
            h1: ({ node: _node, ...props }) => (
              <h1 className="mb-4 text-3xl font-semibold tracking-tight text-white" {...props} />
            ),
            h2: ({ node: _node, ...props }) => (
              <h2 className="mb-3 mt-8 text-2xl font-semibold text-white" {...props} />
            ),
            h3: ({ node: _node, ...props }) => (
              <h3 className="mb-3 mt-6 text-xl font-semibold text-white" {...props} />
            ),
            p: ({ node: _node, ...props }) => (
              <p className="mb-4 text-slate-200" {...props} />
            ),
            ul: ({ node: _node, ...props }) => (
              <ul className="mb-4 list-disc space-y-2 pl-6 text-slate-200" {...props} />
            ),
            ol: ({ node: _node, ...props }) => (
              <ol className="mb-4 list-decimal space-y-2 pl-6 text-slate-200" {...props} />
            ),
            li: ({ node: _node, ...props }) => <li className="pl-1" {...props} />,
            blockquote: ({ node: _node, ...props }) => (
              <blockquote
                className="mb-4 border-l-2 border-cyan-300/30 pl-4 italic text-slate-300"
                {...props}
              />
            ),
            code: ({ node: _node, className, children, ...props }) => {
              const isInline = !className;

              if (isInline) {
                return (
                  <code
                    className="rounded bg-slate-900 px-1.5 py-0.5 font-mono text-xs text-cyan-200"
                    {...props}
                  >
                    {children}
                  </code>
                );
              }

              return (
                <code
                  className={`block overflow-x-auto rounded-2xl bg-slate-900 p-4 font-mono text-xs text-cyan-100 ${className}`}
                  {...props}
                >
                  {children}
                </code>
              );
            },
            pre: ({ node: _node, ...props }) => (
              <pre className="mb-4 overflow-x-auto rounded-2xl bg-slate-900 p-4" {...props} />
            ),
            a: ({ node: _node, ...props }) => (
              <a className="text-cyan-300 underline decoration-cyan-400/40 underline-offset-2" {...props} />
            ),
          }}
        >
          {document.full_text}
        </ReactMarkdown>
      </article>
    </section>
  );
}
