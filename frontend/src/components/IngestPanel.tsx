import { useRef, useState } from 'react';

interface IngestPanelProps {
  onIngestComplete: () => void;
  onNewNote: () => void;
}

interface IngestResult {
  type: 'success' | 'error';
  message: string;
}

interface UploadProgress {
  current: number;
  total: number;
}

export function IngestPanel({ onIngestComplete, onNewNote }: IngestPanelProps) {
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [result, setResult] = useState<IngestResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showNotion, setShowNotion] = useState(false);
  const [notionToken, setNotionToken] = useState('');
  const [notionUrl, setNotionUrl] = useState('');

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const fileList = Array.from(files);
    const total = fileList.length;
    let succeeded = 0;
    let failed = 0;

    setResult(null);

    for (let i = 0; i < fileList.length; i++) {
      setUploadProgress({ current: i + 1, total });

      try {
        const formData = new FormData();
        formData.append('files', fileList[i]);

        const response = await fetch('/ingest/upload', {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) throw new Error('Ingest failed');

        const data = await response.json();
        succeeded += data.imported ?? 1;
      } catch {
        failed++;
      }
    }

    setUploadProgress(null);

    if (failed === 0) {
      setResult({
        type: 'success',
        message: `${succeeded} file${succeeded === 1 ? '' : 's'} ingested`,
      });
    } else if (succeeded === 0) {
      setResult({
        type: 'error',
        message: `0 of ${total} files ingested (${failed} failed)`,
      });
    } else {
      setResult({
        type: 'error',
        message: `${succeeded} of ${total} files ingested (${failed} failed)`,
      });
    }

    if (succeeded > 0) {
      onIngestComplete();
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  async function handleNotionImport() {
    if (!notionToken.trim() || !notionUrl.trim()) return;

    setUploadProgress(null);
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
    }
  }

  const labelText = uploadProgress
    ? `Uploading ${uploadProgress.current} of ${uploadProgress.total}...`
    : 'Upload .md / .txt / .pdf / .zip';

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
          {labelText}
          <input
            ref={fileInputRef}
            data-testid="file-input"
            type="file"
            accept=".md,.txt,.pdf,.zip"
            multiple
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
                disabled={!notionToken.trim() || !notionUrl.trim()}
                className="flex-1 rounded-xl bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-cyan-500 disabled:opacity-40"
              >
                {uploadProgress ? 'Importing...' : 'Import'}
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
