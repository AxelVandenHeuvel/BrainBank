import { useEffect, useRef, useState } from 'react';
import { Crepe } from '@milkdown/crepe';
import { editorViewCtx } from '@milkdown/kit/core';
import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/frame-dark.css';

interface NoteEditorProps {
  onSave: () => void;
  onCancel: () => void;
}

export function NoteEditor({ onSave, onCancel }: NoteEditorProps) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editorRoot = useRef<HTMLDivElement>(null);
  const crepeRef = useRef<Crepe | null>(null);

  useEffect(() => {
    if (!editorRoot.current || crepeRef.current) return;

    let destroyed = false;

    const crepe = new Crepe({
      root: editorRoot.current,
      defaultValue: '',
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
          mode: 'doc',
        },
        [Crepe.Feature.Latex]: {
          katexOptions: { throwOnError: false },
        },
      },
    });

    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => {
        setContent(markdown);
      });
    });

    crepe
      .create()
      .then(() => {
        if (destroyed) return;
        crepeRef.current = crepe;

        // Backspace on empty heading instantly converts to paragraph
        const el = editorRoot.current?.querySelector('.ProseMirror');
        if (el) {
          el.addEventListener('keydown', (e) => {
            if ((e as KeyboardEvent).key !== 'Backspace') return;
            crepe.editor.action((ctx) => {
              const view = ctx.get(editorViewCtx);
              const { state } = view;
              const { $from } = state.selection;
              const node = $from.parent;
              if (
                node.type.name === 'heading' &&
                node.textContent === '' &&
                $from.parentOffset === 0
              ) {
                const pos = $from.before();
                view.dispatch(
                  state.tr.setNodeMarkup(pos, state.schema.nodes.paragraph),
                );
                (e as Event).preventDefault();
              }
            });
          });
        }
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

  async function handleSave() {
    const trimmedTitle = title.trim() || 'Untitled';
    const markdown = crepeRef.current?.getMarkdown() ?? content;
    if (!markdown.trim()) return;

    setSaving(true);
    setError(null);

    try {
      const response = await fetch('/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmedTitle, text: markdown.trim() }),
      });

      if (!response.ok) {
        throw new Error(`Failed to save (${response.status})`);
      }

      onSave();
    } catch {
      setError('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950">
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-white/10 px-6 py-3">
        <button
          onClick={onCancel}
          className="text-sm text-slate-400 transition hover:text-slate-200"
        >
          Back to graph
        </button>

        <button
          onClick={handleSave}
          disabled={!content.trim() || saving}
          className="rounded-2xl bg-cyan-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-cyan-500 disabled:opacity-40 disabled:hover:bg-cyan-600"
        >
          {saving ? 'Saving...' : 'Save to Brain'}
        </button>
      </div>

      {/* Title */}
      <div className="px-6 pt-6">
        <input
          type="text"
          placeholder="Untitled"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full border-none bg-transparent text-3xl font-semibold text-white outline-none placeholder:text-slate-600"
        />
      </div>

      {/* Milkdown editor */}
      <div className="flex-1 overflow-auto px-6 py-4">
        <div ref={editorRoot} />
      </div>

      {error && (
        <p className="px-6 pb-4 text-xs text-red-400">{error}</p>
      )}
    </div>
  );
}
