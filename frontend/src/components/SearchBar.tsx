interface SearchBarProps {
  query: string;
  matchCount: number;
  onQueryChange: (value: string) => void;
}

export function SearchBar({
  query,
  matchCount,
  onQueryChange,
}: SearchBarProps) {
  const matchLabel = matchCount === 1 ? '1 match' : `${matchCount} matches`;

  return (
    <div className="flex flex-col gap-3 rounded-3xl border border-white/10 bg-slate-950/80 p-4 shadow-2xl shadow-cyan-950/30 backdrop-blur">
      <label
        htmlFor="graph-search"
        className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-200/80"
      >
        Search graph
      </label>
      <input
        id="graph-search"
        type="search"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder="Find a concept, document, or task"
        className="rounded-2xl border border-cyan-300/20 bg-slate-900/90 px-4 py-3 text-sm text-slate-100 outline-none ring-0 transition focus:border-cyan-300/60"
      />
      <p className="text-sm text-slate-400">{matchLabel}</p>
    </div>
  );
}

