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

  it('uploads a file and ingests its contents', async () => {
    const user = userEvent.setup();
    const mockResponse = { concepts: ['Physics'], doc_id: 'xyz' };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as Response);

    render(<IngestPanel onIngestComplete={onIngestComplete} onNewNote={onNewNote} />);

    const file = new File(['# Physics Notes\nForce equals mass times acceleration'], 'physics.md', {
      type: 'text/markdown',
    });

    const fileInput = screen.getByTestId('file-input');
    await user.upload(fileInput, file);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'physics',
          text: '# Physics Notes\nForce equals mass times acceleration',
        }),
      });
    });

    await waitFor(() => {
      expect(screen.getByText(/1 concept extracted/i)).toBeInTheDocument();
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
      expect(screen.getByText(/ingest failed/i)).toBeInTheDocument();
    });

    expect(onIngestComplete).not.toHaveBeenCalled();
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
