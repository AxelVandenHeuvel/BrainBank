import { useRef, useState } from 'react';

interface IngestPanelProps {
  onIngestComplete: () => void;
}

interface IngestResult {
  type: 'success' | 'error';
  message: string;
}

async function postIngest(title: string, text: string): Promise<{ concepts: string[] }> {
  const response = await fetch('/ingest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, text }),
  });

  if (!response.ok) {
    throw new Error(`Ingest failed (${response.status})`);
  }

  return response.json();
}

export function IngestPanel({ onIngestComplete }: IngestPanelProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<IngestResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleSubmit() {
    if (!title.trim() || !content.trim()) return;
    setSubmitting(true);
    setResult(null);

    try {
      const data = await postIngest(title.trim(), content.trim());
      const count = data.concepts?.length ?? 0;
      setResult({
        type: 'success',
        message: `${count} concept${count === 1 ? '' : 's'} extracted`,
      });
      setTitle('');
      setContent('');
      onIngestComplete();
    } catch {
      setResult({ type: 'error', message: 'Ingest failed' });
    } finally {
      setSubmitting(false);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      const text = reader.result as string;
      const fileName = file.name.replace(/\.[^.]+$/, '');

      setSubmitting(true);
      setResult(null);

      try {
        const data = await postIngest(fileName, text);
        const count = data.concepts?.length ?? 0;
        setResult({
          type: 'success',
          message: `${count} concept${count === 1 ? '' : 's'} extracted`,
        });
        onIngestComplete();
      } catch {
        setResult({ type: 'error', message: 'Ingest failed' });
      } finally {
        setSubmitting(false);
      }
    };
    reader.readAsText(file);

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  return (
    <section className="rounded-3xl border border-white/10 bg-slate-900/60">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between p-4 text-sm font-medium text-slate-200"
      >
        Add Knowledge
        <span className="text-xs text-slate-500">{open ? '−' : '+'}</span>
      </button>

      {open && (
        <div className="flex flex-col gap-3 border-t border-white/5 p-4">
          <input
            type="text"
            placeholder="Note title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="rounded-2xl border border-cyan-300/20 bg-slate-950/70 px-4 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-300/60"
          />
          <textarea
            placeholder="Write your note (markdown supported)"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={4}
            className="rounded-2xl border border-cyan-300/20 bg-slate-950/70 px-4 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-300/60"
          />
          <button
            onClick={handleSubmit}
            disabled={!title.trim() || !content.trim() || submitting}
            className="rounded-2xl bg-cyan-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-cyan-500 disabled:opacity-40 disabled:hover:bg-cyan-600"
          >
            {submitting ? 'Ingesting...' : 'Add to Brain'}
          </button>

          <div className="flex items-center gap-2">
            <label className="cursor-pointer rounded-2xl border border-dashed border-slate-600 px-4 py-2 text-center text-xs text-slate-400 transition hover:border-cyan-300/40 hover:text-slate-300">
              Upload .md / .txt
              <input
                ref={fileInputRef}
                data-testid="file-input"
                type="file"
                accept=".md,.txt"
                onChange={handleFileChange}
                className="hidden"
              />
            </label>
          </div>

          {result && (
            <p
              className={`text-xs ${
                result.type === 'success' ? 'text-emerald-400' : 'text-red-400'
              }`}
            >
              {result.message}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
