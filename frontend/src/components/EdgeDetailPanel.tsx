import type { RelationshipDetails } from '../types/graph';

interface EdgeDetailPanelProps {
  relationship: RelationshipDetails | null;
  isLoading: boolean;
  error: string | null;
  onClose: () => void;
}

interface DocumentListProps {
  title: string;
  documents: RelationshipDetails['source_documents'];
}

function DocumentList({ title, documents }: DocumentListProps) {
  if (!documents.length) {
    return null;
  }

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
      <ul className="space-y-2">
        {documents.map((document) => (
          <li
            key={document.doc_id}
            className="rounded-2xl border border-white/10 bg-slate-900/70 p-3"
          >
            <p className="text-sm font-medium text-sky-200">{document.name}</p>
            <p className="mt-1 text-xs leading-5 text-slate-300">
              {document.full_text}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function EdgeDetailPanel({
  relationship,
  isLoading,
  error,
  onClose,
}: EdgeDetailPanelProps) {
  const sharedDocuments = relationship
    ? relationship.source_documents.filter((document) =>
        relationship.shared_document_ids.includes(document.doc_id),
      )
    : [];
  const sourceOnlyDocuments = relationship
    ? relationship.source_documents.filter(
        (document) => !relationship.shared_document_ids.includes(document.doc_id),
      )
    : [];
  const targetOnlyDocuments = relationship
    ? relationship.target_documents.filter(
        (document) => !relationship.shared_document_ids.includes(document.doc_id),
      )
    : [];

  return (
    <aside className="absolute bottom-4 left-4 z-10 w-[24rem] max-w-[calc(100%-2rem)] rounded-[1.75rem] border border-white/10 bg-slate-950/90 p-5 shadow-[0_30px_80px_rgba(2,6,23,0.7)] backdrop-blur">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-slate-400">
            Relationship
          </p>
          {relationship ? (
            <h2 className="mt-2 text-lg font-semibold text-white">
              {relationship.source} to {relationship.target}
            </h2>
          ) : (
            <h2 className="mt-2 text-lg font-semibold text-white">
              Relationship details
            </h2>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close relationship details"
          className="rounded-full border border-white/10 bg-slate-900/80 px-3 py-1 text-sm text-slate-200 transition hover:bg-slate-800"
        >
          Close
        </button>
      </div>

      {isLoading ? (
        <p className="mt-4 text-sm text-slate-300">Loading relationship details...</p>
      ) : null}

      {!isLoading && error ? (
        <p className="mt-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-200">
          {error}
        </p>
      ) : null}

      {!isLoading && relationship ? (
        <div className="mt-4 space-y-4">
          <div className="flex items-center gap-3">
            <span className="rounded-full border border-sky-400/30 bg-sky-500/10 px-3 py-1 text-xs font-semibold tracking-[0.24em] text-sky-200">
              {relationship.type}
            </span>
            <p className="text-sm text-slate-200">{relationship.reason}</p>
          </div>
          {!error ? (
            <>
              <DocumentList title="Shared documents" documents={sharedDocuments} />
              <DocumentList
                title="Source-only documents"
                documents={sourceOnlyDocuments}
              />
              <DocumentList
                title="Target-only documents"
                documents={targetOnlyDocuments}
              />
            </>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}
