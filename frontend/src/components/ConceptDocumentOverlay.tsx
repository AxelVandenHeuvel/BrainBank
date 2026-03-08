import { useEffect, useState } from 'react';

import type { RelationshipDocument } from '../types/graph';
import { MarkdownDocumentViewer } from './MarkdownDocumentViewer';

interface ConceptDocumentOverlayProps {
  conceptName: string;
  documents: RelationshipDocument[] | null;
  onClose: () => void;
}

function getDocumentPreviewText(text: string): string {
  return text
    .replace(/[#>*_`~-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

export function ConceptDocumentOverlay({
  conceptName,
  documents,
  onClose,
}: ConceptDocumentOverlayProps) {
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);

  useEffect(() => {
    if (!documents?.length) {
      setSelectedDocumentId(null);
      return;
    }

    setSelectedDocumentId((current) =>
      documents.some((document) => document.doc_id === current)
        ? current
        : documents[0].doc_id,
    );
  }, [documents]);

  const selectedDocument =
    documents?.find((document) => document.doc_id === selectedDocumentId) ?? null;

  return (
    <div className="absolute inset-0 z-30 flex flex-col overflow-y-auto bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-300">
      <div className="sticky top-0 z-40 mb-8 flex w-full items-center justify-between border-b border-white/10 bg-slate-950/40 px-8 py-6 backdrop-blur-lg">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-200/70">
            Related Documents
          </p>
          <h2 className="mt-2 text-3xl font-bold text-slate-100">{conceptName}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full bg-indigo-600/90 px-6 py-2.5 text-sm font-semibold text-slate-100 shadow-lg shadow-indigo-950/30 transition hover:bg-indigo-500"
        >
          Back to graph (Esc)
        </button>
      </div>

      <div className="grid w-full flex-1 gap-6 px-8 pb-20 lg:grid-cols-[22rem_minmax(0,1fr)]">
        {documents === null ? (
          <div className="col-span-full mt-20 text-center text-xl text-slate-400 animate-pulse">
            Loading documents...
          </div>
        ) : documents.length === 0 ? (
          <div className="col-span-full rounded-[1.75rem] border border-dashed border-white/10 bg-slate-900/50 px-8 py-14 text-center text-slate-400">
            No related documents are available for this concept yet.
          </div>
        ) : (
          <>
            <aside className="rounded-[1.75rem] border border-white/10 bg-slate-900/60 p-4 shadow-xl shadow-slate-950/30">
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-cyan-200/70">
                Documents
              </p>
              <div className="mt-4 space-y-3">
                {documents.map((document) => {
                  const isSelected = document.doc_id === selectedDocumentId;

                  return (
                    <button
                      key={document.doc_id}
                      type="button"
                      onClick={() => setSelectedDocumentId(document.doc_id)}
                      aria-label={document.name}
                      aria-pressed={isSelected}
                      className={`w-full rounded-[1.25rem] border px-4 py-4 text-left transition ${
                        isSelected
                          ? 'border-cyan-300/40 bg-cyan-300/10 shadow-lg shadow-cyan-950/20'
                          : 'border-white/10 bg-slate-950/70 hover:border-cyan-300/25 hover:bg-slate-900'
                      }`}
                    >
                      <span className="block text-lg font-semibold text-slate-100">
                        {document.name}
                      </span>
                      <span className="mt-2 block text-sm leading-6 text-slate-400">
                        {getDocumentPreviewText(document.full_text)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </aside>

            {selectedDocument ? (
              <MarkdownDocumentViewer document={selectedDocument} />
            ) : (
              <section className="flex min-h-[24rem] items-center justify-center rounded-[1.75rem] border border-dashed border-white/10 bg-slate-950/60 p-8 text-center text-slate-400">
                Select a document to read its markdown.
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
