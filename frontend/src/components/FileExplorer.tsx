import { useEffect, useRef, useState, forwardRef, useMemo } from 'react';

import type { FileTreeConcept } from '../hooks/useFileTree';
import type { GraphData } from '../types/graph';

interface FileExplorerProps {
  tree: FileTreeConcept[];
  isLoading: boolean;
  highlightedConcept: string | null;
  onOpenDocument: (docId: string, name: string, conceptName: string) => void;
  onAdoptDocument?: (docId: string) => Promise<void> | void; // NEW: Adopt callback
  graphData?: GraphData;
  searchQuery?: string;
}

export function FileExplorer({
  tree,
  isLoading,
  highlightedConcept,
  onOpenDocument,
  onAdoptDocument,
  graphData,
  searchQuery = '',
}: FileExplorerProps) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [scrollThumbStyle, setScrollThumbStyle] = useState<{
    height: string;
    transform: string;
    opacity: number;
  }>({
    height: '0px',
    transform: 'translateY(0px)',
    opacity: 0,
  });

  const [expandedConcepts, setExpandedConcepts] = useState<Set<string>>(new Set());
  const conceptRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());

  const filteredTree = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (!normalizedQuery) return tree;

    return tree
      .map((concept) => {
        const isConceptMatch = concept.name.toLowerCase().includes(normalizedQuery);
        const matchingDocs = concept.documents.filter((doc) =>
          doc.name.toLowerCase().includes(normalizedQuery),
        );

        if (isConceptMatch || matchingDocs.length > 0) {
          return {
            ...concept,
            documents: isConceptMatch ? concept.documents : matchingDocs,
            isConceptMatch,
          };
        }
        return null;
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);
  }, [tree, searchQuery]);

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

  // Auto-expand everything on search
  useEffect(() => {
    if (searchQuery.trim()) {
      setExpandedConcepts((prev) => {
        const next = new Set(prev);
        filteredTree.forEach((c) => next.add(c.name));
        return next;
      });
    }
  }, [searchQuery, filteredTree]);

  // Scrollbar logic (unchanged)
  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;

    let frameId: number | null = null;

    const updateScrollThumb = () => {
      const { clientHeight, scrollHeight, scrollTop } = scrollContainer;
      const maxScroll = Math.max(scrollHeight - clientHeight, 0);

      if (clientHeight <= 0 || maxScroll <= 0) {
        setScrollThumbStyle({ height: '0px', transform: 'translateY(0px)', opacity: 0 });
        return;
      }

      const thumbHeight = Math.max((clientHeight / scrollHeight) * clientHeight, 24);
      const thumbTravel = Math.max(clientHeight - thumbHeight, 0);
      const thumbOffset = maxScroll === 0 ? 0 : (scrollTop / maxScroll) * thumbTravel;

      setScrollThumbStyle({
        height: `${thumbHeight}px`,
        transform: `translateY(${thumbOffset}px)`,
        opacity: 1,
      });
    };

    const scheduleUpdate = () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => {
        frameId = null;
        updateScrollThumb();
      });
    };

    scheduleUpdate();
    scrollContainer.addEventListener('scroll', scheduleUpdate);
    window.addEventListener('resize', scheduleUpdate);

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(scheduleUpdate);
      resizeObserver.observe(scrollContainer);
    }

    return () => {
      scrollContainer.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);
      resizeObserver?.disconnect();
      if (frameId !== null) cancelAnimationFrame(frameId);
    };
  }, [filteredTree, expandedConcepts, highlightedConcept]);

  function toggleConcept(name: string) {
    setExpandedConcepts((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  return (
    <div data-testid="file-explorer-scroll-shell" className="relative min-h-0 flex-1 pl-3">
      <div
        ref={scrollContainerRef}
        data-testid="file-explorer-scroll-container"
        className="sidebar-files-scroll-container h-full overflow-y-auto"
      >
        {isLoading && tree.length === 0 ? (
          <div className="space-y-2 p-2">
            <p className="text-sm text-neutral-500">Loading...</p>
            <div className="space-y-1">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-7 animate-pulse bg-neutral-900" />
              ))}
            </div>
          </div>
        ) : filteredTree.length === 0 ? (
          <div className="p-2">
            <p className="text-sm text-neutral-500">
              {searchQuery.trim() ? "No matches found" : "No concepts yet"}
            </p>
          </div>
        ) : (
          <div data-testid="file-explorer-tree" className="sidebar-files-content space-y-0.5">
            {filteredTree.map((concept) => (
              <ConceptFolder
                key={concept.name}
                concept={concept}
                isExpanded={expandedConcepts.has(concept.name)}
                isHighlighted={highlightedConcept === concept.name}
                searchQuery={searchQuery}
                onToggle={() => toggleConcept(concept.name)}
                onOpenDocument={onOpenDocument}
                onAdoptDocument={onAdoptDocument}
                ref={(el) => {
                  conceptRefs.current.set(concept.name, el);
                }}
              />
            ))}
          </div>
        )}
      </div>
      <div
        data-testid="file-explorer-scroll-rail"
        className="pointer-events-none absolute bottom-0 left-0 top-0 w-[3px] bg-transparent"
      >
        <div
          data-testid="file-explorer-scroll-thumb"
          className="absolute left-0 w-[3px] rounded-none bg-pink-500"
          style={scrollThumbStyle}
        />
      </div>
    </div>
  );
}

