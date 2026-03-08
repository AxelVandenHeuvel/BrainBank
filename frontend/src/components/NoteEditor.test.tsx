import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock Milkdown Crepe since ProseMirror doesn't work in jsdom
let mockMarkdown = '';
vi.mock('@milkdown/crepe', () => {
  class Crepe {
    static Feature = { Toolbar: 'toolbar', Latex: 'latex', Placeholder: 'placeholder' };
    root: HTMLElement | null = null;
    onChangeCb: ((md: string) => void) | null = null;

    constructor(opts: { root: HTMLElement; defaultValue?: string; features?: Record<string, boolean>; featureConfigs?: Record<string, unknown> }) {
      this.root = opts.root;
    }

    on(cb: (listener: { markdownUpdated: (fn: (ctx: unknown, md: string) => void) => void }) => void) {
      cb({
        markdownUpdated: (fn: (ctx: unknown, md: string) => void) => {
          this.onChangeCb = (md: string) => fn(null, md);
        },
      });
      return this;
    }

    async create() {
      if (!this.root) return this;
      // Render a textarea mock inside the root
      const ta = document.createElement('textarea');
      ta.dataset.testid = 'milkdown-mock';
      ta.placeholder = 'Start writing...';
      ta.addEventListener('input', (e) => {
        mockMarkdown = (e.target as HTMLTextAreaElement).value;
        this.onChangeCb?.(mockMarkdown);
      });
      this.root.appendChild(ta);
      return this;
    }

    getMarkdown() {
      return mockMarkdown;
    }

    get editor() {
      return { action: () => {}, use: () => ({ use: () => this.editor }) };
    }

    destroy() {
      return Promise.resolve();
    }
  }

  return { Crepe };
});

vi.mock('@milkdown/kit/core', () => ({ editorViewCtx: Symbol('editorViewCtx') }));
vi.mock('@milkdown/kit/utils', () => ({ $prose: (fn: unknown) => fn }));
vi.mock('@milkdown/kit/prose/state', () => ({ Plugin: class {} }));
vi.mock('@milkdown/kit/prose/view', () => ({ Decoration: {}, DecorationSet: { empty: {}, create: () => ({}) } }));
vi.mock('@milkdown/crepe/theme/common/style.css', () => ({}));
vi.mock('@milkdown/crepe/theme/frame-dark.css', () => ({}));

import { NoteEditor } from './NoteEditor';

const onSave = vi.fn();
const onCancel = vi.fn();

beforeEach(() => {
  mockMarkdown = '';
  vi.restoreAllMocks();
  onSave.mockClear();
  onCancel.mockClear();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('NoteEditor', () => {
  it('renders title input and editor', async () => {
    render(<NoteEditor onSave={onSave} onCancel={onCancel} />);
    expect(screen.getByPlaceholderText('Untitled')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('milkdown-mock')).toBeInTheDocument();
    });
  });

  it('has a back button that calls onCancel', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<NoteEditor onSave={onSave} onCancel={onCancel} />);

    await user.click(screen.getByRole('button', { name: /back to graph/i }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('auto-saves after 2s of inactivity', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ concepts: ['Math'], doc_id: 'abc' }),
    } as Response);

    render(<NoteEditor onSave={onSave} onCancel={onCancel} />);

    await waitFor(() => {
      expect(screen.getByTestId('milkdown-mock')).toBeInTheDocument();
    });

    await user.type(screen.getByPlaceholderText('Untitled'), 'My Note');
    await user.type(screen.getByTestId('milkdown-mock'), 'Some content');

    // Advance past the 2s debounce
    await act(async () => {
      vi.advanceTimersByTime(2500);
    });

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

    expect(screen.getByTestId('save-status')).toHaveTextContent('Saved');
  });

  it('shows error on failed auto-save', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 500,
    } as Response);

    render(<NoteEditor onSave={onSave} onCancel={onCancel} />);

    await waitFor(() => {
      expect(screen.getByTestId('milkdown-mock')).toBeInTheDocument();
    });

    await user.type(screen.getByTestId('milkdown-mock'), 'Content');

    await act(async () => {
      vi.advanceTimersByTime(2500);
    });

    await waitFor(() => {
      expect(screen.getByTestId('save-status')).toHaveTextContent('Save failed');
    });

    expect(onSave).not.toHaveBeenCalled();
  });

  it('saves immediately when navigating back with unsaved changes', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ concepts: [], doc_id: 'x' }),
    } as Response);

    render(<NoteEditor onSave={onSave} onCancel={onCancel} />);

    await waitFor(() => {
      expect(screen.getByTestId('milkdown-mock')).toBeInTheDocument();
    });

    await user.type(screen.getByTestId('milkdown-mock'), 'Unsaved work');

    // Click back without waiting for debounce
    await user.click(screen.getByRole('button', { name: /back to graph/i }));

    expect(onCancel).toHaveBeenCalled();

    // The save should have been triggered immediately
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/ingest', expect.objectContaining({
        method: 'POST',
      }));
    });
  });
});
