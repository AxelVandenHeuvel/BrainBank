import { useRef, useImperativeHandle, forwardRef } from 'react';

export interface SearchBarHandle {
  focus: () => void;
}

interface SearchBarProps {
  query: string;
  matchCount: number;
  onQueryChange: (value: string) => void;
}

export const SearchBar = forwardRef<SearchBarHandle, SearchBarProps>(
  function SearchBar({ query, matchCount, onQueryChange }, ref) {
    const inputRef = useRef<HTMLInputElement>(null);
    const matchLabel = matchCount === 1 ? '1 match' : `${matchCount} matches`;

    useImperativeHandle(ref, () => ({
      focus: () => inputRef.current?.focus(),
    }));

    return (
      <div
        data-testid="search-bar"
        className="flex flex-row items-center gap-3"
      >
        <label
          htmlFor="graph-search"
          className="shrink-0 text-[10px] font-medium uppercase tracking-widest text-neutral-500"
        >
          Search
        </label>
        <input
          ref={inputRef}
          id="graph-search"
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Find a concept, document, or task"
          className="min-w-0 flex-1 border border-white/[0.06] bg-neutral-950 px-3 py-1.5 text-sm text-neutral-100 outline-none transition placeholder:text-neutral-600 focus:border-pink-500/40"
        />
        <p className="shrink-0 text-xs text-neutral-500">{matchLabel}</p>
      </div>
    );
  },
);
