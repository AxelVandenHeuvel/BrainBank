import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IngestPanel } from './IngestPanel';

const onIngestComplete = vi.fn();
const onNewNote = vi.fn();

beforeEach(() => {
  vi.restoreAllMocks();
  onIngestComplete.mockClear();
  onNewNote.mockClear();
});

describe('IngestPanel', () => {
  it('renders the New Note button and file upload', () => {
    render(<IngestPanel onIngestComplete={onIngestComplete} onNewNote={onNewNote} />);
    expect(screen.getByRole('button', { name: /new note/i })).toBeInTheDocument();
    expect(screen.getByText(/upload/i)).toBeInTheDocument();
  });

  it('calls onNewNote when New Note is clicked', async () => {
    const user = userEvent.setup();
    render(<IngestPanel onIngestComplete={onIngestComplete} onNewNote={onNewNote} />);

    await user.click(screen.getByRole('button', { name: /new note/i }));
    expect(onNewNote).toHaveBeenCalled();
  });

  it('uploads files via FormData to /ingest/upload', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ imported: 1, results: [{ title: 'physics', doc_id: 'xyz' }] }),
    } as Response);

    render(<IngestPanel onIngestComplete={onIngestComplete} onNewNote={onNewNote} />);

    const file = new File(['# Physics Notes'], 'physics.md', { type: 'text/markdown' });
    const fileInput = screen.getByTestId('file-input');
    await user.upload(fileInput, file);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalled();
      const [url, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe('/ingest/upload');
      expect(opts.method).toBe('POST');
      expect(opts.body).toBeInstanceOf(FormData);
    });

    await waitFor(() => {
      expect(screen.getByText(/1 file ingested/i)).toBeInTheDocument();
    });

    expect(onIngestComplete).toHaveBeenCalled();
  });

  it('shows error when file upload fails', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 500,
    } as Response);

    render(<IngestPanel onIngestComplete={onIngestComplete} onNewNote={onNewNote} />);

    const file = new File(['some text'], 'notes.txt', { type: 'text/plain' });
    const fileInput = screen.getByTestId('file-input');
    await user.upload(fileInput, file);

    await waitFor(() => {
      expect(screen.getByText(/0 of 1 files ingested/i)).toBeInTheDocument();
    });

    expect(onIngestComplete).not.toHaveBeenCalled();
  });

  it('shows per-file progress when uploading multiple files', async () => {
    const user = userEvent.setup();

    let resolveFirst!: (value: Response) => void;
    let resolveSecond!: (value: Response) => void;
    const firstFetch = new Promise<Response>((r) => { resolveFirst = r; });
    const secondFetch = new Promise<Response>((r) => { resolveSecond = r; });

    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockReturnValueOnce(firstFetch)
      .mockReturnValueOnce(secondFetch);

    render(<IngestPanel onIngestComplete={onIngestComplete} onNewNote={onNewNote} />);

    const file1 = new File(['content 1'], 'file1.md', { type: 'text/markdown' });
    const file2 = new File(['content 2'], 'file2.md', { type: 'text/markdown' });

    const fileInput = screen.getByTestId('file-input');
    await user.upload(fileInput, [file1, file2]);

    await waitFor(() => {
      expect(screen.getByText('Uploading 1 of 2...')).toBeInTheDocument();
    });

    resolveFirst({
      ok: true,
      json: () => Promise.resolve({ imported: 1, results: [{ title: 'file1', doc_id: '1' }] }),
    } as Response);

    await waitFor(() => {
      expect(screen.getByText('Uploading 2 of 2...')).toBeInTheDocument();
    });

    resolveSecond({
      ok: true,
      json: () => Promise.resolve({ imported: 1, results: [{ title: 'file2', doc_id: '2' }] }),
    } as Response);

    await waitFor(() => {
      expect(screen.getByText('2 files ingested')).toBeInTheDocument();
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(onIngestComplete).toHaveBeenCalled();
  });

  it('shows partial failure summary when some files fail', async () => {
    const user = userEvent.setup();

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ imported: 1, results: [{ title: 'file1', doc_id: '1' }] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as Response);

    render(<IngestPanel onIngestComplete={onIngestComplete} onNewNote={onNewNote} />);

    const file1 = new File(['content 1'], 'file1.md', { type: 'text/markdown' });
    const file2 = new File(['content 2'], 'file2.md', { type: 'text/markdown' });

    const fileInput = screen.getByTestId('file-input');
    await user.upload(fileInput, [file1, file2]);

    await waitFor(() => {
      expect(screen.getByText('1 of 2 files ingested (1 failed)')).toBeInTheDocument();
    });

    expect(onIngestComplete).toHaveBeenCalled();
  });

  it('shows duplicate notification when file already exists', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          imported: 0,
          results: [{ title: 'notes', skipped: true, reason: 'duplicate' }],
        }),
    } as Response);

    render(<IngestPanel onIngestComplete={onIngestComplete} onNewNote={onNewNote} />);

    const file = new File(['# Notes'], 'notes.md', { type: 'text/markdown' });
    const fileInput = screen.getByTestId('file-input');
    await user.upload(fileInput, file);

    await waitFor(() => {
      expect(screen.getByText(/already exists/i)).toBeInTheDocument();
    });
  });

  it('shows duplicate names when some files are duplicates in a batch', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            imported: 1,
            results: [{ title: 'file1', doc_id: '1' }],
          }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            imported: 0,
            results: [{ title: 'file2', skipped: true, reason: 'duplicate' }],
          }),
      } as Response);

    render(<IngestPanel onIngestComplete={onIngestComplete} onNewNote={onNewNote} />);

    const file1 = new File(['content 1'], 'file1.md', { type: 'text/markdown' });
    const file2 = new File(['content 2'], 'file2.md', { type: 'text/markdown' });
    const fileInput = screen.getByTestId('file-input');
    await user.upload(fileInput, [file1, file2]);

    await waitFor(() => {
      expect(screen.getByText(/1 file ingested/i)).toBeInTheDocument();
      expect(screen.getByText(/file2 already exists/i)).toBeInTheDocument();
    });
  });

  it('renders Import from Notion button', () => {
    render(<IngestPanel onIngestComplete={onIngestComplete} onNewNote={onNewNote} />);
    expect(screen.getByRole('button', { name: /import from notion/i })).toBeInTheDocument();
  });

  it('shows Notion form on click and submits', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ imported: 3, pages: [] }),
    } as Response);

    render(<IngestPanel onIngestComplete={onIngestComplete} onNewNote={onNewNote} />);

    await user.click(screen.getByRole('button', { name: /import from notion/i }));
    expect(screen.getByPlaceholderText(/token/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/url/i)).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText(/token/i), 'ntn_test');
    await user.type(screen.getByPlaceholderText(/url/i), 'https://notion.so/abc123def456abc123def456abc123de');
    await user.click(screen.getByRole('button', { name: /^import$/i }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/ingest/notion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: 'ntn_test',
          url: 'https://notion.so/abc123def456abc123def456abc123de',
        }),
      });
    });

    await waitFor(() => {
      expect(screen.getByText(/3 pages imported/i)).toBeInTheDocument();
    });

    expect(onIngestComplete).toHaveBeenCalled();
  });

  it('shows error on Notion import failure', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: 'Invalid token' }),
    } as Response);

    render(<IngestPanel onIngestComplete={onIngestComplete} onNewNote={onNewNote} />);

    await user.click(screen.getByRole('button', { name: /import from notion/i }));
    await user.type(screen.getByPlaceholderText(/token/i), 'bad');
    await user.type(screen.getByPlaceholderText(/url/i), 'https://notion.so/abc123def456abc123def456abc123de');
    await user.click(screen.getByRole('button', { name: /^import$/i }));

    await waitFor(() => {
      expect(screen.getByText(/invalid token/i)).toBeInTheDocument();
    });
  });
});
