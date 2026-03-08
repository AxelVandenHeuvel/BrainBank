import { useEffect, useRef, useState } from 'react';
import { Crepe } from '@milkdown/crepe';
import { editorViewCtx } from '@milkdown/kit/core';
import { $prose } from '@milkdown/kit/utils';
import { Plugin } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/frame-dark.css';

const markdownHintsPlugin = $prose(() => {
  return new Plugin({
    props: {
      decorations(state) {
        const { $from } = state.selection;
        const parent = $from.parent;
        if (parent.type.name !== 'heading') return DecorationSet.empty;

        const level = parent.attrs.level as number;
        const hashes = '#'.repeat(level) + ' ';
        const pos = $from.before() + 1;

        const decorations: Decoration[] = [];

        decorations.push(
          Decoration.widget(
            pos,
            () => {
              const span = document.createElement('span');
              span.textContent = hashes;
              span.className = 'md-syntax-hint';
              return span;
            },
            { side: -1 },
          ),
        );

        // Hide the placeholder on this heading node
        decorations.push(
          Decoration.node($from.before(), $from.after(), {
            class: 'md-no-placeholder',
          }),
        );

        return DecorationSet.create(state.doc, decorations);
      },
    },
  });
});

interface NoteEditorProps {
  onSave: () => void;
  onCancel: () => void;
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export function NoteEditor({ onSave, onCancel }: NoteEditorProps) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const editorRoot = useRef<HTMLDivElement>(null);
  const crepeRef = useRef<Crepe | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<string>('');
  const lastSavedTitleRef = useRef<string>('');
  const savingRef = useRef(false);

  async function triggerSave(text: string, noteTitle: string) {
    if (savingRef.current) return;
    const trimmed = text.trim();
    if (!trimmed) return;

    savingRef.current = true;
    setSaveStatus('saving');

    try {
      const response = await fetch('/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: noteTitle.trim() || 'Untitled', text: trimmed }),
      });

      if (!response.ok) throw new Error('Save failed');

      lastSavedRef.current = text;
      lastSavedTitleRef.current = noteTitle;
      setSaveStatus('saved');
      onSave();
    } catch {
      setSaveStatus('error');
    } finally {
      savingRef.current = false;
    }
  }

  // Debounced auto-save: 2s after content or title changes
  useEffect(() => {
    if (!content.trim()) return;
    if (content === lastSavedRef.current && title === lastSavedTitleRef.current) return;

    setSaveStatus('idle');

    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      triggerSave(content, title);
    }, 2000);

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [content, title]);

  function handleBack() {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    // Save immediately if there are unsaved changes
    if (content.trim() && (content !== lastSavedRef.current || title !== lastSavedTitleRef.current)) {
      triggerSave(content, title);
    }
    onCancel();
  }

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
          mode: 'block',
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

    crepe.editor.use(markdownHintsPlugin);

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

  const statusText =
    saveStatus === 'saving' ? 'Saving...' :
    saveStatus === 'saved' ? 'Saved' :
    saveStatus === 'error' ? 'Save failed' :
    null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950">
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-white/10 px-6 py-3">
        <button
          onClick={handleBack}
          className="text-sm text-slate-400 transition hover:text-slate-200"
        >
          Back to graph
        </button>

        {statusText && (
          <span
            data-testid="save-status"
            className={`text-xs ${
              saveStatus === 'error' ? 'text-red-400' :
              saveStatus === 'saved' ? 'text-emerald-400' :
              'text-slate-400'
            }`}
          >
            {statusText}
          </span>
        )}
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
    </div>
  );
}
