import { useEffect, useRef, useState, forwardRef } from 'react';

import { useFileTree } from '../hooks/useFileTree';
import type { FileTreeConcept } from '../hooks/useFileTree';
import type { GraphData } from '../types/graph';

interface FileExplorerProps {
  highlightedConcept: string | null;
  onOpenDocument: (docId: string, name: string, conceptName: string) => void;
  refetchSignal?: number;
  graphData?: GraphData;
}

export function FileExplorer({ highlightedConcept, onOpenDocument, refetchSignal, graphData }: FileExplorerProps) {
  const { tree, isLoading, refetch } = useFileTree(graphData);

  // Re-fetch when parent signals a change (e.g. after save or ingest)
  useEffect(() => {
    if (refetchSignal && refetchSignal > 0) {
      refetch();
    }
  }, [refetchSignal, refetch]);
  const [expandedConcepts, setExpandedConcepts] = useState<Set<string>>(new Set());
  const conceptRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());

  // Auto-expand and scroll to highlighted concept
  useEffect(() => {
    if (highlightedConcept && tree.some((c) => c.name === highlightedConcept)) {
      setExpandedConcepts((prev) => {
        const next = new Set(prev);
        next.add(highlightedConcept);
        return next;
      });

      requestAnimationFrame(() => {
        const el = conceptRefs.current.get(highlightedConcept);
        if (el && typeof el.scrollIntoView === 'function') {
          el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      });
    }
  }, [highlightedConcept, tree]);

  function toggleConcept(name: string) {
    setExpandedConcepts((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }

  if (isLoading) {
    return (
      <div className="space-y-2 p-2">
        <p className="text-sm text-neutral-500">Loading...</p>
        <div className="space-y-1">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-7 animate-pulse bg-neutral-900" />
          ))}
        </div>
      </div>
    );
  }

  if (tree.length === 0) {
    return (
      <div className="p-2">
        <p className="text-sm text-neutral-500">No concepts yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {tree.map((concept) => (
        <ConceptFolder
          key={concept.name}
          concept={concept}
          isExpanded={expandedConcepts.has(concept.name)}
          isHighlighted={highlightedConcept === concept.name}
          onToggle={() => toggleConcept(concept.name)}
          onOpenDocument={onOpenDocument}
          ref={(el) => {
            conceptRefs.current.set(concept.name, el);
          }}
        />
      ))}
    </div>
  );
}

interface ConceptFolderProps {
  concept: FileTreeConcept;
  isExpanded: boolean;
  isHighlighted: boolean;
  onToggle: () => void;
  onOpenDocument: (docId: string, name: string, conceptName: string) => void;
}

const ConceptFolder = forwardRef<HTMLDivElement, ConceptFolderProps>(
  function ConceptFolder({ concept, isExpanded, isHighlighted, onToggle, onOpenDocument }, ref) {
    return (
      <div ref={ref}>
        <button
          type="button"
          onClick={onToggle}
          className={`flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-sm transition hover:bg-white/[0.03] ${
            isHighlighted ? 'bg-pink-500/10 text-pink-300' : 'text-neutral-400'
          }`}
        >
          <span className="shrink-0 text-xs text-neutral-600">
            {isExpanded ? '\u25BE' : '\u25B8'}
          </span>
          <span className="truncate">{concept.name}</span>
          <span className="ml-auto shrink-0 text-xs text-neutral-600">
            {concept.documents.length}
          </span>
        </button>

        {isExpanded && (
          <div className="ml-4 space-y-0.5 border-l border-white/[0.06] pl-2">
            {concept.documents.map((doc) => (
              <button
                key={doc.docId}
                type="button"
                onClick={() => onOpenDocument(doc.docId, doc.name, concept.name)}
                className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-sm text-neutral-500 transition hover:bg-white/[0.03] hover:text-neutral-300"
              >
                <span className="truncate">{doc.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  },
);
