import { startTransition, useCallback, useDeferredValue, useMemo, useState } from 'react';

import { ChatPanel } from './components/ChatPanel';
import { DocumentEditor } from './components/DocumentEditor';
import { FileExplorer } from './components/FileExplorer';
import { Graph3D } from './components/Graph3D';
import { IngestPanel } from './components/IngestPanel';
import { SearchBar } from './components/SearchBar';
import { TabBar } from './components/TabBar';
import { useGraphData } from './hooks/useGraphData';
import { useFileTree } from './hooks/useFileTree';
import { findMatchingNodeIds } from './lib/graphView';
import { getMockDocumentsForConcept } from './mock/mockGraph';
import type { AssistantMessageSelection } from './types/chat';
import type { OpenTab } from './types/notes';
import type { ActiveTraversal } from './types/traversal';

const BRAIN_TAB_ID = '__brain__';

function getChatToggleLabel(isChatOpen: boolean): string {
  return isChatOpen ? 'Close chat panel' : 'Open chat panel';
}

let nextNewNoteId = 1;
function generateNewNoteId(): string {
  return `new-note-${Date.now()}-${nextNewNoteId++}`;
}

export default function App() {
  const { data, source, refetch } = useGraphData();
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Tab system state
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>(BRAIN_TAB_ID);
  const [highlightedConcept, setHighlightedConcept] = useState<string | null>(null);

  const { tree, isLoading: isTreeLoading, refetch: refetchTree } = useFileTree(data);

  const matchCount = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLowerCase();
    if (!normalizedQuery) return 0;

    const nodeMatches = findMatchingNodeIds(data.nodes, deferredQuery);
    const nodeMatchIds = new Set(nodeMatches);

    // Also count matches in file tree that might not be in the graph nodes
    let extraMatches = 0;
    tree.forEach((concept) => {
      // If concept name matches and it's not already a matching node
      const isConceptMatching = concept.name.toLowerCase().includes(normalizedQuery);
      const isNodeMatch = data.nodes.some(n => n.name === concept.name && nodeMatchIds.has(n.id));

      if (isConceptMatching && !isNodeMatch) {
        extraMatches++;
      }

      concept.documents.forEach((doc) => {
        const isDocMatching = doc.name.toLowerCase().includes(normalizedQuery);
        const isDocNodeMatch = data.nodes.some(n => n.id === doc.docId && nodeMatchIds.has(n.id));
        if (isDocMatching && !isDocNodeMatch) {
          extraMatches++;
        }
      });
    });

    return nodeMatches.size + extraMatches;
  }, [data.nodes, tree, deferredQuery]);

  const [selectedAssistantMessage, setSelectedAssistantMessage] =
    useState<AssistantMessageSelection | null>(null);
  const [activeTraversal, setActiveTraversal] = useState<ActiveTraversal | null>(null);

  // --- Tab management ---

  const openDocument = useCallback((
    docId: string,
    name: string,
    content: string,
    options?: { isLoading?: boolean },
  ) => {
    setOpenTabs((prev) => {
      const existingTab = prev.find((t) => t.id === docId);

      if (existingTab) {
        return prev.map((tab) => (
          tab.id === docId
            ? {
              ...tab,
              title: name,
              content: content || tab.content,
              isLoading: options?.isLoading ?? false,
            }
            : tab
        ));
      }

      return [
        ...prev,
        { id: docId, title: name, content, isNew: false, isLoading: options?.isLoading ?? false },
      ];
    });
    setActiveTabId(docId);
  }, []);

  function closeTab(tabId: string) {
    if (tabId === BRAIN_TAB_ID) return;
    setOpenTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === tabId);
      if (idx === -1) return prev;
      const next = prev.filter((t) => t.id !== tabId);
      if (tabId === activeTabId) {
        if (next.length === 0) {
          setActiveTabId(BRAIN_TAB_ID);
        } else if (idx < next.length) {
          setActiveTabId(next[idx].id);
        } else {
          setActiveTabId(next[next.length - 1].id);
        }
      }
      return next;
    });
  }

  function selectTab(tabId: string) {
    setActiveTabId(tabId);
  }

  function handleTabTitleChange(tabId: string, newTitle: string) {
    setOpenTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, title: newTitle } : t)),
    );
  }

  function handleDocSaved(docId: string, newDocId?: string, currentContent?: string) {
    const wasNewTab = openTabs.find((t) => t.id === docId)?.isNew ?? false;

    setOpenTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === docId);
      if (idx === -1) return prev;

      const savedTab = prev[idx];

      if (savedTab.isNew) {
        const next = prev.filter((t) => t.id !== docId);
        if (activeTabId === docId) {
          if (next.length === 0) {
            setActiveTabId(BRAIN_TAB_ID);
          } else if (idx < next.length) {
            setActiveTabId(next[idx].id);
          } else {
            setActiveTabId(next[next.length - 1].id);
          }
        }
        return next;
      }

      return prev.map((t) => {
        if (t.id !== docId) return t;
        // Update the tab id, preserve content so remount doesn't lose it, mark as not new
        return {
          ...t,
          id: newDocId ?? docId,
          isNew: false,
          isLoading: false,
          content: currentContent ?? t.content,
        };
      });
    }
    );
    if (!wasNewTab && newDocId && activeTabId === docId) {
      setActiveTabId(newDocId);
    }
    refetch();
    refetchTree();
  }

  function handleNewNote() {
    const id = generateNewNoteId();
    const newTab: OpenTab = { id, title: 'Untitled', content: '', isNew: true };
    setOpenTabs((prev) => [...prev, newTab]);
    setActiveTabId(id);
  }

  // FileExplorer: open doc tab immediately with mock content, then try API
  function handleFileExplorerOpenDocument(docId: string, name: string, conceptName: string) {
    const mockDocs = getMockDocumentsForConcept(conceptName);
    const mockDoc = mockDocs.find((d) => d.doc_id === docId);
    const content = mockDoc?.full_text ?? '';
    openDocument(docId, name, content, { isLoading: source === 'api' && content.length === 0 });

    if (source === 'api') {
      fetch(`/api/documents/${encodeURIComponent(docId)}`)
        .then((res) => {
          if (!res.ok) throw new Error('fetch failed');
          return res.json();
        })
        .then((doc: { doc_id: string; name: string; full_text: string }) => {
          setOpenTabs((prev) =>
            prev.map((t) => (
              t.id === docId
                ? { ...t, title: doc.name, content: doc.full_text, isLoading: false }
                : t
            )),
          );
        })
        .catch(() => {
          setOpenTabs((prev) =>
            prev.map((t) => (t.id === docId ? { ...t, isLoading: false } : t)),
          );
        });
    }
  }

  function handleChatOpenDocument(docId: string, name: string) {
    openDocument(docId, name, '', { isLoading: true });

    fetch(`/api/documents/${encodeURIComponent(docId)}`)
      .then((res) => {
        if (!res.ok) throw new Error('fetch failed');
        return res.json();
      })
      .then((doc: { doc_id: string; name: string; full_text: string }) => {
        setOpenTabs((prev) =>
          prev.map((tab) => (
            tab.id === docId
              ? { ...tab, title: doc.name, content: doc.full_text, isLoading: false }
              : tab
          )),
        );
      })
      .catch(() => {
        setOpenTabs((prev) =>
          prev.map((tab) => (tab.id === docId ? { ...tab, isLoading: false } : tab)),
        );
      });
  }

  const allTabs = useMemo<OpenTab[]>(() => {
    const brainTab: OpenTab = { id: BRAIN_TAB_ID, title: 'Brain', content: '', isNew: false, closable: false };
    return [brainTab, ...openTabs];
  }, [openTabs]);

  const activeDocTab = activeTabId !== BRAIN_TAB_ID
    ? openTabs.find((t) => t.id === activeTabId) ?? null
    : null;

  function handleQueryChange(nextQuery: string) {
    startTransition(() => {
      setQuery(nextQuery);
    });
  }

  return (
    <main className="min-h-screen bg-black text-neutral-100 lg:h-screen lg:overflow-hidden">
      <div
        data-testid="app-shell"
        className="relative mx-auto flex min-h-screen w-full max-w-[1800px] gap-0 px-3 py-3 lg:h-screen lg:overflow-hidden lg:px-4"
      >
        {/* Collapsible sidebar */}
        <aside
          data-testid="sidebar"
          className={`flex shrink-0 flex-col border-r border-white/[0.06] bg-black transition-all duration-300 ease-in-out lg:min-h-0 ${sidebarCollapsed ? 'w-[3rem]' : 'w-[22rem] p-4'
            }`}
        >
          {/* Branding + toggle */}
          <div className={`flex items-center ${sidebarCollapsed ? 'flex-col gap-2' : 'justify-between'} mb-4`}>
            <span className={`font-bold tracking-tight text-white ${sidebarCollapsed ? 'text-[10px]' : 'text-sm'}`}>braen.</span>
            <button
              type="button"
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="text-neutral-500 transition hover:text-pink-400"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className={`h-4 w-4 transition-transform duration-300 ${sidebarCollapsed ? 'rotate-180' : ''
                  }`}
              >
                <path
                  fillRule="evenodd"
                  d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>

          {/* Sidebar content - hidden when collapsed */}
          <div
            data-testid="sidebar-content"
            className={`flex flex-col gap-4 overflow-hidden transition-opacity duration-300 ${sidebarCollapsed ? 'pointer-events-none h-0 opacity-0' : 'opacity-100'
              }`}
          >
            <IngestPanel onIngestComplete={() => { refetch(); refetchTree(); }} onNewNote={handleNewNote} />

            <section
              data-testid="sidebar-files-section"
              className="min-h-0 flex flex-1 flex-col border-t border-white/[0.06] pt-3"
            >
              <p className="mb-2 px-1 text-left text-[10px] font-medium uppercase tracking-widest text-neutral-500">
                Files
              </p>
              <FileExplorer
                tree={tree}
                isLoading={isTreeLoading}
                highlightedConcept={highlightedConcept}
                onOpenDocument={handleFileExplorerOpenDocument}
                graphData={data}
                searchQuery={deferredQuery}
              />
            </section>
          </div>
        </aside>

        {/* Main content area: top bar + tabs + content */}
        <div className="flex h-full min-w-0 flex-1 flex-col">
          {/* Top bar with search */}
          <div
            data-testid="top-bar"
            className="border-b border-white/[0.06] bg-black px-4 py-2.5"
          >
            <SearchBar query={query} matchCount={matchCount} onQueryChange={handleQueryChange} />
          </div>

          {/* Tab bar — always visible */}
          <TabBar
            tabs={allTabs}
            activeTabId={activeTabId}
            onSelectTab={selectTab}
            onCloseTab={closeTab}
          />

          {/* Graph — always mounted, hidden via CSS when a doc tab is active */}
          <section
            className={
              activeTabId !== BRAIN_TAB_ID
                ? 'invisible absolute -z-10 h-0 w-0 overflow-hidden'
                : 'relative min-h-0 flex-1 overflow-hidden border-b border-white/[0.06]'
            }
          >
            <Graph3D
              data={data}
              source={source}
              query={deferredQuery}
              activeTraversal={activeTraversal}
              chatFocus={
                selectedAssistantMessage
                  ? {
                    sourceConcepts: selectedAssistantMessage.sourceConcepts,
                    discoveryConcepts: selectedAssistantMessage.discoveryConcepts,
                  }
                  : null
              }
              onOpenDocument={openDocument}
              onConceptFocused={setHighlightedConcept}
            />
          </section>

          {/* Document editor — shown when a doc tab is active */}
          {activeDocTab && (
            <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {activeDocTab.isLoading ? (
                <div
                  data-testid="document-loading-state"
                  className="flex h-full items-center justify-center px-6 text-sm text-neutral-500"
                >
                  Loading note...
                </div>
              ) : (
                <DocumentEditor
                  key={activeTabId}
                  docId={activeDocTab.id}
                  initialTitle={activeDocTab.title}
                  initialContent={activeDocTab.content}
                  isNew={activeDocTab.isNew}
                  onTitleChange={handleTabTitleChange}
                  onSaved={handleDocSaved}
                />
              )}
            </section>
          )}
        </div>

        {/* Chat sidebar */}
        <aside
          data-testid="chat-sidebar"
          className={`flex shrink-0 flex-col border-l border-white/[0.06] bg-black transition-all duration-300 ease-in-out lg:min-h-0 ${isChatOpen ? 'w-[24rem]' : 'w-[3rem]'
            }`}
        >
          {/* Chat header with toggle */}
          <div className={`flex items-center ${isChatOpen ? 'justify-between px-4' : 'justify-center'} py-3`}>
            {isChatOpen && (
              <span className="text-[10px] font-semibold uppercase tracking-widest text-pink-400">Chat</span>
            )}
            <button
              type="button"
              aria-label={getChatToggleLabel(isChatOpen)}
              onClick={() => setIsChatOpen(!isChatOpen)}
              className="text-neutral-500 transition hover:text-pink-400"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className={`h-4 w-4 transition-transform duration-300 ${isChatOpen ? '' : 'rotate-180'
                  }`}
              >
                <path
                  fillRule="evenodd"
                  d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>

          {/* Chat content */}
          <div
            className={`flex min-h-0 flex-1 flex-col overflow-hidden transition-opacity duration-300 ${isChatOpen ? 'opacity-100' : 'pointer-events-none h-0 opacity-0'
              }`}
          >
            <ChatPanel
              graphSource={source}
              onOpenDocument={handleChatOpenDocument}
              onAssistantMessageSelect={setSelectedAssistantMessage}
              onTraversalChange={setActiveTraversal}
            />
          </div>
        </aside>
      </div>
    </main>
  );
}
