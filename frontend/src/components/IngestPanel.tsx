import { useRef, useState } from 'react';

interface IngestPanelProps {
  onIngestComplete: () => void;
  onNewNote: () => void;
}

interface IngestResult {
  type: 'success' | 'error';
  message: string;
}

export function IngestPanel({ onIngestComplete, onNewNote }: IngestPanelProps) {
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<IngestResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showNotion, setShowNotion] = useState(false);
  const [notionToken, setNotionToken] = useState('');
  const [notionUrl, setNotionUrl] = useState('');

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
        const response = await fetch('/ingest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: fileName, text }),
        });

        if (!response.ok) throw new Error('Ingest failed');

        const data = await response.json();
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

  async function handleNotionImport() {
    if (!notionToken.trim() || !notionUrl.trim()) return;

    setSubmitting(true);
    setResult(null);

    try {
      const response = await fetch('/ingest/notion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: notionToken.trim(), url: notionUrl.trim() }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Import failed');
      }

      const count = data.imported ?? 0;
      setResult({
        type: 'success',
        message: `${count} page${count === 1 ? '' : 's'} imported from Notion`,
      });
      setShowNotion(false);
      setNotionToken('');
      setNotionUrl('');
      onIngestComplete();
    } catch (err) {
      setResult({ type: 'error', message: (err as Error).message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="rounded-3xl border border-white/10 bg-slate-900/60 p-4">
      <div className="flex flex-col gap-3">
        <button
          onClick={onNewNote}
          className="w-full rounded-2xl bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-cyan-500"
        >
          New Note
        </button>

        <label className="flex cursor-pointer items-center justify-center rounded-2xl border border-dashed border-slate-600 px-4 py-2.5 text-center text-xs text-slate-400 transition hover:border-cyan-300/40 hover:text-slate-300">
          {submitting ? 'Uploading...' : 'Upload .md / .txt'}
          <input
            ref={fileInputRef}
            data-testid="file-input"
            type="file"
            accept=".md,.txt"
            onChange={handleFileChange}
            className="hidden"
          />
        </label>

        {!showNotion ? (
          <button
            onClick={() => setShowNotion(true)}
            className="w-full rounded-2xl border border-dashed border-slate-600 px-4 py-2.5 text-xs text-slate-400 transition hover:border-cyan-300/40 hover:text-slate-300"
          >
            Import from Notion
          </button>
        ) : (
          <div className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-slate-950/50 p-3">
            <input
              type="password"
              placeholder="Notion integration token"
              value={notionToken}
              onChange={(e) => setNotionToken(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-xs text-slate-200 outline-none placeholder:text-slate-500 focus:border-cyan-600"
            />
            <input
              type="text"
              placeholder="Page or database URL"
              value={notionUrl}
              onChange={(e) => setNotionUrl(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-xs text-slate-200 outline-none placeholder:text-slate-500 focus:border-cyan-600"
            />
            <div className="flex gap-2">
              <button
                onClick={handleNotionImport}
                disabled={submitting || !notionToken.trim() || !notionUrl.trim()}
                className="flex-1 rounded-xl bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-cyan-500 disabled:opacity-40"
              >
                {submitting ? 'Importing...' : 'Import'}
              </button>
              <button
                onClick={() => { setShowNotion(false); setNotionToken(''); setNotionUrl(''); }}
                className="rounded-xl px-3 py-1.5 text-xs text-slate-400 transition hover:text-slate-200"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {result && (
        <p
          className={`mt-3 text-xs ${
            result.type === 'success' ? 'text-emerald-400' : 'text-red-400'
          }`}
        >
          {result.message}
        </p>
      )}
    </section>
  );
}
