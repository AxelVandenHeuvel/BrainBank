import type { OpenTab } from '../types/notes';

export interface TabBarProps {
  tabs: OpenTab[];
  activeTabId: string | null;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
}

export function TabBar({ tabs, activeTabId, onSelectTab, onCloseTab }: TabBarProps) {
  if (tabs.length === 0) return null;

  return (
    <div className="flex items-end gap-0 overflow-x-auto border-b border-white/[0.06] bg-black">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <button
            key={tab.id}
            data-testid={`tab-${tab.id}`}
            type="button"
            onClick={() => onSelectTab(tab.id)}
            className={`group flex flex-1 basis-0 min-w-0 max-w-[14rem] items-center gap-2 px-4 py-2 text-sm transition ${
              isActive
                ? 'border-b-2 border-pink-500 bg-neutral-950 text-white'
                : 'border-b-2 border-transparent text-neutral-500 hover:bg-neutral-950 hover:text-neutral-300'
            }`}
          >
            <span className={`truncate ${tab.isNew ? 'italic' : ''}`}>{tab.title}</span>
            <span
              role="button"
              aria-label="Close tab"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(tab.id);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation();
                  onCloseTab(tab.id);
                }
              }}
              className="ml-auto shrink-0 rounded p-0.5 text-neutral-600 opacity-0 transition hover:text-pink-400 group-hover:opacity-100"
            >
              ×
            </span>
          </button>
        );
      })}
    </div>
  );
}
