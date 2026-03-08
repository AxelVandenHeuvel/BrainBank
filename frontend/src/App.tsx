import { Component, lazy, startTransition, Suspense, useDeferredValue, useState } from 'react';
import type { ReactNode } from 'react';

import { ChatPanel } from './components/ChatPanel';
import { Graph3D } from './components/Graph3D';
import { IngestPanel } from './components/IngestPanel';
import { SearchBar } from './components/SearchBar';

const NoteEditor = lazy(() =>
  import('./components/NoteEditor').then((m) => ({ default: m.NoteEditor })),
);

class EditorErrorBoundary extends Component<{ children: ReactNode; onError: () => void }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(err: Error) { return { error: err.message }; }
  componentDidCatch() { this.props.onError(); }
  render() {
    if (this.state.error) return <div className="p-8 text-red-400">Editor failed to load: {this.state.error}</div>;
    return this.props.children;
  }
}
import { useGraphData } from './hooks/useGraphData';
import { findMatchingNodeIds } from './lib/graphView';

function formatSourceLabel(source: 'api' | 'mock'): string {
  return source === 'api' ? 'Live API' : 'Mock data';
}

function getChatToggleLabel(isChatOpen: boolean): string {
  return isChatOpen ? 'Close chat panel' : 'Open chat panel';
}

export default function App() {
  const { data, source, error, refetch } = useGraphData();
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
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
        data-testid="app-shell"
        className="relative mx-auto grid min-h-screen w-full max-w-[1800px] gap-6 px-4 py-4 lg:h-screen lg:grid-cols-[22rem_minmax(0,1fr)] lg:overflow-hidden lg:px-6"
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

        </aside>

        <section className="min-h-[70vh] lg:min-h-0 lg:overflow-hidden">
          {view === 'editor' ? (
            <EditorErrorBoundary onError={() => setView('graph')}>
              <Suspense fallback={<div className="flex h-full items-center justify-center text-slate-400">Loading editor...</div>}>
                <NoteEditor
                  onSave={handleNoteSaved}
                  onCancel={() => setView('graph')}
                />
              </Suspense>
            </EditorErrorBoundary>
          ) : (
            <Graph3D
              data={data}
              source={source}
              query={deferredQuery}
            />
          )}
        </section>

        <aside
          data-testid="chat-overlay"
          className={`relative min-h-[70vh] lg:absolute lg:inset-y-4 lg:right-0 lg:z-20 lg:w-[24rem] lg:min-h-0 ${
            isChatOpen ? 'flex lg:pointer-events-auto' : 'hidden lg:flex lg:pointer-events-none'
          }`}
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
            className={`flex w-full transition lg:h-full ${
              isChatOpen
                ? 'visible translate-x-0 opacity-100'
                : 'invisible translate-x-8 opacity-0'
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
