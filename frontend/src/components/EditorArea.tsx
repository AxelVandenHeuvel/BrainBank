import type { OpenTab } from '../types/notes';
import { TabBar } from './TabBar';
import { DocumentEditor } from './DocumentEditor';

export interface EditorAreaProps {
  tabs: OpenTab[];
  activeTabId: string | null;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onTabTitleChange: (tabId: string, newTitle: string) => void;
  onSaved: (docId: string, newDocId?: string, currentContent?: string) => void;
}

export function EditorArea({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onTabTitleChange,
  onSaved,
}: EditorAreaProps) {
  const activeTab = tabs.find((t) => t.id === activeTabId);
  if (!activeTab) return null;

  return (
    <div className="flex h-full flex-col">
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectTab={onSelectTab}
        onCloseTab={onCloseTab}
      />
      <div className="min-h-0 flex-1">
        <DocumentEditor
          key={activeTabId}
          docId={activeTab.id}
          initialTitle={activeTab.title}
          initialContent={activeTab.content}
          isNew={activeTab.isNew}
          onTitleChange={onTabTitleChange}
          onSaved={onSaved}
        />
      </div>
    </div>
  );
}
