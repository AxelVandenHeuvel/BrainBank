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
    <div className="absolute inset-0 z-30 flex flex-col overflow-y-auto bg-black/90 backdrop-blur-md animate-in fade-in duration-300">
      <div className="sticky top-0 z-40 mb-6 flex w-full items-center justify-between border-b border-white/[0.06] bg-black/60 px-8 py-5 backdrop-blur-lg">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-widest text-pink-400/70">
            Related Documents
          </p>
          <h2 className="mt-1.5 text-2xl font-bold text-neutral-100">{conceptName}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="bg-pink-500 px-5 py-2 text-sm font-medium text-white transition hover:bg-pink-400"
        >
          Back to graph (Esc)
        </button>
      </div>

      <div className="grid w-full flex-1 gap-6 px-8 pb-20 lg:grid-cols-[22rem_minmax(0,1fr)]">
        {documents === null ? (
          <div className="col-span-full mt-20 text-center text-xl text-neutral-500 animate-pulse">
            Loading documents...
          </div>
        ) : documents.length === 0 ? (
          <div className="col-span-full border border-dashed border-white/[0.06] px-8 py-14 text-center text-neutral-500">
            No related documents are available for this concept yet.
          </div>
        ) : (
          <>
            <aside className="border-r border-white/[0.06] pr-4">
              <p className="text-[10px] font-medium uppercase tracking-widest text-pink-400/70">
                Documents
              </p>
              <div className="mt-4 space-y-1">
                {documents.map((document) => {
                  const isSelected = document.doc_id === selectedDocumentId;

                  return (
                    <button
                      key={document.doc_id}
                      type="button"
                      onClick={() => setSelectedDocumentId(document.doc_id)}
                      aria-label={document.name}
                      aria-pressed={isSelected}
                      className={`w-full px-4 py-3 text-left transition ${
                        isSelected
                          ? 'bg-pink-500/10 text-pink-300'
                          : 'text-neutral-400 hover:bg-white/[0.03]'
                      }`}
                    >
                      <span className="block text-sm font-medium text-neutral-100">
                        {document.name}
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-neutral-500">
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
              <section className="flex min-h-[24rem] items-center justify-center border border-dashed border-white/[0.06] p-8 text-center text-neutral-500">
                Select a document to read its markdown.
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
