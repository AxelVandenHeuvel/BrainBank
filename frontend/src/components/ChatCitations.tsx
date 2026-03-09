import type {
  ChatChunkCitation,
  ChatDocumentCitation,
  ChatRelationshipCitation,
} from '../types/chat';

interface ConceptSectionProps {
  title: string;
  concepts: string[];
}

export function ConceptSection({ title, concepts }: ConceptSectionProps) {
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

interface InlineDocumentSectionProps {
  label: string;
  documents: ChatDocumentCitation[];
  onOpenDocument?: (docId: string, name: string) => void;
}

function InlineDocumentSection({ label, documents, onOpenDocument }: InlineDocumentSectionProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="text-xs text-neutral-500">{label}</span>
      {documents.map((document, index) => (
        <a
          key={`${label}-${document.docId}`}
          href={`#document-${document.docId}`}
          onClick={(event) => {
            event.stopPropagation();
            event.preventDefault();
            onOpenDocument?.(document.docId, document.name);
          }}
          className="bg-transparent text-xs font-medium text-emerald-200 underline decoration-emerald-300/60 underline-offset-2 transition hover:text-emerald-100"
        >
          {document.name}
          {index < documents.length - 1 ? ',' : ''}
        </a>
      ))}
    </div>
  );
}

interface InlineDocumentLinksProps {
  sourceDocuments: ChatDocumentCitation[];
  discoveryDocuments: ChatDocumentCitation[];
  onOpenDocument?: (docId: string, name: string) => void;
}

export function InlineDocumentLinks({
  sourceDocuments,
  discoveryDocuments,
  onOpenDocument,
}: InlineDocumentLinksProps) {
  const hasAnyDocuments = sourceDocuments.length > 0 || discoveryDocuments.length > 0;

  return (
    <section className="mt-3 border border-white/[0.04] bg-black/20 px-3 py-2.5">
      <p className="text-[10px] font-medium uppercase tracking-widest text-neutral-500">
        Linked documents
      </p>
      <div className="mt-2 space-y-2">
        {sourceDocuments.length > 0 ? (
          <InlineDocumentSection
            label="Source:"
            documents={sourceDocuments}
            onOpenDocument={onOpenDocument}
          />
        ) : null}
        {discoveryDocuments.length > 0 ? (
          <InlineDocumentSection
            label="Discovery:"
            documents={discoveryDocuments}
            onOpenDocument={onOpenDocument}
          />
        ) : null}
        {!hasAnyDocuments ? (
          <p className="text-xs text-neutral-500">
            No linked documents were returned for this response.
          </p>
        ) : null}
      </div>
    </section>
  );
}

interface ChunkSectionProps {
  title: string;
  chunks: ChatChunkCitation[];
}

export function ChunkSection({ title, chunks }: ChunkSectionProps) {
  return (
    <section>
      <p className="text-[10px] font-medium uppercase tracking-widest text-neutral-500">
        {title}
      </p>
      <div className="mt-2 space-y-2">
        {chunks.map((chunk) => (
          <div
            key={`${title}-${chunk.chunkId}`}
            className="border border-white/[0.06] bg-black/40 px-3 py-2 text-xs leading-5 text-neutral-300"
          >
            <p className="mb-1 text-[10px] font-medium uppercase tracking-widest text-neutral-500">
              {chunk.docName}
            </p>
            <p>{chunk.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

interface RelationshipSectionProps {
  title: string;
  relationships: ChatRelationshipCitation[];
}

export function RelationshipSection({ title, relationships }: RelationshipSectionProps) {
  return (
    <section>
      <p className="text-[10px] font-medium uppercase tracking-widest text-neutral-500">
        {title}
      </p>
      <div className="mt-2 space-y-2">
        {relationships.map((relationship) => (
          <div
            key={`${title}-${relationship.source}-${relationship.target}-${relationship.type}`}
            className="border border-white/[0.06] bg-black/40 px-3 py-2 text-xs leading-5 text-neutral-300"
          >
            <p className="font-medium text-neutral-100">
              {relationship.source} {'->'} {relationship.target}
            </p>
            {relationship.reason ? (
              <p className="mt-1 text-neutral-400">{relationship.reason}</p>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
