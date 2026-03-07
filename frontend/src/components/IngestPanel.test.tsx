import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IngestPanel } from './IngestPanel';

const onIngestComplete = vi.fn();

beforeEach(() => {
  vi.restoreAllMocks();
  onIngestComplete.mockClear();
});

describe('IngestPanel', () => {
  it('renders the panel header and toggle', () => {
    render(<IngestPanel onIngestComplete={onIngestComplete} />);
    expect(screen.getByText('Add Knowledge')).toBeInTheDocument();
  });

  it('shows the form when expanded', async () => {
    const user = userEvent.setup();
    render(<IngestPanel onIngestComplete={onIngestComplete} />);

    await user.click(screen.getByRole('button', { name: /add knowledge/i }));

    expect(screen.getByPlaceholderText('Note title')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/write your note/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add to brain/i })).toBeInTheDocument();
  });

  it('submits a quick note and shows success', async () => {
    const user = userEvent.setup();
    const mockResponse = { concepts: ['Calculus', 'Derivatives'], doc_id: 'abc' };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as Response);

    render(<IngestPanel onIngestComplete={onIngestComplete} />);
    await user.click(screen.getByRole('button', { name: /add knowledge/i }));

    await user.type(screen.getByPlaceholderText('Note title'), 'My Note');
    await user.type(screen.getByPlaceholderText(/write your note/i), 'Some content about math');
    await user.click(screen.getByRole('button', { name: /add to brain/i }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'My Note', text: 'Some content about math' }),
      });
    });

    await waitFor(() => {
      expect(screen.getByText(/2 concepts extracted/i)).toBeInTheDocument();
    });

    expect(onIngestComplete).toHaveBeenCalled();
  });

  it('shows error when ingest fails', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 500,
    } as Response);

    render(<IngestPanel onIngestComplete={onIngestComplete} />);
    await user.click(screen.getByRole('button', { name: /add knowledge/i }));

    await user.type(screen.getByPlaceholderText('Note title'), 'Fail Note');
    await user.type(screen.getByPlaceholderText(/write your note/i), 'Content');
    await user.click(screen.getByRole('button', { name: /add to brain/i }));

    await waitFor(() => {
      expect(screen.getByText(/ingest failed/i)).toBeInTheDocument();
    });

    expect(onIngestComplete).not.toHaveBeenCalled();
  });

  it('disables submit when title or content is empty', async () => {
    const user = userEvent.setup();
    render(<IngestPanel onIngestComplete={onIngestComplete} />);
    await user.click(screen.getByRole('button', { name: /add knowledge/i }));

    const submitBtn = screen.getByRole('button', { name: /add to brain/i });
    expect(submitBtn).toBeDisabled();

    await user.type(screen.getByPlaceholderText('Note title'), 'Title');
    expect(submitBtn).toBeDisabled();

    await user.type(screen.getByPlaceholderText(/write your note/i), 'Content');
    expect(submitBtn).not.toBeDisabled();
  });

  it('uploads a file and ingests its contents', async () => {
    const user = userEvent.setup();
    const mockResponse = { concepts: ['Physics'], doc_id: 'xyz' };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as Response);

    render(<IngestPanel onIngestComplete={onIngestComplete} />);
    await user.click(screen.getByRole('button', { name: /add knowledge/i }));

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
});
