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
    <section className="space-y-2">
      <h3 className="text-sm font-medium text-neutral-200">{title}</h3>
      <ul className="space-y-2">
        {documents.map((document) => (
          <li
            key={document.doc_id}
            className="border border-white/[0.06] bg-neutral-950 p-3"
          >
            <p className="text-sm font-medium text-pink-300">{document.name}</p>
            <p className="mt-1 text-xs leading-5 text-neutral-400">
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
    <aside
      data-testid="edge-detail-panel"
      className="absolute bottom-4 left-4 z-10 flex max-h-[calc(100%-2rem)] w-[24rem] max-w-[calc(100%-2rem)] flex-col border border-white/[0.08] bg-black/95 p-4 shadow-xl backdrop-blur"
    >
      <div className="flex shrink-0 items-start justify-between gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-neutral-500">
            Relationship
          </p>
          {relationship ? (
            <h2 className="mt-1.5 text-lg font-semibold text-white">
              {relationship.source} to {relationship.target}
            </h2>
          ) : (
            <h2 className="mt-1.5 text-lg font-semibold text-white">
              Relationship details
            </h2>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close relationship details"
          className="border border-white/[0.06] bg-neutral-950 px-3 py-1 text-sm text-neutral-300 transition hover:text-white"
        >
          Close
        </button>
      </div>

      <div
        data-testid="edge-detail-scroll-content"
        className="mt-4 min-h-0 overflow-y-auto overscroll-contain pr-1"
        onWheel={(event) => {
          event.stopPropagation();
        }}
      >
        {isLoading ? (
          <p className="text-sm text-neutral-400">Loading relationship details...</p>
        ) : null}

        {!isLoading && error ? (
          <p className="border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
            {error}
          </p>
        ) : null}

        {!isLoading && relationship ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="border border-pink-500/30 bg-pink-500/10 px-2.5 py-1 text-xs font-medium text-pink-300">
                {relationship.type}
              </span>
              <p className="text-sm text-neutral-300">{relationship.reason}</p>
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
      </div>
    </aside>
  );
}
