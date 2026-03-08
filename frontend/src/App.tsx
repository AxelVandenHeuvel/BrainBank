import { startTransition, useDeferredValue, useState } from 'react';

import { ChatPanel } from './components/ChatPanel';
import { Graph3D } from './components/Graph3D';
import { IngestPanel } from './components/IngestPanel';
import { NoteEditor } from './components/NoteEditor';
import { SearchBar } from './components/SearchBar';
import { useGraphData } from './hooks/useGraphData';
import { NODE_TYPE_COLORS, findMatchingNodeIds } from './lib/graphView';
import type { GraphNode, GraphNodeType } from './types/graph';

const NODE_TYPES: GraphNodeType[] = [
  'Concept',
  'Document',
  'Project',
  'Task',
  'Reflection',
];

function formatSourceLabel(source: 'api' | 'mock'): string {
  return source === 'api' ? 'Live API' : 'Mock data';
}

function getChatToggleLabel(isChatOpen: boolean): string {
  return isChatOpen ? 'Close chat panel' : 'Open chat panel';
}

export default function App() {
  const { data, source, isLoading, error, refetch } = useGraphData();
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [view, setView] = useState<'graph' | 'editor'>('graph');
  const [isChatOpen, setIsChatOpen] = useState(true);
  const matchCount = findMatchingNodeIds(data.nodes, deferredQuery).size;

  function handleQueryChange(nextQuery: string) {
    startTransition(() => {
      setQuery(nextQuery);
    });
  }

  function handleNoteSaved() {
    refetch();
    setView('graph');
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 lg:h-screen lg:overflow-hidden">
      <div
        className={`mx-auto grid min-h-screen w-full max-w-[1800px] gap-6 px-4 py-4 lg:h-screen lg:overflow-hidden lg:px-6 ${
          isChatOpen
            ? 'lg:grid-cols-[22rem_minmax(0,1fr)_24rem]'
            : 'lg:grid-cols-[22rem_minmax(0,1fr)]'
        }`}
      >
        <aside className="flex flex-col gap-4 rounded-[2rem] border border-white/10 bg-slate-950/75 p-5 shadow-2xl shadow-cyan-950/20 backdrop-blur lg:min-h-0 lg:overflow-y-auto">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-cyan-200/70">
              Cognitive Map
            </p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight text-white">BrainBank</h1>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Explore your knowledge graph as a living neural landscape.
            </p>
          </div>

          <SearchBar query={query} matchCount={matchCount} onQueryChange={handleQueryChange} />

          <IngestPanel onIngestComplete={refetch} onNewNote={() => setView('editor')} />

          <section className="rounded-3xl border border-white/10 bg-slate-900/60 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-200">Data source</span>
              <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs font-semibold text-cyan-200">
                {formatSourceLabel(source)}
              </span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-slate-300">
              <div className="rounded-2xl bg-slate-950/70 p-3">
                <p className="text-slate-500">Nodes</p>
                <p className="mt-1 text-2xl font-semibold text-white">{data.nodes.length}</p>
              </div>
              <div className="rounded-2xl bg-slate-950/70 p-3">
                <p className="text-slate-500">Edges</p>
                <p className="mt-1 text-2xl font-semibold text-white">{data.links.length}</p>
              </div>
            </div>
            {error ? (
              <p className="mt-4 text-xs leading-5 text-amber-300/90">
                Using mock graph because the API was unavailable: {error}
              </p>
            ) : null}
          </section>

          <section className="rounded-3xl border border-white/10 bg-slate-900/60 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-slate-200">Node legend</h2>
              {isLoading ? (
                <span className="text-xs uppercase tracking-[0.24em] text-cyan-200/70">
                  Loading
                </span>
              ) : null}
            </div>
            <div className="mt-4 space-y-3">
              {NODE_TYPES.map((type) => (
                <div key={type} className="flex items-center gap-3 text-sm text-slate-300">
                  <span
                    className="h-3 w-3 rounded-full shadow-[0_0_18px_currentColor]"
                    style={{ backgroundColor: NODE_TYPE_COLORS[type], color: NODE_TYPE_COLORS[type] }}
                  />
                  <span>{type}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-slate-900/60 p-4 text-sm text-slate-300">
            <h2 className="font-medium text-slate-200">Hover details</h2>
            <p className="mt-3 leading-6">
              {hoveredNode
                ? `${hoveredNode.name} is active in the graph.`
                : 'Hover a node to inspect its local neighborhood.'}
            </p>
          </section>
        </aside>

        <section className="min-h-[70vh] lg:min-h-0 lg:overflow-hidden">
          {view === 'editor' ? (
            <NoteEditor onSave={handleNoteSaved} onCancel={() => setView('graph')} />
          ) : (
            <Graph3D
              data={data}
              source={source}
              query={deferredQuery}
              hoveredNode={hoveredNode}
              onHoverNode={setHoveredNode}
            />
          )}
        </section>

        <aside
          className={`relative min-h-[70vh] lg:min-h-0 lg:overflow-hidden ${isChatOpen ? 'flex' : 'hidden lg:flex'}`}
          aria-hidden={!isChatOpen}
        >
          <button
            type="button"
            aria-label={getChatToggleLabel(true)}
            onClick={() => setIsChatOpen(false)}
            className={`absolute left-0 top-1/2 z-10 -translate-x-[calc(100%-0.5rem)] -translate-y-1/2 rounded-l-2xl rounded-r-none border border-cyan-300/20 border-r-0 bg-slate-900/95 px-3 py-5 text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200 shadow-2xl shadow-cyan-950/30 transition hover:border-cyan-300/40 hover:bg-slate-900 [writing-mode:vertical-rl] ${
              isChatOpen ? '' : 'pointer-events-none opacity-0'
            }`}
          >
            Chat
          </button>
          <div
            hidden={!isChatOpen}
            className={`flex w-full transition ${
              isChatOpen ? 'visible translate-x-0 opacity-100' : 'invisible translate-x-8 opacity-0'
            }`}
          >
            <ChatPanel />
          </div>
        </aside>

        {!isChatOpen ? (
          <button
            type="button"
            aria-label={getChatToggleLabel(false)}
            onClick={() => setIsChatOpen(true)}
            className="fixed right-0 top-1/2 z-10 -translate-y-1/2 rounded-l-2xl rounded-r-none border border-cyan-300/20 border-r-0 bg-slate-900/95 px-3 py-5 text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200 shadow-2xl shadow-cyan-950/30 transition hover:border-cyan-300/40 hover:bg-slate-900 [writing-mode:vertical-rl]"
          >
            Chat
          </button>
        ) : null}
      </div>
    </main>
  );
}
