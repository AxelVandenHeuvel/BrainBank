import { useState } from 'react';

interface NoteEditorProps {
  onSave: () => void;
  onCancel: () => void;
}

export function NoteEditor({ onSave, onCancel }: NoteEditorProps) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    const trimmedTitle = title.trim() || 'Untitled';
    if (!content.trim()) return;

    setSaving(true);
    setError(null);

    try {
      const response = await fetch('/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmedTitle, text: content.trim() }),
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
    <div className="flex h-full min-h-[70vh] flex-col rounded-[2rem] border border-white/10 bg-slate-950/75 p-6 shadow-2xl shadow-cyan-950/20 backdrop-blur lg:min-h-0">
      <div className="mb-6 flex shrink-0 items-center justify-between">
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

      <input
        type="text"
        placeholder="Untitled"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="mb-4 shrink-0 border-none bg-transparent text-3xl font-semibold text-white outline-none placeholder:text-slate-600"
      />

      <textarea
        placeholder="Start writing..."
        value={content}
        onChange={(e) => setContent(e.target.value)}
        className="flex-1 resize-none border-none bg-transparent text-base leading-7 text-slate-200 outline-none placeholder:text-slate-600 lg:min-h-0"
      />

      {error && (
        <p className="mt-4 shrink-0 text-xs text-red-400">{error}</p>
      )}
    </div>
  );
}
