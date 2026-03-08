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
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export function DocumentEditor({
  docId,
  initialTitle,
  initialContent,
  isNew,
  onTitleChange,
  onSaved,
}: DocumentEditorProps) {
  const [title, setTitle] = useState(initialTitle);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const editorRoot = useRef<HTMLDivElement>(null);
  const crepeRef = useRef<Crepe | null>(null);
  const contentRef = useRef(initialContent);
  const titleRef = useRef(initialTitle);
  const isMounted = useRef(true);
  const isSaving = useRef(false);

  const save = useCallback(async () => {
    const text = contentRef.current.trim();
    const rawTitle = titleRef.current.trim();
    if (!text && !rawTitle) return;

    const currentTitle = rawTitle || 'Untitled';

    // Prevent overlapping saves — especially important for new notes where
    // the first POST creates the doc and subsequent saves should wait until
    // the component remounts with the real id.
    if (isSaving.current) return;
    isSaving.current = true;

    setStatus('saving');

    try {
      const url = isNew ? '/api/documents' : `/api/documents/${docId}`;
      const method = isNew ? 'POST' : 'PUT';
      const body = JSON.stringify({ title: currentTitle, text });

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body,
      });

      if (!response.ok) throw new Error(`Save failed (${response.status})`);

      const data = await response.json();

      if (isMounted.current) {
        setStatus('saved');
        // For new notes, pass the real doc_id from the backend so the tab id can be updated
        const realDocId = isNew && data.doc_id ? data.doc_id : undefined;
        onSaved?.(docId, realDocId, contentRef.current);
      }
    } catch {
      if (isMounted.current) {
        setStatus('error');
      }
    } finally {
      isSaving.current = false;
    }
  }, [docId, isNew, onSaved]);

  // Milkdown Crepe setup
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
        [Crepe.Feature.Placeholder]: {
          text: 'Start writing...',
          mode: 'block',
        },
      },
    });

    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => {
        contentRef.current = markdown;
        setStatus((current) => (current === 'saving' ? current : 'idle'));
      });
    });

    crepe
      .create()
      .then(() => {
        if (destroyed) return;
        crepeRef.current = crepe;
      })
      .catch((err) => {
        console.error('Milkdown Crepe failed to initialize:', err);
      });

    return () => {
      destroyed = true;
      crepe.destroy().catch(() => {});
      crepeRef.current = null;
    };
  }, []);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  function handleTitleChange(newTitle: string) {
    setTitle(newTitle);
    titleRef.current = newTitle;
    onTitleChange?.(docId, newTitle);
    setStatus((current) => (current === 'saving' ? current : 'idle'));
  }

  const statusLabel: Record<SaveStatus, string> = {
    idle: '',
    saving: 'Saving...',
    saved: 'Saved',
    error: 'Error',
  };

  return (
    <div className="flex h-full flex-col">
      {/* Title + status */}
      <div className="flex items-center gap-3 px-6 pt-4">
        <input
          type="text"
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          placeholder="Untitled"
          className="min-w-0 flex-1 border-none bg-transparent text-2xl font-semibold text-white outline-none placeholder:text-neutral-700"
        />
        <button
          type="button"
          onClick={() => {
            void save();
          }}
          disabled={status === 'saving'}
          className="shrink-0 border border-white/[0.08] bg-neutral-950 px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-neutral-300 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          Save note
        </button>
        <span
          data-testid="save-status"
          className={`text-xs ${
            status === 'error' ? 'text-red-400' : 'text-neutral-600'
          }`}
        >
          {statusLabel[status]}
        </span>
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-auto px-6 py-4">
        <div ref={editorRoot} />
      </div>
    </div>
  );
}
