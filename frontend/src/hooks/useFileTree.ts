import { useCallback, useEffect, useMemo, useState } from 'react';
import { getApiUrl } from '../lib/api';

import type { GraphData } from '../types/graph';

export interface FileTreeDocument {
  docId: string;
  name: string;
}

export interface FileTreeConcept {
  name: string;
  documents: FileTreeDocument[];
}

const NOTES_SECTION_NAME = 'Notes';

interface UseFileTreeResult {
  tree: FileTreeConcept[];
  isLoading: boolean;
  refetch: () => void;
}

interface ConceptApiItem {
  name: string;
  document_count: number;
  related_concepts: string[];
}

interface DocumentApiItem {
  doc_id: string;
  name: string;
  chunk_count: number;
  concepts: string[];
}

/** Derive a file tree from the already-loaded graph data (works in mock mode). */
function buildTreeFromGraphData(graphData: GraphData): FileTreeConcept[] {
  const conceptMap = new Map<string, FileTreeDocument[]>();

  for (const node of graphData.nodes) {
    if (node.type === 'Concept') {
      // Try MENTIONS links first
      conceptMap.set(node.name, []);
    }
  }

  // Populate from MENTIONS links (Document → Concept)
  for (const link of graphData.links) {
    if (link.type !== 'MENTIONS') continue;

    const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
    const targetId = typeof link.target === 'string' ? link.target : link.target.id;

    const docNode = graphData.nodes.find((n) => n.id === sourceId && n.type === 'Document');
    const conceptNode = graphData.nodes.find((n) => n.id === targetId && n.type === 'Concept');

    if (docNode && conceptNode) {
      const docs = conceptMap.get(conceptNode.name);
      if (docs && !docs.some((d) => d.docId === docNode.id)) {
        docs.push({ docId: docNode.id, name: docNode.name });
      }
    }
  }

  return Array.from(conceptMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, documents]) => ({ name, documents }));
}

export function useFileTree(graphData?: GraphData): UseFileTreeResult {
  const [apiTree, setApiTree] = useState<FileTreeConcept[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchKey, setFetchKey] = useState(0);

  const refetch = useCallback(() => {
    setFetchKey((k) => k + 1);
  }, []);

  const graphTree = useMemo(
    () => (graphData ? buildTreeFromGraphData(graphData) : []),
    [graphData],
  );

  useEffect(() => {
    const controller = new AbortController();

    async function loadTree() {
      setIsLoading(true);
      try {
        const [conceptsRes, documentsRes] = await Promise.all([
          fetch(getApiUrl('/api/concepts'), { signal: controller.signal }),
          fetch(getApiUrl('/api/documents'), { signal: controller.signal }),
        ]);

        if (!conceptsRes.ok || !documentsRes.ok) {
          throw new Error('API request failed');
        }

        const conceptsData = (await conceptsRes.json()) as { concepts: ConceptApiItem[] };
        const documentsData = (await documentsRes.json()) as { documents: DocumentApiItem[] };

        const conceptDocMap = new Map<string, FileTreeDocument[]>();

        for (const concept of conceptsData.concepts) {
          conceptDocMap.set(concept.name, []);
        }

        const notesDocuments: FileTreeDocument[] = [];

        for (const doc of documentsData.documents) {
          if (doc.concepts.length === 0) {
            notesDocuments.push({ docId: doc.doc_id, name: doc.name });
            continue;
          }

          for (const conceptName of doc.concepts) {
            const docs = conceptDocMap.get(conceptName);
            if (docs) {
              docs.push({ docId: doc.doc_id, name: doc.name });
            }
          }
        }

        const result: FileTreeConcept[] = Array.from(conceptDocMap.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([name, documents]) => ({ name, documents }));

        if (notesDocuments.length > 0) {
          result.push({ name: NOTES_SECTION_NAME, documents: notesDocuments });
        }

        setApiTree(result.sort((a, b) => a.name.localeCompare(b.name)));
      } catch (error) {
        if (controller.signal.aborted) return;
        // API failed — will fall back to graph-derived tree
        setApiTree(null);
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    void loadTree();

    return () => {
      controller.abort();
    };
  }, [fetchKey]);

  // Merge: API tree items override graph tree items by name, but graph-only items are kept.
  const tree = useMemo(() => {
    if (!apiTree || apiTree.length === 0) return graphTree;
    const apiNames = new Set(apiTree.map((c) => c.name));
    const graphOnly = graphTree.filter((c) => !apiNames.has(c.name));
    return [...apiTree, ...graphOnly].sort((a, b) => a.name.localeCompare(b.name));
  }, [apiTree, graphTree]);

  return { tree, isLoading: isLoading && graphTree.length === 0, refetch };
}
