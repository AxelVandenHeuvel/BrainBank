import { useEffect, useRef, useState, useCallback } from 'react';
import { Crepe } from '@milkdown/crepe';
import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/frame-dark.css';

export interface DocumentEditorProps {
  docId: string;
  initialTitle: string;
  initialContent: string;
  isNew: boolean;
  onTitleChange?: (docId: string, newTitle: string) => void;
  onSaved?: (docId: string, newDocId?: string, currentContent?: string) => void;
  onDeleted?: (docId: string) => void; // NEW: Callback for when a note is trashed
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'deleting' | 'conflict';

export function DocumentEditor({
  docId,
  initialTitle,
  initialContent,
  isNew,
  onTitleChange,
  onSaved,
  onDeleted,
}: DocumentEditorProps) {
  const [title, setTitle] = useState(initialTitle);
  const [status, setStatus] = useState<SaveStatus>('idle');
  
  const editorRoot = useRef<HTMLDivElement>(null);
  const crepeRef = useRef<Crepe | null>(null);
  
  const contentRef = useRef(initialContent);
  const titleRef = useRef(initialTitle);
  const isMounted = useRef(true);
  
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const performSave = useCallback(async (currentTitle: string, currentContent: string) => {
    if (!isMounted.current || status === 'deleting') return;
    setStatus('saving');

    try {
      const endpoint = isNew ? '/api/documents' : `/api/documents/${encodeURIComponent(docId)}`;
      const method = isNew ? 'POST' : 'PUT';

      const response = await fetch(endpoint, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          title: currentTitle, 
          text: currentContent 
        }),
      });

      if (response.status === 409) {
        if (isMounted.current) setStatus('conflict');
        return;
      }

      if (!response.ok) throw new Error('Failed to save document via API');

      const data = await response.json();

      if (isMounted.current) {
        setStatus('saved');
        onSaved?.(docId, data.doc_id, currentContent);
      }
    } catch (error) {
      console.error("Error saving document:", error);
      if (isMounted.current) setStatus('error');
    }
  }, [docId, isNew, onSaved, status]);

  const triggerAutoSave = useCallback((newTitle: string, newContent: string) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    if (status === 'deleting') return;

    setStatus('idle');
    saveTimeoutRef.current = setTimeout(() => {
      void performSave(newTitle, newContent);
    }, 1500); 
  }, [performSave, status]);

  const handleDelete = async () => {
    if (!window.confirm("Are you sure you want to delete this note? This cannot be undone.")) return;
    
    // Stop any pending auto-saves
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    setStatus('deleting');

    try {
      const response = await fetch(`/api/documents/${encodeURIComponent(docId)}`, {
        method: 'DELETE',
      });

      if (!response.ok) throw new Error('Failed to delete document');

      onDeleted?.(docId);
    } catch (error) {
      console.error("Error deleting document:", error);
      if (isMounted.current) setStatus('error');
    }
  };

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  const autoSaveRef = useRef(triggerAutoSave);

  useEffect(() => {
    autoSaveRef.current = triggerAutoSave;
  }, [triggerAutoSave]);

  useEffect(() => {
    if (!editorRoot.current || crepeRef.current) return;
    let destroyed = false;

    const crepe = new Crepe({
      root: editorRoot.current,
      defaultValue: initialContent,
      features: {
        [Crepe.Feature.Toolbar]: false,
        [Crepe.Feature.Latex]: true,
        [Crepe.Feature.BlockEdit]: false,
        [Crepe.Feature.ImageBlock]: false,
        [Crepe.Feature.Cursor]: false,
      },
      featureConfigs: {
        [Crepe.Feature.Placeholder]: { text: 'Start writing...', mode: 'block' },
      },
    });

    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => {
        contentRef.current = markdown;
        // Call the ref! This prevents the useEffect from needing dependencies
        autoSaveRef.current(titleRef.current, markdown);
      });
    });

    crepe.create().then(() => {
        if (destroyed) return;
        crepeRef.current = crepe;
      }).catch((err) => console.error('Milkdown Crepe failed to initialize:', err));

    return () => {
      destroyed = true;
      crepe.destroy().catch(() => {});
      crepeRef.current = null;
    };
  }, []);

  function handleTitleChange(newTitle: string) {
    setTitle(newTitle);
    titleRef.current = newTitle;
    onTitleChange?.(docId, newTitle);
    triggerAutoSave(newTitle, contentRef.current);
  }

  const statusLabel: Record<SaveStatus, string> = {
    idle: '',
    saving: 'Saving...',
    saved: 'Saved to disk',
    deleting: 'Deleting...',
    conflict: 'Name already exists. Please rename.',
    error: 'Error',
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-6 pt-4">
        <input
          type="text"
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          placeholder="Untitled"
          disabled={status === 'deleting'}
          className="min-w-0 flex-1 border-none bg-transparent text-2xl font-semibold text-white outline-none placeholder:text-neutral-700 disabled:opacity-50"
        />

        {/* Delete Button */}
        <button
          type="button"
          onClick={handleDelete}
          disabled={status === 'deleting'}
          className="shrink-0 border border-red-500/20 bg-red-500/10 px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-red-400 transition hover:bg-red-500/20 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Delete
        </button>

        <span
          data-testid="save-status"
          className={`text-xs ${
            status === 'error' || status === 'conflict' ? 'text-red-400' : 'text-neutral-600'
          }`}
        >
          {statusLabel[status]}
        </span>
      </div>

      <div
        data-testid="document-editor-scroll-region"
        className="flex-1 overflow-auto overscroll-contain px-6 py-4"
        onWheel={(event) => event.stopPropagation()}
      >
        <div ref={editorRoot} className={status === 'deleting' ? 'opacity-50 pointer-events-none' : ''} />
      </div>
    </div>
  );
}