interface ConceptFolderProps {
  concept: FileTreeConcept & { isConceptMatch?: boolean };
  isExpanded: boolean;
  isHighlighted: boolean;
  searchQuery: string;
  onToggle: () => void;
  onOpenDocument: (docId: string, name: string, conceptName: string) => void;
  onAdoptDocument?: (docId: string) => Promise<void> | void;
}

const ConceptFolder = forwardRef<HTMLDivElement, ConceptFolderProps>(
  function ConceptFolder({ concept, isExpanded, isHighlighted, searchQuery, onToggle, onOpenDocument, onAdoptDocument }, ref) {
    const normalizedQuery = searchQuery.trim().toLowerCase();

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
          <span className="truncate">
            <HighlightedText text={concept.name} highlight={normalizedQuery} />
          </span>
          <span className="ml-auto shrink-0 text-xs text-neutral-600">
            {concept.documents.length}
          </span>
        </button>

        {isExpanded && (
          <div className="ml-4 space-y-0.5 border-l border-white/[0.06] pl-2">
            {concept.documents.map((doc: any) => {
              const isExternal = doc.isManaged === false;

              return (
                <div key={doc.docId} className="group flex w-full items-center justify-between transition hover:bg-white/[0.03]">
                  <button
                    type="button"
                    onClick={() => !isExternal && onOpenDocument(doc.docId, doc.name, concept.name)}
                    disabled={isExternal}
                    title={isExternal ? "External File: Adopt to view and index" : ""}
                    className={`flex flex-1 items-center gap-1.5 px-2 py-1 text-left text-sm transition ${
                      isExternal ? 'cursor-not-allowed text-neutral-600' : 'text-neutral-500 hover:text-neutral-300'
                    }`}
                  >
                    {isExternal && (
                      <svg className="h-3.5 w-3.5 shrink-0 text-amber-500/70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <title>Unindexed File</title>
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                    )}
                    <span className="truncate">
                      <HighlightedText text={doc.name} highlight={normalizedQuery} />
                    </span>
                  </button>

                  {isExternal && onAdoptDocument && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onAdoptDocument(doc.docId);
                      }}
                      className="hidden group-hover:block mr-2 shrink-0 rounded bg-pink-500/10 px-2 py-0.5 text-xs text-pink-400 ring-1 ring-inset ring-pink-500/30 hover:bg-pink-500/20"
                    >
                      Adopt
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  },
);

function HighlightedText({ text, highlight }: { text: string; highlight: string }) {
  if (!highlight) return <>{text}</>;

  const parts = text.split(new RegExp(`(${highlight})`, 'gi'));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === highlight.toLowerCase() ? (
          <span key={i} className="bg-pink-500/30 text-pink-100 ring-1 ring-pink-500/40">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}