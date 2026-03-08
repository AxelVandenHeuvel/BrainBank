import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NoteEditor } from './NoteEditor';

const onSave = vi.fn();
const onCancel = vi.fn();

beforeEach(() => {
  vi.restoreAllMocks();
  onSave.mockClear();
  onCancel.mockClear();
});

describe('NoteEditor', () => {
  it('renders title input and content textarea', () => {
    render(<NoteEditor onSave={onSave} onCancel={onCancel} />);
    expect(screen.getByPlaceholderText('Untitled')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/start writing/i)).toBeInTheDocument();
  });

  it('has a back button that calls onCancel', async () => {
    const user = userEvent.setup();
    render(<NoteEditor onSave={onSave} onCancel={onCancel} />);

    await user.click(screen.getByRole('button', { name: /back to graph/i }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('saves note via POST /ingest and calls onSave', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ concepts: ['Math', 'Physics'], doc_id: 'abc' }),
    } as Response);

    render(<NoteEditor onSave={onSave} onCancel={onCancel} />);

    await user.type(screen.getByPlaceholderText('Untitled'), 'My Note');
    await user.type(screen.getByPlaceholderText(/start writing/i), 'Some content');
    await user.click(screen.getByRole('button', { name: /save to brain/i }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'My Note', text: 'Some content' }),
      });
    });

    await waitFor(() => {
      expect(onSave).toHaveBeenCalled();
    });
  });

  it('disables save when content is empty', () => {
    render(<NoteEditor onSave={onSave} onCancel={onCancel} />);
    expect(screen.getByRole('button', { name: /save to brain/i })).toBeDisabled();
  });

  it('shows error on failed save', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 500,
    } as Response);

    render(<NoteEditor onSave={onSave} onCancel={onCancel} />);

    await user.type(screen.getByPlaceholderText('Untitled'), 'Fail');
    await user.type(screen.getByPlaceholderText(/start writing/i), 'Content');
    await user.click(screen.getByRole('button', { name: /save to brain/i }));

    await waitFor(() => {
      expect(screen.getByText(/failed to save/i)).toBeInTheDocument();
    });

    expect(onSave).not.toHaveBeenCalled();
  });
});
